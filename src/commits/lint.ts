import { normalizeNewlines, subjectLine } from "../text.js";
import type { CommitIssue, CommitLint } from "../types.js";

const CONVENTIONAL =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-zA-Z0-9._/-]+\))?!?: [^ ].+$/;

export function isConventionalTitle(title: string): boolean {
  return !title.includes("\n") && title.length <= 200 && CONVENTIONAL.test(title);
}

export function lintCommitMessage(message: string): CommitLint {
  const normalized = normalizeNewlines(message).trim();
  if (normalized === "") {
    return { ok: false, issues: [{ code: "empty", severity: "error" }] };
  }
  const lines = normalized.split("\n");
  const subject = lines[0] ?? "";
  const issues: CommitIssue[] = [];
  if (!CONVENTIONAL.test(subject)) {
    issues.push({ code: "not-conventional", severity: "error" });
  }
  if (subject.length > 72) {
    issues.push({ code: "subject-long", severity: "warning" });
  }
  if (subject.endsWith(".")) {
    issues.push({ code: "trailing-period", severity: "warning" });
  }
  if (lines.length > 1 && lines[1] !== "") {
    issues.push({ code: "body-blank-line", severity: "error" });
  }
  return { ok: issues.every((issue) => issue.severity !== "error"), issues };
}

export function commitSubject(message: string): string {
  return subjectLine(message);
}
