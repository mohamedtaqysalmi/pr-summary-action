import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execute } from "../src/execute.js";
import { captureRuntime } from "./helpers/runtime.js";
import { SAMPLE_COMMITS, SAMPLE_FILES, startMock } from "./helpers/server.js";

const SECRET = "AKIAIOSFODNN7EXAMPLE";
const TOKEN = `ghp_${"a".repeat(36)}`;
const SENTINEL = "LOCKFILE_SENTINEL_DO_NOT_SEND";

function tuning(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PR_SUMMARY_MIN_INTERVAL_MS: "0",
    PR_SUMMARY_MAX_RETRIES: "1",
    PR_SUMMARY_RETRY_BASE_MS: "0",
    PR_SUMMARY_TIMEOUT_MS: "5000",
    ...extra,
  };
}

describe("keyless fixture CLI", () => {
  it("redacts, ignores, and does not call a model or post a comment", async () => {
    const captured = captureRuntime({
      argv: [
        "dry-run",
        "--diff-file",
        "tests/fixtures/sample.diff",
        "--commits-file",
        "tests/fixtures/commits.json",
        "--language",
        "en",
        "--mode",
        "full",
        "--json",
      ],
      env: tuning(),
    });
    const outcome = await execute(captured.runtime);
    expect(outcome.exitCode).toBe(0);
    const report = JSON.parse(captured.stdout()) as {
      llmCalled: boolean;
      commentPosted: boolean;
      files: { kept: string[]; ignored: string[] };
      redactions: { kind: string; count: number }[];
      commentBody: string;
      commits: { sha: string; ok: boolean }[];
    };
    expect(report.llmCalled).toBe(false);
    expect(report.commentPosted).toBe(false);
    expect(report.files.ignored).toContain("package-lock.json");
    expect(report.files.kept).toContain("src/auth/session.ts");
    expect(report.redactions.map((hit) => hit.kind)).toEqual(
      expect.arrayContaining(["aws-access-key-id", "github-token", "assigned-secret"]),
    );
    expect(report.commentBody).toContain("<!-- pr-summary-action:v1 -->");
    expect(outcome.result?.redactedDiff).toContain("password flow");
    expect(outcome.result?.redactedDiff).not.toContain(SECRET);
    expect(captured.stdout()).not.toContain(SECRET);
    expect(captured.stdout()).not.toContain(TOKEN);
    expect(captured.stdout()).not.toContain(SENTINEL);
    expect(captured.stdout()).not.toContain("hunter2hunter2");
    expect(report.commits.some((commit) => commit.ok)).toBe(true);
    expect(report.commits.some((commit) => !commit.ok)).toBe(true);
  });

  it("renders French and Darija headings without a model", async () => {
    for (const language of ["fr", "darija"] as const) {
      const captured = captureRuntime({
        argv: [
          "dry-run",
          "--diff-file",
          "tests/fixtures/sample.diff",
          "--language",
          language,
          "--mode",
          "summary",
          "--json",
        ],
        env: tuning(),
      });
      const outcome = await execute(captured.runtime);
      expect(outcome.exitCode).toBe(0);
      const report = JSON.parse(captured.stdout()) as { commentBody: string };
      if (language === "fr") {
        expect(report.commentBody).toContain("Résumé");
      } else {
        expect(report.commentBody).toContain('dir="rtl"');
        expect(report.commentBody).toContain("الملخص");
      }
    }
  });

  it("exits zero on a bad language only when fail-on-error is false", async () => {
    const failing = captureRuntime({
      argv: ["dry-run", "--diff-file", "tests/fixtures/sample.diff", "--language", "de"],
    });
    expect((await execute(failing.runtime)).exitCode).toBe(1);
    const graceful = captureRuntime({
      argv: [
        "dry-run",
        "--diff-file",
        "tests/fixtures/sample.diff",
        "--language",
        "de",
        "--fail-on-error",
        "false",
      ],
    });
    expect((await execute(graceful.runtime)).exitCode).toBe(0);
    expect(graceful.stderr()).toContain("warning:");
  });
});

