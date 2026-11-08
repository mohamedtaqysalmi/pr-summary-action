import { InputError } from "../errors.js";
import { isRecord } from "../text.js";
import type { CommitRecord, PullContext } from "../types.js";

export function parseRepository(repository: string): { owner: string; repo: string } {
  const parts = repository.split("/");
  const owner = parts[0];
  const repo = parts[1];
  if (parts.length !== 2 || !owner || !repo || owner.includes("..") || repo.includes("..")) {
    throw new InputError("GITHUB_REPOSITORY must be owner/repo.");
  }
  return { owner, repo };
}

export function readPullEvent(raw: string, repository: string | null): PullContext {
  if (!repository) {
    throw new InputError("GITHUB_REPOSITORY is required.");
  }
  const { owner, repo } = parseRepository(repository);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new InputError("GITHUB_EVENT_PATH did not contain JSON.");
  }
  if (!isRecord(parsed) || !isRecord(parsed.pull_request)) {
    throw new InputError("The event payload is missing pull_request.");
  }
  const pull = parsed.pull_request;
  if (typeof pull.number !== "number" || !Number.isInteger(pull.number) || pull.number <= 0) {
    throw new InputError("pull_request.number is missing.");
  }
  return {
    source: "github",
    owner,
    repo,
    number: pull.number,
    title: typeof pull.title === "string" ? pull.title : "",
    body: typeof pull.body === "string" ? pull.body : "",
  };
}

export function readCommitsFile(raw: string): CommitRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new InputError("Commits file did not contain JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new InputError("Commits file must be a JSON array.");
  }
  return parsed.map((entry) => {
    if (!isRecord(entry) || typeof entry.sha !== "string" || typeof entry.message !== "string") {
      throw new InputError("Each commit must have sha and message strings.");
    }
    return { sha: entry.sha, message: entry.message };
  });
}
