import type { DiffFile } from "../types.js";

export interface BoundDiff {
  text: string;
  keptPaths: string[];
  omittedPaths: string[];
  truncatedPaths: string[];
  chars: number;
}

function blockOf(file: DiffFile): string {
  return file.patch.endsWith("\n") ? file.patch : `${file.patch}\n`;
}

export function boundDiff(files: DiffFile[], maxChars: number): BoundDiff {
  const kept: DiffFile[] = [];
  const omitted: string[] = [];
  const truncated: string[] = [];
  let used = 0;
  let index = 0;
  for (; index < files.length; index += 1) {
    const file = files[index];
    if (!file) {
      continue;
    }
    const block = blockOf(file);
    if (used + block.length <= maxChars) {
      kept.push(file);
      used += block.length;
      continue;
    }
    if (kept.length === 0 && maxChars > 0) {
      const slice = block.slice(0, Math.max(0, maxChars));
      kept.push({ ...file, patch: slice });
      truncated.push(file.path);
      index += 1;
    }
    break;
  }
  for (; index < files.length; index += 1) {
    const file = files[index];
    if (file) {
      omitted.push(file.path);
    }
  }

  const notices: string[] = [];
  if (truncated.length > 0) {
    notices.push(
      `[pr-summary-action] Trimmed ${truncated.join(", ")} so the diff stays within max-diff-chars.`,
    );
  }
  if (omitted.length > 0) {
    notices.push(
      `[pr-summary-action] Omitted ${omitted.length} file(s) after the size limit: ${omitted.join(", ")}`,
    );
  }
  const notice = notices.length > 0 ? `${notices.join("\n")}\n` : "";
  let body = kept
    .map((file) => (file.patch.endsWith("\n") ? file.patch : `${file.patch}\n`))
    .join("");
  if (notice) {
    if (body.length + notice.length > maxChars) {
      body = body.slice(0, Math.max(0, maxChars - notice.length));
    }
    body += notice;
  }
  if (body.length > maxChars) {
    body = body.slice(0, maxChars);
  }
  return {
    text: body,
    keptPaths: kept.map((file) => file.path),
    omittedPaths: omitted,
    truncatedPaths: truncated,
    chars: body.length,
  };
}
