import { resolve, isAbsolute } from "node:path";
import { InputError } from "./errors.js";
import { boundDiff } from "./diff/bound.js";
import { compileGlobs, pathIgnored } from "./diff/ignore.js";
import { parseUnifiedDiff } from "./diff/parse.js";
import { chunkDiff } from "./chunk.js";
import { isConventionalTitle, lintCommitMessage } from "./commits/lint.js";
import { renderComment } from "./comment/render.js";
import { upsertMarkerComment } from "./comment/upsert.js";
import { readCommitsFile, readPullEvent } from "./github/event.js";
import { listPullCommits, listPullFiles, type GitHubClientOptions } from "./github/api.js";
import { createRateLimiter } from "./http/limit.js";
import { sentence } from "./i18n.js";
import { summarizeDiff } from "./llm/summarize.js";
import { mergeHits, redactText, redactFiles } from "./redact.js";
import type { Runtime } from "./runtime.js";
import { clip, subjectLine } from "./text.js";
import type {
  AppConfig,
  CommitRecord,
  DiffFile,
  ModelCommitReview,
  PullContext,
  ReviewedCommit,
} from "./types.js";
import { modeIncludesReview, modeIncludesSummary } from "./types.js";

export interface PipelineResult {
  summary: string;
  conventionalTitle: string | null;
  titleFormatOk: boolean | null;
  commentBody: string;
  commentId: number | null;
  commentCreated: boolean;
  llmCalled: boolean;
  llmSkipReason: "no-api-key" | "nothing-to-send" | null;
  dryRun: boolean;
  kept: string[];
  ignored: string[];
  redactions: { kind: string; count: number }[];
  boundedChars: number;
  omittedPaths: string[];
  truncatedPaths: string[];
  chunkCount: number;
  commits: ReviewedCommit[];
  model: string | null;
  language: AppConfig["language"];
  mode: AppConfig["mode"];
  redactedDiff: string;
}

function resolveFile(runtime: Runtime, file: string): string {
  return isAbsolute(file) ? file : resolve(runtime.cwd, file);
}

function githubOptions(
  config: AppConfig,
  runtime: Runtime,
  limiter: () => Promise<void>,
): GitHubClientOptions {
  return {
    fetch: runtime.fetch,
    apiBase: config.githubApiUrl,
    token: config.githubToken ?? "",
    policy: {
      maxRetries: config.maxRetries,
      retryBaseMs: config.retryBaseMs,
      timeoutMs: config.timeoutMs,
      retryUnsafe: false,
    },
    limiter,
    sleep: runtime.sleep,
    now: runtime.now,
    redact: (text) => redactText(text).text,
  };
}

async function loadFiles(
  config: AppConfig,
  runtime: Runtime,
  pull: PullContext,
  limiter: () => Promise<void>,
): Promise<DiffFile[]> {
  if (config.diffFile) {
    return parseUnifiedDiff(runtime.readFile(resolveFile(runtime, config.diffFile)));
  }
  if (pull.source !== "github" || !pull.owner || !pull.repo || pull.number === null) {
    throw new InputError("Pull request context is missing.");
  }
  if (!config.githubToken) {
    throw new InputError("github-token is required to read the pull request.");
  }
  return listPullFiles(pull.owner, pull.repo, pull.number, {
    ...githubOptions(config, runtime, limiter),
    cap: config.maxFiles,
  });
}

async function loadCommits(
  config: AppConfig,
  runtime: Runtime,
  pull: PullContext,
  limiter: () => Promise<void>,
): Promise<CommitRecord[]> {
  if (!modeIncludesReview(config.mode)) {
    return [];
  }
  if (config.commitsFile) {
    return readCommitsFile(runtime.readFile(resolveFile(runtime, config.commitsFile)));
  }
  if (
    pull.source !== "github" ||
    !pull.owner ||
    !pull.repo ||
    pull.number === null ||
    !config.githubToken
  ) {
    return [];
  }
  return listPullCommits(pull.owner, pull.repo, pull.number, {
    ...githubOptions(config, runtime, limiter),
    cap: config.maxCommits,
  });
}

function matchSuggestion(sha: string, reviews: ModelCommitReview[]): string | null {
  const found = reviews.find((review) => {
    if (review.sha.length < 7) {
      return false;
    }
    return sha.startsWith(review.sha) || review.sha.startsWith(sha);
  });
  return found?.suggestion ?? null;
}