describe("action with a mocked GitHub and model", () => {
  it("upserts one marker comment and never sends ignored or raw secret text", async () => {
    const mock = await startMock({ files: SAMPLE_FILES, commits: SAMPLE_COMMITS });
    const dir = mkdtempSync(join(tmpdir(), "pr-summary-event-"));
    const eventPath = join(dir, "event.json");
    writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: { number: 7, title: "Shorten session TTL", body: "Please review." },
      }),
    );
    const env = tuning({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: "acme/widgets",
      GITHUB_API_URL: mock.url,
      GITHUB_TOKEN: "github-test-token",
      "INPUT_API-KEY": "sk-test-key-not-real",
      "INPUT_BASE-URL": `${mock.url}/v1`,
      INPUT_MODEL: "mock-model",
      INPUT_LANGUAGE: "en",
      INPUT_MODE: "full",
      "INPUT_DRY-RUN": "false",
      "INPUT_FAIL-ON-ERROR": "true",
      "INPUT_MAX-DIFF-CHARS": "60000",
    });
    const first = captureRuntime({ kind: "action", env });
    const created = await execute(first.runtime);
    expect(created.exitCode).toBe(0);
    expect(created.result?.commentCreated).toBe(true);
    expect(first.outputs.get("comment-id")).toBe("1");
    expect(first.outputs.get("llm-called")).toBe("true");
    expect(first.outputs.get("skipped")).toBe("false");
    expect(mock.comments).toHaveLength(1);
    expect(mock.comments[0]?.body).toContain("<!-- pr-summary-action:v1 -->");
    expect(mock.comments[0]?.body).toContain("fifteen minutes");

    const llm = mock.requests.filter((request) => request.path.endsWith("/chat/completions"));
    const github = mock.requests.filter((request) => !request.path.endsWith("/chat/completions"));
    expect(llm.length).toBeGreaterThan(0);
    expect(llm.every((request) => request.authorization === "Bearer sk-test-key-not-real")).toBe(
      true,
    );
    expect(github.every((request) => request.authorization === "Bearer github-test-token")).toBe(
      true,
    );
    for (const request of llm) {
      expect(request.body).not.toContain(SECRET);
      expect(request.body).not.toContain(TOKEN);
      expect(request.body).not.toContain(SENTINEL);
      expect(request.body).not.toContain("github-test-token");
    }
    for (const request of github) {
      expect(request.body).not.toContain("sk-test-key-not-real");
    }
    expect(mock.comments[0]?.body).not.toContain(SECRET);
    expect(mock.comments[0]?.body).not.toContain(TOKEN);

    const second = captureRuntime({ kind: "action", env });
    const updated = await execute(second.runtime);
    expect(updated.exitCode).toBe(0);
    expect(updated.result?.commentCreated).toBe(false);
    expect(mock.comments).toHaveLength(1);
    const posts = mock.requests.filter(
      (request) => request.method === "POST" && request.path.endsWith("/comments"),
    );
    const patches = mock.requests.filter((request) => request.method === "PATCH");
    expect(posts).toHaveLength(1);
    expect(patches.length).toBeGreaterThan(0);
    await mock.close();
  });

  it("does not post when dry-run is true, and skips the model without a key", async () => {
    const mock = await startMock({ files: SAMPLE_FILES, commits: [] });
    const dir = mkdtempSync(join(tmpdir(), "pr-summary-dry-"));
    const eventPath = join(dir, "event.json");
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: 3, title: "Docs", body: "" } }),
    );
    const withKey = captureRuntime({
      kind: "action",
      env: tuning({
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: "acme/widgets",
        GITHUB_API_URL: mock.url,
        GITHUB_TOKEN: "github-test-token",
        "INPUT_API-KEY": "sk-test-key-not-real",
        "INPUT_BASE-URL": `${mock.url}/v1`,
        INPUT_MODE: "summary",
        "INPUT_DRY-RUN": "true",
        "INPUT_FAIL-ON-ERROR": "true",
      }),
    });
    expect((await execute(withKey.runtime)).result?.llmCalled).toBe(true);
    expect(mock.comments).toHaveLength(0);

    const noKey = captureRuntime({
      kind: "action",
      env: tuning({
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: "acme/widgets",
        GITHUB_API_URL: mock.url,
        GITHUB_TOKEN: "github-test-token",
        "INPUT_BASE-URL": `${mock.url}/v1`,
        INPUT_MODE: "summary",
        "INPUT_DRY-RUN": "true",
        "INPUT_FAIL-ON-ERROR": "true",
      }),
    });
    const before = mock.requests.length;
    const skipped = await execute(noKey.runtime);
    expect(skipped.result?.llmCalled).toBe(false);
    expect(skipped.result?.llmSkipReason).toBe("no-api-key");
    expect(mock.requests.slice(before).some((request) => request.method === "POST")).toBe(false);
    await mock.close();
  });

  it("stays quiet when the model fails and fail-on-error is false", async () => {
    const mock = await startMock({
      files: SAMPLE_FILES,
      commits: [],
      llmStatus: [401],
      llmBodies: ["unauthorized"],
    });
    const dir = mkdtempSync(join(tmpdir(), "pr-summary-fail-"));
    const eventPath = join(dir, "event.json");
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: 4, title: "Fix", body: "" } }),
    );
    const captured = captureRuntime({
      kind: "action",
      env: tuning({
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: "acme/widgets",
        GITHUB_API_URL: mock.url,
        GITHUB_TOKEN: "github-test-token",
        "INPUT_API-KEY": "sk-test-key-not-real",
        "INPUT_BASE-URL": `${mock.url}/v1`,
        INPUT_MODE: "summary",
        "INPUT_DRY-RUN": "false",
        "INPUT_FAIL-ON-ERROR": "false",
      }),
    });
    const outcome = await execute(captured.runtime);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.error).toMatch(/401/);
    expect(captured.outputs.get("skipped")).toBe("true");
    expect(captured.stderr()).toContain("::warning::");
    expect(mock.comments).toHaveLength(0);
    await mock.close();
  });

  it("redacts a secret that the model echoes", async () => {
    const mock = await startMock({
      files: [
        {
          filename: "README.md",
          status: "modified",
          additions: 1,
          deletions: 0,
          patch: "@@ -1 +1,2 @@\n+hello\n",
        },
      ],
      llmBodies: [
        JSON.stringify({
          summary: `The key is ${SECRET}`,
          areas: [],
          risks: [],
          testPlan: [],
        }),
      ],
    });
    const dir = mkdtempSync(join(tmpdir(), "pr-summary-echo-"));
    const eventPath = join(dir, "event.json");
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: 8, title: "Echo", body: "" } }),
    );
    const captured = captureRuntime({
      kind: "action",
      env: tuning({
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: "acme/widgets",
        GITHUB_API_URL: mock.url,
        GITHUB_TOKEN: "github-test-token",
        "INPUT_API-KEY": "sk-test-key-not-real",
        "INPUT_BASE-URL": `${mock.url}/v1`,
        INPUT_MODE: "summary",
        "INPUT_DRY-RUN": "false",
        "INPUT_FAIL-ON-ERROR": "true",
      }),
    });
    const outcome = await execute(captured.runtime);
    expect(outcome.exitCode).toBe(0);
    expect(mock.comments[0]?.body).not.toContain(SECRET);
    expect(mock.comments[0]?.body).toContain("[REDACTED:aws-access-key-id]");
    await mock.close();
  });
});
