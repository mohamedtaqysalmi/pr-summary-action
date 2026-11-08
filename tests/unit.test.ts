import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/args.js";
import { retryDelayMs, createRateLimiter } from "../src/http/limit.js";
import { fetchWithRetry } from "../src/http/retry.js";
import { lintCommitMessage, isConventionalTitle } from "../src/commits/lint.js";
import { globToRegExp, pathIgnored, parseIgnoreList } from "../src/diff/ignore.js";
import { parseUnifiedDiff } from "../src/diff/parse.js";
import { diffFileFromGitHub } from "../src/diff/github-files.js";
import { boundDiff } from "../src/diff/bound.js";
import { chunkDiff } from "../src/chunk.js";
import { redactText } from "../src/redact.js";
import { loadConfig } from "../src/config.js";
import { captureRuntime } from "./helpers/runtime.js";
import { parseModelSummary, stripFences } from "../src/llm/parse.js";
import { buildSystemPrompt } from "../src/llm/prompt.js";
import { chatComplete } from "../src/llm/client.js";
import { renderComment } from "../src/comment/render.js";
import { workflowCommand } from "../src/text.js";
import { writeGitHubOutput } from "../src/runtime.js";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiffError } from "../src/errors.js";
import { listPullFiles } from "../src/github/api.js";
import { createServer } from "node:http";

const GITHUB_TOKEN = `ghp_${"a".repeat(36)}`;
const AWS_KEY = "AKIAIOSFODNN7EXAMPLE";

describe("inputs", () => {
  it("accepts the documented languages and modes", () => {
    const { runtime } = captureRuntime({
      argv: [
        "dry-run",
        "--diff-file",
        "tests/fixtures/sample.diff",
        "--language",
        "FR",
        "--mode",
        "Full",
        "--max-diff-chars",
        "12000",
        "--base-url",
        "http://127.0.0.1:9/v1/",
      ],
    });
    const config = loadConfig(runtime);
    expect(config.language).toBe("fr");
    expect(config.mode).toBe("full");
    expect(config.maxDiffChars).toBe(12000);
    expect(config.baseUrl).toBe("http://127.0.0.1:9/v1");
    expect(config.dryRun).toBe(true);
    expect(config.failOnError).toBe(true);
  });

  it("rejects a live run without an api key", () => {
    const { runtime } = captureRuntime({
      kind: "action",
      env: {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: "/tmp/event.json",
        GITHUB_REPOSITORY: "acme/widgets",
        GITHUB_TOKEN: "token",
        INPUT_DRY_RUN: "false",
      },
    });
    expect(() => loadConfig(runtime)).toThrow(/api-key/);
  });

  it("rejects unsupported events and bad numbers", () => {
    const base = {
      GITHUB_EVENT_NAME: "pull_request_target",
      GITHUB_EVENT_PATH: "/tmp/event.json",
      GITHUB_REPOSITORY: "acme/widgets",
      GITHUB_TOKEN: "token",
    };
    expect(() => loadConfig(captureRuntime({ kind: "action", env: base }).runtime)).toThrow(
      /pull_request_target/,
    );
    expect(() =>
      loadConfig(
        captureRuntime({
          argv: ["dry-run", "--diff-file", "a.diff", "--language", "es"],
        }).runtime,
      ),
    ).toThrow(/language/);
    expect(() =>
      loadConfig(
        captureRuntime({
          argv: ["dry-run", "--diff-file", "a.diff", "--max-diff-chars", "10"],
        }).runtime,
      ),
    ).toThrow(/max-diff-chars/);
    expect(() =>
      loadConfig(
        captureRuntime({
          argv: ["dry-run", "--diff-file", "a.diff", "--base-url", "ftp://example.com"],
        }).runtime,
      ),
    ).toThrow(/http/);
    expect(() => parseArgs(["ship"])).toThrow(/dry-run/);
    expect(parseArgs(["--help"]).help).toBe(true);
  });
});