export async function runPipeline(config: AppConfig, runtime: Runtime): Promise<PipelineResult> {
  const limiter = createRateLimiter(config.minIntervalMs, runtime.now, runtime.sleep);
  const pull = config.eventPath
    ? readPullEvent(runtime.readFile(config.eventPath), config.githubRepository)
    : {
        source: "fixture" as const,
        owner: null,
        repo: null,
        number: null,
        title: config.fixtureTitle,
        body: "",
      };
  const titleRedacted = redactText(pull.title);
  const bodyRedacted = redactText(clip(pull.body, config.maxBodyChars));
  const safePull: PullContext = {
    ...pull,
    title: clip(titleRedacted.text, 300),
    body: bodyRedacted.text,
  };

  const files = await loadFiles(config, runtime, pull, limiter);
  const globs = compileGlobs(config.ignorePaths);
  const keptFiles: DiffFile[] = [];
  const ignored: string[] = [];
  for (const file of files) {
    const skip =
      pathIgnored(file.path, globs) ||
      (file.previousPath !== null && pathIgnored(file.previousPath, globs));
    if (skip) {
      ignored.push(file.path);
    } else {
      keptFiles.push(file);
    }
  }
  const redacted = redactFiles(keptFiles);
  const bounded = boundDiff(redacted.files, config.maxDiffChars);
  const chunked = chunkDiff(bounded.text, config.chunkChars, config.maxChunks);
  const commits = await loadCommits(config, runtime, pull, limiter);
  const commitHits = commits.map((commit) => redactText(commit.message));
  const reviewed: ReviewedCommit[] = commits.map((commit, index) => {
    const message = commitHits[index]?.text ?? "";
    return {
      sha: commit.sha,
      subject: subjectLine(message),
      lint: lintCommitMessage(message),
      suggestion: null,
    };
  });

  const hasDiff = bounded.text.trim() !== "";
  const wantsModel =
    (modeIncludesSummary(config.mode) && hasDiff) ||
    (modeIncludesReview(config.mode) && (hasDiff || reviewed.length > 0));
  const callModel = Boolean(config.apiKey) && wantsModel;
  const modelResult = callModel
    ? await summarizeDiff({
        config,
        fetch: runtime.fetch,
        pull: safePull,
        chunks: chunked.chunks,
        commits: reviewed,
        limiter,
        sleep: runtime.sleep,
        now: runtime.now,
        redact: (text) => redactText(text).text,
      })
    : null;

  const modelHits: { kind: string; count: number }[][] = [];
  const cleanModelText = (value: string): string => {
    const cleaned = redactText(value);
    modelHits.push(cleaned.hits);
    return cleaned.text;
  };
  if (modelResult) {
    for (const commit of reviewed) {
      const suggestion = matchSuggestion(commit.sha, modelResult.commitReviews);
      commit.suggestion = suggestion === null ? null : cleanModelText(suggestion);
    }
  }
  const cleanedSummary = modelResult?.summary ? cleanModelText(modelResult.summary) : null;
  const cleanedAreas = (modelResult?.areas ?? []).map((area) => ({
    area: cleanModelText(area.area),
    changes: cleanModelText(area.changes),
  }));
  const cleanedRisks = (modelResult?.risks ?? []).map((item) => cleanModelText(item));
  const cleanedPlan = (modelResult?.testPlan ?? []).map((item) => cleanModelText(item));
  const conventionalTitle = modelResult?.conventionalTitle
    ? cleanModelText(modelResult.conventionalTitle)
    : null;

  const redactions = mergeHits([
    redacted.hits,
    titleRedacted.hits,
    bodyRedacted.hits,
    ...commitHits.map((hit) => hit.hits),
    ...modelHits,
  ]);
  const titleFormatOk = conventionalTitle === null ? null : isConventionalTitle(conventionalTitle);
  const summary =
    cleanedSummary ??
    (hasDiff ? sentence(config.language, "notAReview") : sentence(config.language, "noText"));
  const commentBody = renderComment({
    language: config.language,
    mode: config.mode,
    dryRun: config.dryRun,
    llmCalled: callModel,
    model: callModel ? config.model : null,
    kept: bounded.keptPaths,
    ignored,
    redactions,
    omittedPaths: bounded.omittedPaths,
    truncatedPaths: bounded.truncatedPaths,
    boundedChars: bounded.chars,
    maxDiffChars: config.maxDiffChars,
    summary: cleanedSummary,
    areas: cleanedAreas,
    risks: cleanedRisks,
    testPlan: cleanedPlan,
    conventionalTitle,
    commits: reviewed,
    maxChars: config.maxCommentChars,
  });

  let commentId: number | null = null;
  let commentCreated = false;
  if (!config.dryRun) {
    if (pull.source !== "github" || !pull.owner || !pull.repo || pull.number === null) {
      throw new InputError("Refusing to post a comment without a pull request event.");
    }
    const upserted = await upsertMarkerComment(
      pull.owner,
      pull.repo,
      pull.number,
      commentBody,
      githubOptions(config, runtime, limiter),
    );
    commentId = upserted.id;
    commentCreated = upserted.created;
  }

  return {
    summary,
    conventionalTitle,
    titleFormatOk,
    commentBody,
    commentId,
    commentCreated,
    llmCalled: callModel,
    llmSkipReason: callModel ? null : config.apiKey ? "nothing-to-send" : "no-api-key",
    dryRun: config.dryRun,
    kept: bounded.keptPaths,
    ignored,
    redactions,
    boundedChars: bounded.chars,
    omittedPaths: bounded.omittedPaths,
    truncatedPaths: bounded.truncatedPaths,
    chunkCount: chunked.chunks.length,
    commits: reviewed,
    model: callModel ? config.model : null,
    language: config.language,
    mode: config.mode,
    redactedDiff: bounded.text,
  };
}
