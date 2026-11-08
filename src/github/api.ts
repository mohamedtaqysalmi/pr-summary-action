import { ActionError, CommentError, DiffError, InputError } from "../errors.js";
import { fetchWithRetry, type RetryPolicy } from "../http/retry.js";
import { isRecord } from "../text.js";
import type { CommitRecord, DiffFile } from "../types.js";
import { diffFileFromGitHub } from "../diff/github-files.js";

export interface GitHubClientOptions {
  fetch: typeof fetch;
  apiBase: string;
  token: string;
  policy: RetryPolicy;
  limiter: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  redact: (text: string) => string;
}

interface PageOptions extends GitHubClientOptions {
  cap: number;
}

function apiUrl(base: string): URL {
  try {
    const url = new URL(base);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new InputError("GitHub API URL must use http or https.");
    }
    return url;
  } catch (error) {
    if (error instanceof InputError) {
      throw error;
    }
    throw new InputError("GitHub API URL is not valid.");
  }
}

function joinApi(base: string, pathAndQuery: string): URL {
  const url = apiUrl(base);
  const prefix = url.pathname.replace(/\/+$/, "");
  const relative = new URL(pathAndQuery, "https://placeholder.local");
  url.pathname = `${prefix}${relative.pathname}`;
  url.search = relative.search;
  return url;
}

function headers(token: string): Headers {
  return new Headers({
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "pr-summary-action",
    "X-GitHub-Api-Version": "2022-11-28",
  });
}

function nextLink(header: string | null, apiBase: string): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(",")) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(part);
    const value = match?.[1];
    if (!value) {
      continue;
    }
    let next: URL;
    try {
      next = new URL(value);
    } catch {
      throw new DiffError("GitHub pagination link was not a valid URL.");
    }
    const base = apiUrl(apiBase);
    if (next.origin !== base.origin) {
      throw new DiffError("Refusing to follow a GitHub pagination link to another origin.");
    }
    if (next.protocol !== "https:" && next.protocol !== "http:") {
      throw new DiffError("Refusing a non-HTTP GitHub pagination link.");
    }
    return next.toString();
  }
  return null;
}

async function getPages(url: string, options: PageOptions): Promise<unknown[]> {
  const items: unknown[] = [];
  let page: string | null = url;
  while (page) {
    const response = await fetchWithRetry({
      fetch: options.fetch,
      url: page,
      init: { method: "GET", headers: headers(options.token) },
      policy: { ...options.policy, retryUnsafe: false },
      limiter: options.limiter,
      sleep: options.sleep,
      now: options.now,
      redact: options.redact,
      label: "GitHub",
    });
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new DiffError("GitHub returned a response that was not a JSON array.");
    }
    const entries = payload.map((entry: unknown) => entry);
    items.push(...entries);
    if (items.length >= options.cap) {
      return items.slice(0, options.cap);
    }
    page = nextLink(response.headers.get("link"), options.apiBase);
  }
  return items;
}

export async function listPullFiles(
  owner: string,
  repo: string,
  number: number,
  options: PageOptions,
): Promise<DiffFile[]> {
  const url = joinApi(
    options.apiBase,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/files?per_page=100`,
  );
  const pages = await getPages(url.toString(), options);
  return pages.map((entry) => diffFileFromGitHub(entry));
}

export async function listPullCommits(
  owner: string,
  repo: string,
  number: number,
  options: PageOptions,
): Promise<CommitRecord[]> {
  const url = joinApi(
    options.apiBase,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/commits?per_page=100`,
  );
  const pages = await getPages(url.toString(), options);
  return pages.map((entry) => {
    if (!isRecord(entry) || typeof entry.sha !== "string" || !isRecord(entry.commit)) {
      throw new DiffError("GitHub commit list contained an unexpected entry.");
    }
    const message = entry.commit.message;
    if (typeof message !== "string") {
      throw new DiffError("GitHub commit list contained a commit without a message.");
    }
    return { sha: entry.sha, message };
  });
}

export interface IssueComment {
  id: number;
  body: string;
}

export async function listIssueComments(
  owner: string,
  repo: string,
  number: number,
  options: PageOptions,
): Promise<IssueComment[]> {
  const url = joinApi(
    options.apiBase,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/comments?per_page=100`,
  );
  const pages = await getPages(url.toString(), options);
  const comments: IssueComment[] = [];
  for (const entry of pages) {
    if (!isRecord(entry) || typeof entry.id !== "number") {
      throw new CommentError("GitHub comment list contained an unexpected entry.");
    }
    comments.push({ id: entry.id, body: typeof entry.body === "string" ? entry.body : "" });
  }
  return comments;
}

async function sendComment(
  method: "POST" | "PATCH",
  url: string,
  body: string,
  options: GitHubClientOptions,
): Promise<number> {
  const response = await fetchWithRetry({
    fetch: options.fetch,
    url,
    init: {
      method,
      headers: headers(options.token),
      body: JSON.stringify({ body }),
    },
    policy: { ...options.policy, retryUnsafe: false },
    limiter: options.limiter,
    sleep: options.sleep,
    now: options.now,
    redact: options.redact,
    label: "GitHub comment",
  });
  const payload: unknown = await response.json();
  if (!isRecord(payload) || typeof payload.id !== "number") {
    throw new CommentError("GitHub did not return a comment id.");
  }
  return payload.id;
}

export async function createIssueComment(
  owner: string,
  repo: string,
  number: number,
  body: string,
  options: GitHubClientOptions,
): Promise<number> {
  const url = joinApi(
    options.apiBase,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${number}/comments`,
  );
  try {
    return await sendComment("POST", url.toString(), body, options);
  } catch (error) {
    if (error instanceof ActionError && /HTTP 403/.test(error.message)) {
      throw new CommentError(
        `${error.message} pull-requests: write is required when dry-run is false.`,
      );
    }
    throw error;
  }
}

export async function updateIssueComment(
  owner: string,
  repo: string,
  commentId: number,
  body: string,
  options: GitHubClientOptions,
): Promise<number> {
  const url = joinApi(
    options.apiBase,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/comments/${commentId}`,
  );
  return sendComment("PATCH", url.toString(), body, options);
}
