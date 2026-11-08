import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { upsertMarkerComment } from "../src/comment/upsert.js";
import { createIssueComment, listPullFiles } from "../src/github/api.js";
import { readCommitsFile, readPullEvent } from "../src/github/event.js";
import { fetchWithRetry } from "../src/http/retry.js";
import { chatComplete } from "../src/llm/client.js";
import { execute } from "../src/execute.js";
import { createRuntime } from "../src/runtime.js";
import { MARKER } from "../src/version.js";
import { captureRuntime } from "./helpers/runtime.js";
import { startMock } from "./helpers/server.js";

const policy = { maxRetries: 1, retryBaseMs: 0, timeoutMs: 1000, retryUnsafe: false };

function tuning(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PR_SUMMARY_MIN_INTERVAL_MS: "0",
    PR_SUMMARY_MAX_RETRIES: "1",
    PR_SUMMARY_RETRY_BASE_MS: "0",
    PR_SUMMARY_TIMEOUT_MS: "5000",
    ...extra,
  };
}

describe("CLI surface", () => {
  it("prints help and rejects an unknown command", async () => {
    const help = captureRuntime({ argv: ["--help"] });
    expect((await execute(help.runtime)).exitCode).toBe(0);
    expect(help.stdout()).toContain("never creates");
    const unknown = captureRuntime({ argv: ["publish"] });
    expect((await execute(unknown.runtime)).exitCode).toBe(1);
    expect(unknown.stderr()).toContain("error:");
  });

  it("prints the human report and a redacted diff", async () => {
    const captured = captureRuntime({
      argv: [
        "dry-run",
        "--diff-file",
        "tests/fixtures/sample.diff",
        "--commits-file",
        "tests/fixtures/commits.json",
        "--mode",
        "full",
        "--show-redacted-diff",
      ],
      env: tuning(),
    });
    const outcome = await execute(captured.runtime);
    expect(outcome.exitCode).toBe(0);
    expect(captured.stdout()).toContain("comment body (not posted)");
    expect(captured.stdout()).toContain("pr-summary-action 0.1.0");
    expect(captured.stderr()).toContain("--- redacted diff ---");
    expect(captured.stderr()).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(outcome.result?.llmCalled).toBe(false);
  });
});

describe("multi-chunk model synthesis", () => {
  it("summarizes each chunk and then combines them", async () => {
    const dual = JSON.stringify({
      notes: "partial",
      summary: "Combined from chunks.",
      areas: [{ area: "src", changes: "Several files changed." }],
      risks: ["Review the boundary."],
      testPlan: ["Run unit tests."],
      conventionalTitle: "feat: cover chunks",
      commitReviews: [],
    });
    const mock = await startMock({ llmBodies: [dual] });
    const dir = mkdtempSync(join(tmpdir(), "pr-summary-chunks-"));
    const diffFile = join(dir, "big.diff");
    const body = "word ".repeat(80);
    writeFileSync(
      diffFile,
      ["a.ts", "b.ts", "c.ts"]
        .map(
          (name) =>
            `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -0,0 +1 @@\n+${name} ${body}\n`,
        )
        .join(""),
    );
    const captured = captureRuntime({
      argv: [
        "dry-run",
        "--diff-file",
        diffFile,
        "--mode",
        "full",
        "--json",
        "--api-key",
        "sk-test-key-not-real",
      ],
      env: tuning({
        PR_SUMMARY_BASE_URL: `${mock.url}/v1`,
        PR_SUMMARY_CHUNK_CHARS: "500",
        PR_SUMMARY_MODEL: "mock-model",
      }),
    });
    const outcome = await execute(captured.runtime);
    expect(outcome.exitCode).toBe(0);
    expect(captured.stderr()).toContain("visible in the process list");
    expect(outcome.result?.llmCalled).toBe(true);
    expect(outcome.result?.chunkCount).toBeGreaterThan(1);
    expect(outcome.result?.summary).toContain("Combined");
    const chats = mock.requests.filter((request) => request.path.endsWith("/chat/completions"));
    expect(chats.length).toBeGreaterThan(2);
    expect(mock.comments).toHaveLength(0);
    await mock.close();
  });

  it("repairs one invalid JSON response", async () => {
    const mock = await startMock({
      files: [
        {
          filename: "README.md",
          status: "modified",
          additions: 1,
          deletions: 0,
          patch: "@@ -1 +1 @@\n+hello\n",
        },
      ],
      llmBodies: [
        "not json",
        JSON.stringify({
          summary: "Repaired.",
          areas: [],
          risks: [],
          testPlan: [],
        }),
      ],
    });
    const dir = mkdtempSync(join(tmpdir(), "pr-summary-repair-"));
    const eventPath = join(dir, "event.json");
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: 2, title: "Repair", body: "" } }),
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
        "INPUT_DRY-RUN": "true",
        "INPUT_FAIL-ON-ERROR": "true",
      }),
    });
    const outcome = await execute(captured.runtime);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.result?.summary).toBe("Repaired.");
    expect(
      mock.requests.filter((request) => request.path.endsWith("/chat/completions")),
    ).toHaveLength(2);
    await mock.close();
  });
});