describe("ignore globs", () => {
  const cases: [string, string, boolean][] = [
    ["*.lock", "yarn.lock", true],
    ["*.lock", "dir/yarn.lock", true],
    ["*.lock", "package-lock.json", false],
    ["**/package-lock.json", "package-lock.json", true],
    ["**/package-lock.json", "nested/package-lock.json", true],
    ["**/dist/**", "dist/index.js", true],
    ["**/dist/**", "pkg/dist/index.js", true],
    ["dist/**", "pkg/dist/index.js", false],
    ["src/**/*.ts", "src/a.ts", true],
    ["src/**/*.ts", "src/a/b.ts", true],
    ["**/node_modules/**", "node_modules/left-pad/index.js", true],
  ];

  it.each(cases)("%s against %s", (pattern, path, expected) => {
    expect(pathIgnored(path, [globToRegExp(pattern)])).toBe(expected);
  });

  it("uses the fallback when the operator passes only comments", () => {
    expect(parseIgnoreList("# skip\n\n", ["*.lock"])).toEqual(["*.lock"]);
  });
});

describe("redaction", () => {
  it("removes common secret shapes and leaves ordinary prose", () => {
    const input = [
      "Reset the user password flow after rotation.",
      `token ${GITHUB_TOKEN}`,
      `aws ${AWS_KEY}`,
      'api_key = "supersecretvalue"',
      "Bearer abcdefghijklmnop",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIBogIBAAJBALFake\n-----END RSA PRIVATE KEY-----",
      "sk-proj-abcdefghijklmnopqrstuvwxyz",
      "xoxb-1234567890-abcdefghij",
      "sk_live_1234567890abcdef",
      "AIzaSyA1234567890abcdefghijklmnopqrstuv",
      "npm_1234567890abcdefghijklmnop1234567890",
      "github_pat_11AAAAAAA0abcdefghijklmnopqrstuvwxyz",
      "Basic dXNlcjpwYXNzd29yZA==",
    ].join("\n");
    const redacted = redactText(input);
    expect(redacted.text).not.toContain(GITHUB_TOKEN);
    expect(redacted.text).not.toContain(AWS_KEY);
    expect(redacted.text).not.toContain("supersecretvalue");
    expect(redacted.text).toContain("password flow");
    expect(redacted.text).toContain("[REDACTED:github-token]");
    expect(redacted.text).toContain("[REDACTED:aws-access-key-id]");
    expect(redacted.text).toContain("[REDACTED:assigned-secret]");
    expect(redacted.text).toContain("[REDACTED:private-key]");
    expect(redacted.hits.map((hit) => hit.kind)).toEqual(
      expect.arrayContaining([
        "github-token",
        "aws-access-key-id",
        "private-key",
        "openai-api-key",
        "slack-token",
        "stripe-live-key",
        "google-api-key",
        "npm-token",
        "github-pat",
        "jwt",
        "bearer-token",
        "basic-auth",
        "assigned-secret",
      ]),
    );
  });
});

describe("diff, bounds, and chunks", () => {
  it("parses the fixture, quoted paths, and github file entries", () => {
    const files = parseUnifiedDiff(readFileSync("tests/fixtures/sample.diff", "utf8"));
    expect(files.map((file) => file.path)).toContain("src/auth/names.ts");
    expect(files.find((file) => file.path === "assets/logo.png")?.status).toBe("binary");
    expect(files.find((file) => file.path === "src/config/example.ts")?.status).toBe("added");
    const quoted = parseUnifiedDiff(
      'diff --git "a/my file.ts" "b/my file.ts"\n--- "a/my file.ts"\n+++ "b/my file.ts"\n@@ -1 +1 @@\n-a\n+b\n',
    );
    expect(quoted[0]?.path).toBe("my file.ts");
    expect(() => parseUnifiedDiff("not a diff")).toThrow(/diff --git/);
    const fromApi = diffFileFromGitHub({
      filename: "src/a.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      patch: "@@ -1 +1 @@\n-a\n+b\n",
    });
    expect(fromApi.patch).toContain("diff --git a/src/a.ts");
    expect(fromApi.additions).toBe(1);
    const omitted = diffFileFromGitHub({
      filename: "bin.dat",
      status: "added",
      additions: 0,
      deletions: 0,
    });
    expect(omitted.patch).toContain("Patch omitted by GitHub");
  });

  it("keeps whole files until the budget and then names the rest", () => {
    const files = parseUnifiedDiff(readFileSync("tests/fixtures/sample.diff", "utf8"));
    const bounded = boundDiff(files, 400);
    expect(bounded.chars).toBeLessThanOrEqual(400);
    expect(bounded.omittedPaths.length + bounded.truncatedPaths.length).toBeGreaterThan(0);
    expect(bounded.text).toContain("[pr-summary-action]");
  });

  it("splits a long line without dropping its tail", () => {
    const line = `diff --git a/big b/big\n${"x".repeat(50)}`;
    const chunked = chunkDiff(line, 20, 10);
    const joined = chunked.chunks.map((chunk) => chunk.text).join("");
    expect(joined).toContain("x".repeat(50));
    expect(
      chunked.chunks.every((chunk) => chunk.text.length <= 20 || chunk.text.includes("Trimmed")),
    ).toBe(true);
  });

  it("caps the number of chunks", () => {
    const text = ["one", "two", "three", "four"]
      .map((name) => `diff --git a/${name} b/${name}\n+${name}\n`)
      .join("");
    const chunked = chunkDiff(text, 30, 2);
    expect(chunked.chunks).toHaveLength(2);
    expect(chunked.omittedChars).toBeGreaterThan(0);
  });
});

