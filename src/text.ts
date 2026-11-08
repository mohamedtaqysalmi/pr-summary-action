export function clip(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return text.slice(0, max);
}

export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function safeHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "invalid-base-url";
  }
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function subjectLine(message: string): string {
  const line = normalizeNewlines(message).split("\n")[0] ?? "";
  return line.trim();
}

/** Break GitHub mention tokens and a closing wrapper injected by untrusted text. */
export function sanitizeUntrusted(text: string): string {
  const mentions = text.replace(/(^|[^\w])@([A-Za-z0-9])/g, "$1@\u200b$2");
  return mentions.replace(/<\/(\s*)div/gi, "<\u200b/$1div");
}

export function workflowCommand(command: "error" | "warning", message: string): string {
  const escaped = message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  return `::${command}::${escaped}`;
}
