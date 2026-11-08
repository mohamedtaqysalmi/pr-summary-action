import { readFileSync } from "node:fs";
import type { Runtime } from "../../src/runtime.js";

export function captureRuntime(partial: Partial<Runtime> = {}): {
  runtime: Runtime;
  stdout: () => string;
  stderr: () => string;
  outputs: Map<string, string>;
} {
  const out: string[] = [];
  const err: string[] = [];
  const outputs = new Map<string, string>();
  const runtime: Runtime = {
    kind: "cli",
    env: {},
    argv: [],
    fetch: globalThis.fetch,
    now: () => 0,
    sleep: () => Promise.resolve(),
    cwd: process.cwd(),
    readFile: (file: string) => readFileSync(file, "utf8"),
    writeOutput: (name: string, value: string) => {
      outputs.set(name, value);
    },
    stdout: (text: string) => {
      out.push(text);
    },
    stderr: (text: string) => {
      err.push(text);
    },
    ...partial,
  };
  return {
    runtime,
    stdout: () => out.join(""),
    stderr: () => err.join(""),
    outputs,
  };
}
