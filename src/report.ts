import { ACTION_VERSION } from "./version.js";
import { issueText } from "./i18n.js";
import { shortSha } from "./text.js";
import type { PipelineResult } from "./pipeline.js";

export interface JsonReport {
  name: string;
  version: string;
  dryRun: boolean;
  llmCalled: boolean;
  llmSkipReason: PipelineResult["llmSkipReason"];
  commentPosted: boolean;
  commentId: number | null;
  language: PipelineResult["language"];
  mode: PipelineResult["mode"];
  files: { kept: string[]; ignored: string[] };
  redactions: PipelineResult["redactions"];
  chunks: number;
  boundedChars: number;
  omittedPaths: string[];
  truncatedPaths: string[];
  commits: {
    sha: string;
    subject: string;
    ok: boolean;
    issues: { code: string; severity: string; message: string }[];
    suggestion: string | null;
  }[];
  summary: string;
  conventionalTitle: string | null;
  titleFormatOk: boolean | null;
  commentBody: string;
  error: null;
}

export function toJsonReport(result: PipelineResult): JsonReport {
  return {
    name: "pr-summary-action",
    version: ACTION_VERSION,
    dryRun: result.dryRun,
    llmCalled: result.llmCalled,
    llmSkipReason: result.llmSkipReason,
    commentPosted: result.commentId !== null,
    commentId: result.commentId,
    language: result.language,
    mode: result.mode,
    files: { kept: result.kept, ignored: result.ignored },
    redactions: result.redactions,
    chunks: result.chunkCount,
    boundedChars: result.boundedChars,
    omittedPaths: result.omittedPaths,
    truncatedPaths: result.truncatedPaths,
    commits: result.commits.map((commit) => ({
      sha: commit.sha,
      subject: commit.subject,
      ok: commit.lint.ok,
      issues: commit.lint.issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issueText(result.language, issue.code),
      })),
      suggestion: commit.suggestion,
    })),
    summary: result.summary,
    conventionalTitle: result.conventionalTitle,
    titleFormatOk: result.titleFormatOk,
    commentBody: result.commentBody,
    error: null,
  };
}

function llmLine(result: PipelineResult): string {
  if (result.llmCalled) {
    return `called (${result.model ?? "unknown"})`;
  }
  if (result.llmSkipReason === "nothing-to-send") {
    return "skipped (nothing to send)";
  }
  return "skipped (no api key)";
}

export function formatHuman(result: PipelineResult): string {
  const total = result.redactions.reduce((sum, hit) => sum + hit.count, 0);
  const lines = [
    `pr-summary-action ${ACTION_VERSION}`,
    `language: ${result.language}`,
    `mode: ${result.mode}`,
    `dry-run: ${result.dryRun}`,
    `llm: ${llmLine(result)}`,
    `comment: ${result.commentId === null ? "not posted" : `upserted ${result.commentId}`}`,
    "",
    `files kept (${result.kept.length}):`,
    ...(result.kept.length > 0 ? result.kept.map((path) => `- ${path}`) : ["-"]),
    `files ignored (${result.ignored.length}):`,
    ...(result.ignored.length > 0 ? result.ignored.map((path) => `- ${path}`) : ["-"]),
    `redactions: ${total}`,
    ...(result.redactions.length > 0
      ? result.redactions.map((hit) => `- ${hit.kind}: ${hit.count}`)
      : ["-"]),
    `bounded chars: ${result.boundedChars}`,
    `chunks: ${result.chunkCount}`,
    `omitted files: ${result.omittedPaths.length}`,
    "",
    "commit review (deterministic):",
    ...(result.commits.length > 0
      ? result.commits.map((commit) => {
          const issues = commit.lint.issues.map((issue) => issue.code).join(", ");
          const state = commit.lint.ok ? "ok" : "needs changes";
          return `- ${shortSha(commit.sha)} ${commit.subject} — ${state}${issues ? ` (${issues})` : ""}`;
        })
      : ["-"]),
    "",
    result.commentId === null ? "--- comment body (not posted) ---" : "--- comment body ---",
    result.commentBody.trimEnd(),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export function formatLog(result: PipelineResult): string {
  const total = result.redactions.reduce((sum, hit) => sum + hit.count, 0);
  return `pr-summary-action: kept=${result.kept.length} ignored=${result.ignored.length} redactions=${total} chunks=${result.chunkCount} llm=${result.llmCalled} dry-run=${result.dryRun} comment=${result.commentId ?? "none"}`;
}
