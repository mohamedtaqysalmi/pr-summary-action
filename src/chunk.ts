export interface DiffChunk {
  index: number;
  text: string;
}

export interface ChunkResult {
  chunks: DiffChunk[];
  omittedChars: number;
}

export function splitDiffSections(text: string): string[] {
  return text
    .split(/\n(?=diff --git )/)
    .map((section) => section.trimEnd())
    .filter((section) => section.trim() !== "");
}

function pushLineChunks(section: string, chunkChars: number, target: string[]): void {
  let buffer = "";
  const lines = section.split("\n");
  for (const line of lines) {
    let remaining = line;
    while (remaining.length > chunkChars) {
      if (buffer.length > 0) {
        target.push(buffer);
        buffer = "";
      }
      target.push(remaining.slice(0, chunkChars));
      remaining = remaining.slice(chunkChars);
    }
    const next = buffer.length === 0 ? remaining : `${buffer}\n${remaining}`;
    if (next.length > chunkChars && buffer.length > 0) {
      target.push(buffer);
      buffer = remaining;
      continue;
    }
    buffer = next;
  }
  if (buffer.length > 0) {
    target.push(buffer);
  }
}

export function chunkDiff(text: string, chunkChars: number, maxChunks: number): ChunkResult {
  if (text.trim() === "") {
    return { chunks: [], omittedChars: 0 };
  }
  const size = Math.max(1, chunkChars);
  const limit = Math.max(1, maxChunks);
  const raw: string[] = [];
  for (const section of splitDiffSections(text)) {
    if (section.length > size) {
      pushLineChunks(section, size, raw);
      continue;
    }
    const current = raw[raw.length - 1];
    if (current !== undefined && current.length + section.length + 1 <= size) {
      raw[raw.length - 1] = `${current}\n${section}`;
    } else {
      raw.push(section);
    }
  }
  if (raw.length <= limit) {
    return {
      chunks: raw.map((chunk, index) => ({ index, text: chunk })),
      omittedChars: 0,
    };
  }
  const head = raw.slice(0, limit - 1);
  const tail = raw.slice(limit - 1).join("\n");
  const notePrefix = "\n[pr-summary-action] Trimmed ";
  const room = Math.max(0, size - 80);
  const body = tail.slice(0, room);
  const omittedChars = Math.max(0, tail.length - body.length);
  const last = `${body}${notePrefix}${omittedChars} characters from later chunks.`;
  const chunks = [...head, last].map((chunk, index) => ({ index, text: chunk }));
  return { chunks, omittedChars };
}
