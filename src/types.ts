export const LANGUAGES = ["en", "fr", "darija"] as const;
export type Language = (typeof LANGUAGES)[number];

export const MODES = ["summary", "commit-review", "full"] as const;
export type Mode = (typeof MODES)[number];

export const DIFF_STATUSES = [
  "added",
  "modified",
  "removed",
  "renamed",
  "copied",
  "binary",
  "unknown",
] as const;
export type DiffStatus = (typeof DIFF_STATUSES)[number];

export interface DiffFile {
  path: string;
  previousPath: string | null;
  status: DiffStatus;
  patch: string;
  additions: number;
  deletions: number;
}

export interface RedactionHit {
  kind: string;
  count: number;
}

export type CommitIssueCode =
  "empty" | "not-conventional" | "subject-long" | "trailing-period" | "body-blank-line";

export interface CommitIssue {
  code: CommitIssueCode;
  severity: "error" | "warning";
}

export interface CommitLint {
  ok: boolean;
  issues: CommitIssue[];
}

export interface CommitRecord {
  sha: string;
  message: string;
}

export interface ReviewedCommit {
  sha: string;
  subject: string;
  lint: CommitLint;
  suggestion: string | null;
}

export interface ModelArea {
  area: string;
  changes: string;
}

export interface ModelCommitReview {
  sha: string;
  suggestion: string;
}

export interface ModelSummary {
  summary: string | null;
  areas: ModelArea[];
  risks: string[];
  testPlan: string[];
  conventionalTitle: string | null;
  commitReviews: ModelCommitReview[];
}

export interface PullContext {
  source: "github" | "fixture";
  owner: string | null;
  repo: string | null;
  number: number | null;
  title: string;
  body: string;
}

export interface AppConfig {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  language: Language;
  maxDiffChars: number;
  ignorePaths: string[];
  mode: Mode;
  dryRun: boolean;
  failOnError: boolean;
  githubToken: string | null;
  githubRepository: string | null;
  githubApiUrl: string;
  eventName: string | null;
  eventPath: string | null;
  diffFile: string | null;
  commitsFile: string | null;
  fixtureTitle: string;
  showRedactedDiff: boolean;
  jsonOutput: boolean;
  maxRetries: number;
  retryBaseMs: number;
  minIntervalMs: number;
  timeoutMs: number;
  chunkChars: number;
  maxChunks: number;
  maxOutputTokens: number;
  temperature: number;
  jsonMode: boolean;
  maxCommentChars: number;
  maxFiles: number;
  maxCommits: number;
  maxBodyChars: number;
  kind: "action" | "cli";
}

export function modeIncludesSummary(mode: Mode): boolean {
  return mode === "summary" || mode === "full";
}

export function modeIncludesReview(mode: Mode): boolean {
  return mode === "commit-review" || mode === "full";
}
