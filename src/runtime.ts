import { appendFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

export interface Runtime {
  kind: "action" | "cli";
  env: NodeJS.ProcessEnv;
  argv: string[];
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  cwd: string;
  readFile: (file: string) => string;
  writeOutput: (name: string, value: string) => void;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export function writeGitHubOutput(file: string, name: string, value: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid output name: ${name}`);
  }
  const delimiter = `ghadelim_${randomBytes(16).toString("hex")}`;
  if (value.includes(delimiter)) {
    throw new Error("Output delimiter collision.");
  }
  appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

export function createRuntime(kind: "action" | "cli"): Runtime {
  return {
    kind,
    env: process.env,
    argv: process.argv.slice(2),
    fetch: globalThis.fetch,
    now: () => Date.now(),
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    cwd: process.cwd(),
    readFile: (file: string) => readFileSync(file, "utf8"),
    writeOutput: (name: string, value: string) => {
      const file = process.env.GITHUB_OUTPUT;
      if (file) {
        writeGitHubOutput(file, name, value);
      }
    },
    stdout: (text: string) => {
      process.stdout.write(text);
    },
    stderr: (text: string) => {
      process.stderr.write(text);
    },
  };
}
