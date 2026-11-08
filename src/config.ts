import { parseArgs, type CliFlags } from "./args.js";
import { InputError } from "./errors.js";
import { parseIgnoreList } from "./diff/ignore.js";
import type { AppConfig, Language, Mode } from "./types.js";
import { LANGUAGES, MODES } from "./types.js";
import type { Runtime } from "./runtime.js";

export const DEFAULT_IGNORE_PATHS = [
  "**/node_modules/**",
  "**/dist/**",
  "**/*.lock",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
];

function readRaw(env: NodeJS.ProcessEnv, names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value.trim() !== "") {
      return value.trim();
    }
  }
  return undefined;
}

function input(
  env: NodeJS.ProcessEnv,
  actionName: string,
  fallbacks: string[],
): string | undefined {
  const upper = actionName.toUpperCase();
  return readRaw(env, [`INPUT_${upper}`, `INPUT_${upper.replace(/-/g, "_")}`, ...fallbacks]);
}

function parseBool(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n"].includes(normalized)) {
    return false;
  }
  throw new InputError(`${name} must be true or false.`);
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  min: number,
  max: number,
): number {
  const raw = value ?? String(fallback);
  if (!/^-?\d+$/.test(raw)) {
    throw new InputError(`${name} must be an integer.`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new InputError(`${name} must be between ${min} and ${max}.`);
  }
  return parsed;
}

function parseTemperature(value: string | undefined): number {
  const raw = value ?? "0.2";
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new InputError("PR_SUMMARY_TEMPERATURE must be a number from 0 to 2.");
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) {
    throw new InputError("PR_SUMMARY_TEMPERATURE must be a number from 0 to 2.");
  }
  return parsed;
}

function parseBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InputError(`base-url is not a valid URL: ${value}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new InputError("base-url must use http or https.");
  }
  if (url.username || url.password) {
    throw new InputError("base-url must not include a username or password.");
  }
  return value.replace(/\/+$/, "");
}

function parseChoice<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
  name: string,
): T {
  const raw = (value ?? fallback).toLowerCase();
  const match = allowed.find((item) => item === raw);
  if (!match) {
    throw new InputError(`${name} must be one of: ${allowed.join(", ")}.`);
  }
  return match;
}

function flagOrInput(
  flags: CliFlags,
  key: keyof CliFlags,
  env: NodeJS.ProcessEnv,
  actionName: string,
  fallbacks: string[],
): string | undefined {
  const flag = flags[key];
  if (flag !== undefined && flag.trim() !== "") {
    return flag.trim();
  }
  return input(env, actionName, fallbacks);
}

export function inferFailOnError(runtime: Runtime): boolean {
  try {
    const args = runtime.kind === "cli" ? parseArgs(runtime.argv) : null;
    const raw =
      args?.flags.failOnError ?? input(runtime.env, "fail-on-error", ["PR_SUMMARY_FAIL_ON_ERROR"]);
    return parseBool(raw, runtime.kind === "cli", "fail-on-error");
  } catch {
    return true;
  }
}

export function loadConfig(runtime: Runtime): AppConfig {
  const args = runtime.kind === "cli" ? parseArgs(runtime.argv) : null;
  const flags = args?.flags ?? {};
  const env = runtime.env;
  const language = parseChoice(
    flagOrInput(flags, "language", env, "language", ["PR_SUMMARY_LANGUAGE"]),
    LANGUAGES,
    "en",
    "language",
  ) satisfies Language;
  const mode = parseChoice(
    flagOrInput(flags, "mode", env, "mode", ["PR_SUMMARY_MODE"]),
    MODES,
    "summary",
    "mode",
  ) satisfies Mode;
  const maxDiffChars = parseInteger(
    flagOrInput(flags, "maxDiffChars", env, "max-diff-chars", ["PR_SUMMARY_MAX_DIFF_CHARS"]),
    60_000,
    "max-diff-chars",
    1000,
    500_000,
  );
  const baseUrl = parseBaseUrl(
    flagOrInput(flags, "baseUrl", env, "base-url", ["PR_SUMMARY_BASE_URL"]) ??
      "https://api.openai.com/v1",
  );
  const model = flagOrInput(flags, "model", env, "model", ["PR_SUMMARY_MODEL"]) ?? "gpt-4o-mini";
  if (model.length > 200) {
    throw new InputError("model must be at most 200 characters.");
  }
  const ignoreRaw = flagOrInput(flags, "ignorePaths", env, "ignore-paths", [
    "PR_SUMMARY_IGNORE_PATHS",
  ]);
  const ignorePaths = parseIgnoreList(ignoreRaw, DEFAULT_IGNORE_PATHS);
  const apiKey = flagOrInput(flags, "apiKey", env, "api-key", ["PR_SUMMARY_API_KEY"]) ?? null;
  const githubToken =
    input(env, "github-token", ["GITHUB_TOKEN", "PR_SUMMARY_GITHUB_TOKEN"]) ?? null;
  const dryRunInput = parseBool(input(env, "dry-run", ["PR_SUMMARY_DRY_RUN"]), false, "dry-run");
  const dryRun = runtime.kind === "cli" ? true : dryRunInput;
  const failOnError = parseBool(
    flagOrInput(flags, "failOnError", env, "fail-on-error", ["PR_SUMMARY_FAIL_ON_ERROR"]),
    runtime.kind === "cli",
    "fail-on-error",
  );
  const chunkChars = Math.min(
    maxDiffChars,
    parseInteger(
      input(env, "chunk-chars", ["PR_SUMMARY_CHUNK_CHARS"]),
      12_000,
      "PR_SUMMARY_CHUNK_CHARS",
      500,
      500_000,
    ),
  );
  const config: AppConfig = {
    apiKey,
    baseUrl,
    model,
    language,
    maxDiffChars,
    ignorePaths,
    mode,
    dryRun,
    failOnError,
    githubToken,
    githubRepository: readRaw(env, ["GITHUB_REPOSITORY"]) ?? null,
    githubApiUrl: (readRaw(env, ["GITHUB_API_URL"]) ?? "https://api.github.com").replace(
      /\/+$/,
      "",
    ),
    eventName: readRaw(env, ["GITHUB_EVENT_NAME"]) ?? null,
    eventPath: readRaw(env, ["GITHUB_EVENT_PATH"]) ?? null,
    diffFile: flags.diffFile ?? null,
    commitsFile: flags.commitsFile ?? null,
    fixtureTitle: flags.title ?? "Fixture pull request",
    showRedactedDiff: args?.showRedactedDiff ?? false,
    jsonOutput: args?.json ?? false,
    maxRetries: parseInteger(
      readRaw(env, ["PR_SUMMARY_MAX_RETRIES"]),
      3,
      "PR_SUMMARY_MAX_RETRIES",
      0,
      8,
    ),
    retryBaseMs: parseInteger(
      readRaw(env, ["PR_SUMMARY_RETRY_BASE_MS"]),
      400,
      "PR_SUMMARY_RETRY_BASE_MS",
      0,
      60_000,
    ),
    minIntervalMs: parseInteger(
      readRaw(env, ["PR_SUMMARY_MIN_INTERVAL_MS"]),
      250,
      "PR_SUMMARY_MIN_INTERVAL_MS",
      0,
      60_000,
    ),
    timeoutMs: parseInteger(
      readRaw(env, ["PR_SUMMARY_TIMEOUT_MS"]),
      60_000,
      "PR_SUMMARY_TIMEOUT_MS",
      1000,
      300_000,
    ),
    chunkChars,
    maxChunks: parseInteger(
      readRaw(env, ["PR_SUMMARY_MAX_CHUNKS"]),
      6,
      "PR_SUMMARY_MAX_CHUNKS",
      1,
      20,
    ),
    maxOutputTokens: parseInteger(
      readRaw(env, ["PR_SUMMARY_MAX_OUTPUT_TOKENS"]),
      1800,
      "PR_SUMMARY_MAX_OUTPUT_TOKENS",
      64,
      8000,
    ),
    temperature: parseTemperature(readRaw(env, ["PR_SUMMARY_TEMPERATURE"])),
    jsonMode: parseBool(readRaw(env, ["PR_SUMMARY_JSON_MODE"]), true, "PR_SUMMARY_JSON_MODE"),
    maxCommentChars: parseInteger(
      readRaw(env, ["PR_SUMMARY_MAX_COMMENT_CHARS"]),
      60_000,
      "PR_SUMMARY_MAX_COMMENT_CHARS",
      1000,
      65_000,
    ),
    maxFiles: parseInteger(
      readRaw(env, ["PR_SUMMARY_MAX_FILES"]),
      300,
      "PR_SUMMARY_MAX_FILES",
      1,
      3000,
    ),
    maxCommits: parseInteger(
      readRaw(env, ["PR_SUMMARY_MAX_COMMITS"]),
      50,
      "PR_SUMMARY_MAX_COMMITS",
      1,
      200,
    ),
    maxBodyChars: parseInteger(
      readRaw(env, ["PR_SUMMARY_MAX_BODY_CHARS"]),
      4000,
      "PR_SUMMARY_MAX_BODY_CHARS",
      200,
      20_000,
    ),
    kind: runtime.kind,
  };

  if (runtime.kind === "cli" && !config.diffFile) {
    throw new InputError("--diff-file is required.");
  }
  if (runtime.kind === "action") {
    if (config.eventName !== "pull_request") {
      throw new InputError(
        "This action only supports the pull_request event. pull_request_target is intentionally unsupported.",
      );
    }
    if (!config.eventPath) {
      throw new InputError("GITHUB_EVENT_PATH is required.");
    }
    if (!config.githubRepository) {
      throw new InputError("GITHUB_REPOSITORY is required.");
    }
    if (!config.githubToken) {
      throw new InputError("github-token is required to read the pull request.");
    }
  }
  if (!config.dryRun && !config.apiKey) {
    throw new InputError("api-key is required when dry-run is false.");
  }
  if (!config.dryRun && !config.githubToken) {
    throw new InputError("github-token is required when dry-run is false.");
  }
  return config;
}
