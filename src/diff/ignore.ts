function escapeRegExp(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}

export function globToRegExp(pattern: string): RegExp {
  let source = pattern.trim().replace(/\\/g, "/");
  if (source.startsWith("./")) {
    source = source.slice(2);
  }
  if (source.startsWith("/")) {
    source = source.slice(1);
  }
  const basenameOnly = !source.includes("/");
  let body = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "*") {
      if (source[index + 1] === "*") {
        if (source[index + 2] === "/") {
          body += "(?:[^/]+/)*";
          index += 3;
          continue;
        }
        body += ".*";
        index += 2;
        continue;
      }
      body += "[^/]*";
      index += 1;
      continue;
    }
    if (char === "?") {
      body += "[^/]";
      index += 1;
      continue;
    }
    body += escapeRegExp(char ?? "");
    index += 1;
  }
  const anchored = basenameOnly ? `(?:^|/)${body}$` : `^${body}$`;
  return new RegExp(anchored);
}

export function normalizePath(path: string): string {
  let value = path.replace(/\\/g, "/");
  if (value.startsWith("./")) {
    value = value.slice(2);
  }
  if (value.startsWith("/")) {
    value = value.slice(1);
  }
  return value;
}

export function compileGlobs(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => globToRegExp(pattern));
}

export function pathIgnored(path: string, patterns: readonly RegExp[]): boolean {
  const normalized = normalizePath(path);
  return patterns.some((pattern) => pattern.test(normalized));
}

export function parseIgnoreList(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined) {
    return [...fallback];
  }
  const parts = value
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith("#"));
  return parts.length > 0 ? parts : [...fallback];
}