describe("commit lint", () => {
  it("accepts a conventional subject and reports format issues", () => {
    expect(lintCommitMessage("feat(auth): shorten session ttl\n\nBody.\n").ok).toBe(true);
    expect(lintCommitMessage("update stuff").issues.map((issue) => issue.code)).toContain(
      "not-conventional",
    );
    expect(lintCommitMessage("").issues[0]?.code).toBe("empty");
    expect(lintCommitMessage("feat: add login.\nbody").issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["trailing-period", "body-blank-line"]),
    );
    expect(isConventionalTitle(`feat: ${"a".repeat(80)}`)).toBe(true);
    expect(
      lintCommitMessage(`feat: ${"a".repeat(80)}`).issues.map((issue) => issue.code),
    ).toContain("subject-long");
  });
});

describe("model client", () => {
  it("retries 429 and adapts when response_format is rejected", async () => {
    const bodies: string[] = [];
    let calls = 0;
    const fetchMock: typeof fetch = (input, init) => {
      calls += 1;
      bodies.push(typeof init?.body === "string" ? init.body : "");
      if (calls === 1) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { message: "unknown field response_format" } }), {
            status: 400,
          }),
        );
      }
      if (calls === 2) {
        return Promise.resolve(
          new Response("slow", { status: 429, headers: { "retry-after": "1" } }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"ok"}' } }] }), {
          status: 200,
        }),
      );
    };
    const sleeps: number[] = [];
    let clock = 0;
    const content = await chatComplete(
      {
        fetch: fetchMock,
        baseUrl: "http://127.0.0.1/v1",
        apiKey: "sk-test",
        model: "mock",
        temperature: 0.2,
        maxOutputTokens: 100,
        policy: { maxRetries: 2, retryBaseMs: 10, timeoutMs: 1000, retryUnsafe: true },
        limiter: createRateLimiter(
          0,
          () => clock,
          (ms) => {
            clock += ms;
            return Promise.resolve();
          },
        ),
        sleep: (ms) => {
          sleeps.push(ms);
          clock += ms;
          return Promise.resolve();
        },
        now: () => clock,
        redact: (text) => text,
        session: { jsonMode: true, tokenField: "max_tokens", sendTemperature: true },
      },
      [{ role: "user", content: "hello" }],
    );
    expect(content).toContain("summary");
    expect(bodies[1]).not.toContain("response_format");
    expect(sleeps).toContain(1000);
    expect(calls).toBe(3);
  });

  it("does not retry a 400 that is not a compatibility mismatch", async () => {
    let calls = 0;
    const fetchMock: typeof fetch = () => {
      calls += 1;
      return Promise.resolve(new Response("bad request", { status: 400 }));
    };
    await expect(
      chatComplete(
        {
          fetch: fetchMock,
          baseUrl: "http://127.0.0.1/v1",
          apiKey: "sk-test",
          model: "mock",
          temperature: 0,
          maxOutputTokens: 64,
          policy: { maxRetries: 3, retryBaseMs: 1, timeoutMs: 1000, retryUnsafe: true },
          limiter: async () => {},
          sleep: async () => {},
          now: () => 0,
          redact: (text) => text,
          session: { jsonMode: false, tokenField: "max_tokens", sendTemperature: false },
        },
        [{ role: "user", content: "hello" }],
      ),
    ).rejects.toThrow(/HTTP 400/);
    expect(calls).toBe(1);
  });

  it("parses fenced JSON and rejects a summary-less payload", () => {
    expect(stripFences('```json\n{"summary":"Hi"}\n```')).toContain("summary");
    const parsed = parseModelSummary(
      '{"summary":"Hi","areas":[{"area":"src","changes":"x"}],"risks":["r"],"testPlan":["t"],"conventionalTitle":null,"commitReviews":[]}',
      "full",
    );
    expect(parsed.summary).toBe("Hi");
    expect(() => parseModelSummary("{}", "summary")).toThrow(/summary/);
    expect(buildSystemPrompt("darija", "full", false)).toContain("untrusted");
  });
});