describe("GitHub comment recovery", () => {
  it("updates a marker comment when create fails after the comment exists", async () => {
    const comments: { id: number; body: string }[] = [];
    const fetchMock: typeof fetch = (_input, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET") {
        return Promise.resolve(new Response(JSON.stringify(comments), { status: 200 }));
      }
      if (method === "POST") {
        const raw = typeof init?.body === "string" ? init.body : "";
        const parsed = JSON.parse(raw) as { body: string };
        comments.push({ id: 9, body: parsed.body });
        return Promise.resolve(new Response("lost response", { status: 500 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ id: 9, body: "ok" }), { status: 200 }));
    };
    const options = {
      fetch: fetchMock,
      apiBase: "https://api.github.com",
      token: "github-test-token",
      policy,
      limiter: async () => {},
      sleep: async () => {},
      now: () => 0,
      redact: (text: string) => text,
    };
    const result = await upsertMarkerComment("acme", "widgets", 1, `${MARKER}\nhello`, options);
    expect(result.created).toBe(false);
    expect(result.id).toBe(9);
  });

  it("explains a missing pull-requests write permission", async () => {
    const fetchMock: typeof fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "Resource not accessible" }), { status: 403 }),
      );
    await expect(
      createIssueComment("acme", "widgets", 1, "body", {
        fetch: fetchMock,
        apiBase: "https://api.github.com",
        token: "github-test-token",
        policy,
        limiter: async () => {},
        sleep: async () => {},
        now: () => 0,
        redact: (text: string) => text,
      }),
    ).rejects.toThrow(/pull-requests: write/);
  });

  it("follows a same-origin pagination link", async () => {
    let port = 0;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (!url.searchParams.has("page")) {
        const next = `http://127.0.0.1:${port}/repos/acme/widgets/pulls/1/files?page=2`;
        res.writeHead(200, { "content-type": "application/json", link: `<${next}>; rel="next"` });
        res.end(
          JSON.stringify([
            { filename: "a.ts", status: "added", additions: 1, deletions: 0, patch: "@@\n+a\n" },
          ]),
        );
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify([
          {
            filename: "b.ts",
            status: "modified",
            additions: 1,
            deletions: 1,
            previous_filename: "old.ts",
            patch: "@@\n-a\n+b\n",
          },
        ]),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("no port");
    }
    port = address.port;
    const files = await listPullFiles("acme", "widgets", 1, {
      fetch: globalThis.fetch,
      apiBase: `http://127.0.0.1:${port}`,
      token: "t",
      policy,
      limiter: async () => {},
      sleep: async () => {},
      now: () => 0,
      redact: (text: string) => text,
      cap: 10,
    });
    expect(files.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
});

describe("model compatibility and event parsing", () => {
  it("switches max_tokens and drops temperature when the provider rejects them", async () => {
    const bodies: string[] = [];
    let calls = 0;
    const fetchMock: typeof fetch = (_input, init) => {
      calls += 1;
      bodies.push(typeof init?.body === "string" ? init.body : "");
      if (calls === 1) {
        return Promise.resolve(new Response("unsupported max_tokens", { status: 400 }));
      }
      if (calls === 2) {
        return Promise.resolve(new Response("unsupported temperature", { status: 400 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: "ok" }] } }] }),
          { status: 200 },
        ),
      );
    };
    const content = await chatComplete(
      {
        fetch: fetchMock,
        baseUrl: "http://127.0.0.1/v1/",
        apiKey: "sk-test",
        model: "mock",
        temperature: 0.2,
        maxOutputTokens: 32,
        policy: { maxRetries: 0, retryBaseMs: 0, timeoutMs: 1000, retryUnsafe: true },
        limiter: async () => {},
        sleep: async () => {},
        now: () => 0,
        redact: (text) => text,
        session: { jsonMode: false, tokenField: "max_tokens", sendTemperature: true },
      },
      [{ role: "user", content: "hi" }],
    );
    expect(content).toBe("ok");
    expect(bodies[1]).toContain("max_completion_tokens");
    expect(bodies[2]).not.toContain("temperature");
  });

  it("retries a dropped network connection", async () => {
    let calls = 0;
    const response = await fetchWithRetry({
      fetch: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(new Error("socket hang up"));
        }
        return Promise.resolve(new Response("ok", { status: 200 }));
      },
      url: "http://127.0.0.1/files",
      init: { method: "GET" },
      policy: { maxRetries: 1, retryBaseMs: 5, timeoutMs: 1000, retryUnsafe: false },
      limiter: async () => {},
      sleep: async () => {},
      now: () => 0,
      redact: (text) => text,
      label: "GitHub",
    });
    expect(response.status).toBe(200);
    expect(calls).toBe(2);
  });

  it("rejects malformed event and commit files", () => {
    expect(() => readPullEvent("{", "acme/widgets")).toThrow(/JSON/);
    expect(() => readPullEvent("{}", "acme/widgets")).toThrow(/pull_request/);
    expect(() => readPullEvent("{}", "acme")).toThrow(/owner\/repo/);
    expect(() => readCommitsFile("{}")).toThrow(/array/);
    expect(() => readCommitsFile("[{}]")).toThrow(/sha/);
  });
});

describe("runtime", () => {
  it("creates a runtime that can write outputs only when GITHUB_OUTPUT is set", () => {
    const previous = process.env.GITHUB_OUTPUT;
    delete process.env.GITHUB_OUTPUT;
    const runtime = createRuntime("cli");
    runtime.writeOutput("summary", "hidden");
    runtime.stdout("");
    runtime.stderr("");
    expect(runtime.kind).toBe("cli");
    if (previous === undefined) {
      delete process.env.GITHUB_OUTPUT;
    } else {
      process.env.GITHUB_OUTPUT = previous;
    }
  });
});
