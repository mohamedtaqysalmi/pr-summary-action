import { DiffError } from "../errors.js";
import { isRecord } from "../text.js";
import type { DiffFile, DiffStatus } from "../types.js";
import { wrapGitHubPatch } from "./parse.js";

const STATUSES = new Set<DiffStatus>([
  "added",
  "modified",
  "removed",
  "renamed",
  "copied",
  "binary",
  "unknown",
]);

function asStatus(value: unknown): DiffStatus {
  if (typeof value === "string" && STATUSES.has(value as DiffStatus)) {
    return value as DiffStatus;
  }
  if (value === "changed" || value === "unchanged") {
    return "modified";
  }
  return "unknown";
}

export function diffFileFromGitHub(value: unknown): DiffFile {
  if (!isRecord(value) || typeof value.filename !== "string" || value.filename.trim() === "") {
    throw new DiffError("Pull request file list contained an entry without a filename.");
  }
  const path = value.filename;
  const status = asStatus(value.status);
  const previousPath = typeof value.previous_filename === "string" ? value.previous_filename : null;
  const additions =
    typeof value.additions === "number" && Number.isFinite(value.additions) ? value.additions : 0;
  const deletions =
    typeof value.deletions === "number" && Number.isFinite(value.deletions) ? value.deletions : 0;
  const patch = typeof value.patch === "string" ? value.patch : "";
  return {
    path,
    previousPath,
    status,
    patch: wrapGitHubPatch(path, previousPath, status, patch, additions, deletions),
    additions,
    deletions,
  };
}
