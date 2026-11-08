import { InputError } from "./errors.js";

export interface CliFlags {
  diffFile?: string;
  commitsFile?: string;
  title?: string;
  language?: string;
  mode?: string;
  maxDiffChars?: string;
  ignorePaths?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  failOnError?: string;
}

export interface CliArgs {
  help: boolean;
  json: boolean;
  showRedactedDiff: boolean;
  apiKeyOnArgv: boolean;
  flags: CliFlags;
}

const HELP = `pr-summary-action dry-run

Read a unified diff, drop ignored paths, redact common secret patterns, and
print the comment that a model run would prepare. This command never creates
or updates a pull request comment. Without an API key it does not call a model.

Usage:
  pr-summary dry-run --diff-file <path> [options]

Options:
  --diff-file <path>          Unified diff fixture or git diff (required)
  --commits-file <path>       JSON array of {sha, message}
  --title <text>              Fixture pull request title
  --language <en|fr|darija>   Language for model prose and fixed headings
  --mode <summary|commit-review|full>
  --max-diff-chars <int>      Cap the redacted diff (1000-500000)
  --ignore-paths <globs>      Comma or newline separated globs
  --model <id>                Model id, used only when an API key is set
  --base-url <url>            OpenAI-compatible origin
  --api-key <key>             Prefer PR_SUMMARY_API_KEY so the key stays off argv
  --fail-on-error <bool>      CLI default is true
  --json                      Print a JSON report on stdout
  --show-redacted-diff        Print the redacted diff on stderr
  --help                      Show this help
`;

function take(argv: string[], index: number, flag: string): { value: string; next: number } {
  const current = argv[index] ?? "";
  const equals = current.indexOf("=");
  if (equals !== -1) {
    return { value: current.slice(equals + 1), next: index + 1 };
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new InputError(`${flag} requires a value`);
  }
  return { value, next: index + 2 };
}

export function helpText(): string {
  return HELP;
}

export function parseArgs(argv: string[]): CliArgs {
  const flags: CliFlags = {};
  let help = false;
  let json = false;
  let showRedactedDiff = false;
  let apiKeyOnArgv = false;
  const positional: string[] = [];

  for (let index = 0; index < argv.length;) {
    const token = argv[index] ?? "";
    if (token === "--help" || token === "-h") {
      help = true;
      index += 1;
      continue;
    }
    if (token === "--json") {
      json = true;
      index += 1;
      continue;
    }
    if (token === "--show-redacted-diff") {
      showRedactedDiff = true;
      index += 1;
      continue;
    }
    const flag = token.includes("=") ? token.slice(0, token.indexOf("=")) : token;
    if (flag === "--diff-file") {
      const taken = take(argv, index, flag);
      flags.diffFile = taken.value;
      index = taken.next;
      continue;
    }
    if (flag === "--commits-file") {
      const taken = take(argv, index, flag);
      flags.commitsFile = taken.value;
      index = taken.next;
      continue;
    }
    if (flag === "--title") {
      const taken = take(argv, index, flag);
      flags.title = taken.value;
      index = taken.next;
      continue;
    }
    if (flag === "--language") {
      const taken = take(argv, index, flag);
      flags.language = taken.value;
      index = taken.next;
      continue;
    }
    if (flag === "--mode") {
      const taken = take(argv, index, flag);
      flags.mode = taken.value;
      index = taken.next;
      continue;
    }
    if (flag === "--max-diff-chars") {
      const taken = take(argv, index, flag);
      flags.maxDiffChars = taken.value;
      index = taken.next;
      continue;
    }
    if (flag === "--ignore-paths") {
      const taken = take(argv, index, flag);
      flags.ignorePaths = taken.value;
      index = taken.next;
      continue;
    }
    if (flag === "--model") {
      const taken = take(argv, index, flag);
      flags.model = taken.value;
      index = taken.next;
      continue;
    }
    if (flag === "--base-url") {
      const taken = take(argv, index, flag);
      flags.baseUrl = taken.value;
      index = taken.next;
      continue;
    }
    if (flag === "--api-key") {
      const taken = take(argv, index, flag);
      flags.apiKey = taken.value;
      apiKeyOnArgv = true;
      index = taken.next;
      continue;
    }
    if (flag === "--fail-on-error") {
      const taken = take(argv, index, flag);
      flags.failOnError = taken.value;
      index = taken.next;
      continue;
    }
    if (token.startsWith("--")) {
      throw new InputError(`Unknown option ${token}`);
    }
    positional.push(token);
    index += 1;
  }

  if (!help) {
    if (positional.length === 0) {
      throw new InputError("A command is required. Use: pr-summary dry-run --diff-file <path>");
    }
    if (positional.length !== 1 || positional[0] !== "dry-run") {
      throw new InputError(
        `Unknown command ${positional.join(" ")}. The CLI only supports dry-run.`,
      );
    }
  }

  return { help, json, showRedactedDiff, apiKeyOnArgv, flags };
}
