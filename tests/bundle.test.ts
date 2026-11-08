import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_FILES, startMock } from "./helpers/server.js";

function runNode(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, ...env },
      cwd: process.cwd(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

describe("bundled Node 20 entrypoints", () => {
  it("runs the keyless CLI from dist", async () => {
    const result = await runNode(
      "dist/cli.js",
      [
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
      { PR_SUMMARY_MIN_INTERVAL_MS: "0" },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"llmCalled": false');
    expect(result.stdout).toContain('"commentPosted": false');
    expect(result.stdout).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.stdout).not.toContain("LOCKFILE_SENTINEL_DO_NOT_SEND");
    expect(result.stderr).toContain("dry-run=true");
  });

  it("runs the action bundle against a mock and does not post in dry-run", async () => {
    const mock = await startMock({ files: SAMPLE_FILES, commits: [] });
    const dir = mkdtempSync(join(tmpdir(), "pr-summary-bundle-"));
    const eventPath = join(dir, "event.json");
    writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: 9, title: "Bundle", body: "" } }),
    );
    const output = join(dir, "github-output");
    writeFileSync(output, "");
    const result = await runNode("dist/index.js", [], {
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: "acme/widgets",
      GITHUB_API_URL: mock.url,
      GITHUB_TOKEN: "github-test-token",
      GITHUB_OUTPUT: output,
      "INPUT_DRY-RUN": "true",
      "INPUT_FAIL-ON-ERROR": "true",
      INPUT_MODE: "summary",
      INPUT_LANGUAGE: "en",
      PR_SUMMARY_MIN_INTERVAL_MS: "0",
      PR_SUMMARY_MAX_RETRIES: "0",
    });
    expect(result.code).toBe(0);
    expect(mock.requests.some((request) => request.method === "POST")).toBe(false);
    expect(mock.comments).toHaveLength(0);
    await mock.close();
  });
});
