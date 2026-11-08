import { DiffError } from "../errors.js";
import { normalizeNewlines } from "../text.js";
import type { DiffFile, DiffStatus } from "../types.js";

function parseQuotedPair(rest: string): [string, string] | null {
  const values: string[] = [];
  let index = 0;
  while (index < rest.length && values.length < 2) {
    if (rest[index] === " ") {
      index += 1;
      continue;
    }
    if (rest[index] !== '"') {
      return null;
    }
    index += 1;
    let value = "";
    while (index < rest.length && rest[index] !== '"') {
      if (rest[index] === "\\" && index + 1 < rest.length) {
        const escaped = rest[index + 1] ?? "";
        value += escaped;
        index += 2;
        continue;
      }
      const current = rest[index] ?? "";
      value += current;
      index += 1;
    }
    if (rest[index] !== '"') {
      return null;
    }
    index += 1;
    values.push(value);
  }
  const first = values[0];
  const second = values[1];
  if (!first || !second) {
    return null;
  }
  return [first, second];
}

function stripAbPrefix(path: string): string {
  if (path.startsWith("a/") || path.startsWith("b/")) {
    return path.slice(2);
  }
  return path;
}

function headerPaths(line: string): { previous: string; path: string } | null {
  if (!line.startsWith("diff --git ")) {
    return null;
  }
  const rest = line.slice("diff --git ".length);
  if (rest.startsWith('"')) {
    const quoted = parseQuotedPair(rest);
    if (!quoted) {
      return null;
    }
    return { previous: stripAbPrefix(quoted[0]), path: stripAbPrefix(quoted[1]) };
  }
  const match = /^a\/(.+) b\/(.+)$/.exec(rest);
  const previous = match?.[1];
  const path = match?.[2];
  if (!previous || !path) {
    return null;
  }
  return { previous, path };
}

function detectStatus(section: string, previous: string, path: string): DiffStatus {
  if (/^Binary files /m.test(section)) {
    return "binary";
  }
  if (/^new file mode /m.test(section)) {
    return "added";
  }
  if (/^deleted file mode /m.test(section)) {
    return "removed";
  }
  if (/^copy from /m.test(section)) {
    return "copied";
  }
  if (/^rename from /m.test(section) || previous !== path) {
    return "renamed";
  }
  return "modified";
}

function countHunks(section: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of section.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git ")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

export function parseUnifiedDiff(input: string): DiffFile[] {
  const text = normalizeNewlines(input);
  if (!text.includes("diff --git ")) {
    throw new DiffError(
      "Diff is missing diff --git headers. A pull request file list or a git unified diff is required.",
    );
  }
  const sections = text
    .split(/\n(?=diff --git )/)
    .map((section) => section.trim())
    .filter((section) => section.startsWith("diff --git "));
  if (sections.length === 0) {
    throw new DiffError("Diff did not contain any file sections.");
  }
  return sections.map((section) => {
    const header = section.split("\n")[0] ?? "";
    const paths = headerPaths(header);
    if (!paths) {
      throw new DiffError(`Could not read a diff header: ${header.slice(0, 180)}`);
    }
    const status = detectStatus(section, paths.previous, paths.path);
    const counts = countHunks(section);
    const patch = section.endsWith("\n") ? section : `${section}\n`;
    return {
      path: paths.path,
      previousPath: status === "renamed" || status === "copied" ? paths.previous : null,
      status,
      patch,
      additions: counts.additions,
      deletions: counts.deletions,
    };
  });
}

export function wrapGitHubPatch(
  path: string,
  previousPath: string | null,
  status: DiffStatus,
  patch: string,
  additions: number,
  deletions: number,
): string {
  if (patch.trim() === "") {
    return `diff --git a/${path} b/${path}\nPatch omitted by GitHub (status ${status}, +${additions} -${deletions}).\n`;
  }
  const lines = [`diff --git a/${previousPath ?? path} b/${path}`];
  if (status === "added") {
    lines.push("new file mode 100644", "--- /dev/null", `+++ b/${path}`);
  } else if (status === "removed") {
    lines.push("deleted file mode 100644", `--- a/${path}`, "+++ /dev/null");
  } else if (status === "renamed" && previousPath) {
    lines.push(
      `rename from ${previousPath}`,
      `rename to ${path}`,
      `--- a/${previousPath}`,
      `+++ b/${path}`,
    );
  } else if (status === "binary") {
    lines.push(`Binary files a/${path} and b/${path} differ`);
    return `${lines.join("\n")}\n`;
  } else {
    lines.push(`--- a/${previousPath ?? path}`, `+++ b/${path}`);
  }
  lines.push(patch.replace(/\s+$/u, ""));
  return `${lines.join("\n")}\n`;
}