describe("retry helper", () => {
  it("uses a dated retry-after and refuses another origin", async () => {
    const future = new Date(Date.now() + 1500).toUTCString();
    expect(retryDelayMs(future, 0, 10, () => Date.now())).toBeGreaterThan(0);
    expect(retryDelayMs(null, 1, 100, () => 0)).toBe(237);

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname.endsWith("/files") && !url.searchParams.has("page")) {
        res.writeHead(200, {
          "content-type": "application/json",
          link: '<https://evil.example/next>; rel="next"',
        });
        res.end(JSON.stringify([{ filename: "a.ts", status: "modified", patch: "@@\n+a\n" }]));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end("[]");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("no port");
    }
    await expect(
      listPullFiles("acme", "widgets", 1, {
        fetch: globalThis.fetch,
        apiBase: `http://127.0.0.1:${address.port}`,
        token: "t",
        policy: { maxRetries: 0, retryBaseMs: 0, timeoutMs: 1000, retryUnsafe: false },
        limiter: async () => {},
        sleep: async () => {},
        now: () => 0,
        redact: (text) => text,
        cap: 10,
      }),
    ).rejects.toBeInstanceOf(DiffError);
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it("does not retry an unsafe POST", async () => {
    let calls = 0;
    await expect(
      fetchWithRetry({
        fetch: () => {
          calls += 1;
          return Promise.resolve(new Response("no", { status: 503 }));
        },
        url: "http://127.0.0.1/comments",
        init: { method: "POST", body: "{}" },
        policy: { maxRetries: 3, retryBaseMs: 1, timeoutMs: 1000, retryUnsafe: false },
        limiter: async () => {},
        sleep: async () => {},
        now: () => 0,
        redact: (text) => text,
        label: "GitHub comment",
      }),
    ).rejects.toThrow(/503/);
    expect(calls).toBe(1);
  });
});

describe("comment rendering", () => {
  it("hides the marker, uses RTL for Darija, and defangs mentions", () => {
    const body = renderComment({
      language: "darija",
      mode: "full",
      dryRun: true,
      llmCalled: true,
      model: "mock",
      kept: ["src/a.ts"],
      ignored: [],
      redactions: [],
      omittedPaths: [],
      truncatedPaths: [],
      boundedChars: 10,
      maxDiffChars: 1000,
      summary: "hello @octocat </div>",
      areas: [{ area: "src", changes: "change" }],
      risks: ["risk"],
      testPlan: ["test"],
      conventionalTitle: "feat: add",
      commits: [],
      maxChars: 60000,
    });
    expect(body).toContain("<!-- pr-summary-action:v1 -->");
    expect(body).toContain('dir="rtl"');
    expect(body).toContain("@\u200boctocat");
    expect(body).toContain("<\u200b/div");
    expect(workflowCommand("warning", "line\n2")).toBe("::warning::line%0A2");
  });

  it("writes a multiline GitHub output", () => {
    const dir = mkdtempSync(join(tmpdir(), "pr-summary-"));
    const file = join(dir, "output");
    writeFileSync(file, "");
    writeGitHubOutput(file, "summary", "one\ntwo");
    const written = readFileSync(file, "utf8");
    expect(written.startsWith("summary<<ghadelim_")).toBe(true);
    expect(written).toContain("one\ntwo");
  });
});
