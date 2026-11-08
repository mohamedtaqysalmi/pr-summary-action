import type { DiffFile, RedactionHit } from "./types.js";

interface Pattern {
  kind: string;
  source: string;
  flags: string;
}

const PATTERNS: Pattern[] = [
  {
    kind: "private-key",
    source:
      "-----BEGIN [A-Z0-9 ]{0,48}PRIVATE KEY-----[\\s\\S]{0,8000}?-----END [A-Z0-9 ]{0,48}PRIVATE KEY-----",
    flags: "g",
  },
  { kind: "aws-access-key-id", source: "\\bAKIA[0-9A-Z]{16}\\b", flags: "g" },
  { kind: "github-token", source: "\\bgh[pousr]_[A-Za-z0-9]{36}\\b", flags: "g" },
  { kind: "github-pat", source: "\\bgithub_pat_[A-Za-z0-9_]{22,255}\\b", flags: "g" },
  { kind: "openai-api-key", source: "\\bsk-[A-Za-z0-9_\\-]{20,}\\b", flags: "g" },
  { kind: "slack-token", source: "\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b", flags: "g" },
  { kind: "stripe-live-key", source: "\\b(?:sk|rk)_live_[A-Za-z0-9]{10,}\\b", flags: "g" },
  { kind: "google-api-key", source: "\\bAIza[0-9A-Za-z\\-_]{35}\\b", flags: "g" },
  { kind: "npm-token", source: "\\bnpm_[A-Za-z0-9]{36}\\b", flags: "g" },
  {
    kind: "jwt",
    source: "\\beyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\b",
    flags: "g",
  },
  {
    kind: "bearer-token",
    source: "\\bBearer[ \\t]+[A-Za-z0-9\\-._~+/]{16,}={0,2}",
    flags: "g",
  },
  {
    kind: "basic-auth",
    source: "\\bBasic[ \\t]+[A-Za-z0-9+/]{16,}={0,2}",
    flags: "g",
  },
];

function assignmentPattern(): RegExp {
  return /\b(api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token)\b[ \t]*[:=][ \t]*("([^"\n]*)"|'([^'\n]*)'|([^\s#]+))/gi;
}

export function mergeHits(groups: RedactionHit[][]): RedactionHit[] {
  const totals = new Map<string, number>();
  for (const group of groups) {
    for (const hit of group) {
      totals.set(hit.kind, (totals.get(hit.kind) ?? 0) + hit.count);
    }
  }
  return [...totals.entries()].map(([kind, count]) => ({ kind, count }));
}

export function redactText(input: string): { text: string; hits: RedactionHit[] } {
  let text = input;
  const hits: RedactionHit[] = [];
  for (const pattern of PATTERNS) {
    const expression = new RegExp(pattern.source, pattern.flags);
    let count = 0;
    text = text.replace(expression, () => {
      count += 1;
      return `[REDACTED:${pattern.kind}]`;
    });
    if (count > 0) {
      hits.push({ kind: pattern.kind, count });
    }
  }
  const assigned = redactAssignments(text);
  text = assigned.text;
  if (assigned.count > 0) {
    hits.push({ kind: "assigned-secret", count: assigned.count });
  }
  return { text, hits };
}

function redactAssignments(input: string): { text: string; count: number } {
  let count = 0;
  const text = input.replace(
    assignmentPattern(),
    (
      full: string,
      _key: string,
      _quoted: string,
      doubleQuoted: string | undefined,
      singleQuoted: string | undefined,
      bare: string | undefined,
    ) => {
      const value =
        typeof doubleQuoted === "string"
          ? doubleQuoted
          : typeof singleQuoted === "string"
            ? singleQuoted
            : typeof bare === "string"
              ? bare
              : "";
      if (value.startsWith("[REDACTED:")) {
        return full;
      }
      const quoted = typeof bare !== "string";
      const secretLike =
        (quoted && value.length >= 8) ||
        (!quoted && value.length >= 12 && /[\d$+/=_-]/.test(value));
      if (!secretLike || value.length === 0) {
        return full;
      }
      count += 1;
      return full.replaceAll(value, "[REDACTED:assigned-secret]");
    },
  );
  return { text, count };
}

export function redactFiles(files: DiffFile[]): { files: DiffFile[]; hits: RedactionHit[] } {
  const groups: RedactionHit[][] = [];
  const next = files.map((file) => {
    const redacted = redactText(file.patch);
    groups.push(redacted.hits);
    return { ...file, patch: redacted.text };
  });
  return { files: next, hits: mergeHits(groups) };
}
