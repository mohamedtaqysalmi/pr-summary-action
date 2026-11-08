# pr-summary-action

Summarizes a pull request from a size-limited, redacted diff and keeps a single marker comment up to date.

## CLI capture

Captured 2026-11-08 11:31:15 UTC from Node.js 20.20.2 with:

```bash
node dist/cli.js dry-run --diff-file tests/fixtures/sample.diff --commits-file tests/fixtures/commits.json --language en --mode full
```

The same text is in [docs/cli-capture.txt](docs/cli-capture.txt). Stderr was one line: `pr-summary-action: kept=5 ignored=1 redactions=5 chunks=1 llm=false dry-run=true comment=none`. No model was called and no comment was posted.

```text
pr-summary-action 0.1.0
language: en
mode: full
dry-run: true
llm: skipped (no api key)
comment: not posted

files kept (5):
- src/auth/session.ts
- src/auth/session.test.ts
- src/config/example.ts
- assets/logo.png
- src/auth/names.ts
files ignored (1):
- package-lock.json
redactions: 5
- private-key: 1
- aws-access-key-id: 1
- github-token: 1
- assigned-secret: 2
bounded chars: 1563
chunks: 1
omitted files: 0

commit review (deterministic):
- aaaaaaa feat(auth): shorten session ttl — ok
- bbbbbbb update stuff — needs changes (not-conventional)
- ccccccc fix(config): remove sample credential — ok

--- comment body (not posted) ---
<!-- pr-summary-action:v1 -->
<!-- pr-summary-action meta mode=full language=en llm=false model=none dry-run=true redactions=5 -->
## Summary

No model was called. This note only counts the diff and commit messages locally. It is not a review.

## Files

**Kept**

- src/auth/session.ts
- src/auth/session.test.ts
- src/config/example.ts
- assets/logo.png
- src/auth/names.ts

**Ignored**

- package-lock.json

**Redactions:** 5

- private-key: 1
- aws-access-key-id: 1
- github-token: 1
- assigned-secret: 2

1563 / 60000

## Key changes

No model was called. This note only counts the diff and commit messages locally. It is not a review.

## Risks

Risks were not assessed because no model was called.

## Test plan

No test plan was proposed because no model was called.

## Suggested title

The model did not suggest a title.

## Commit message review

- `aaaaaaa` feat(auth): shorten session ttl — ok — No model suggestion.
- `bbbbbbb` update stuff — the first line is not a Conventional Commit — No model suggestion.
- `ccccccc` fix(config): remove sample credential — ok — No model suggestion.

This note was produced by pr-summary-action 0.1.0.
```

## Why this exists

A long pull request is easier to review when someone names the risky parts and the tests worth running. Sending the raw diff to a model is a bad default, because diffs pick up keys, lockfiles, and generated files. This action drops ignored paths, redacts common secret patterns, and only then calls an OpenAI-compatible endpoint. It updates one comment instead of adding a new one on every push. The keyless command checks that pipeline without a provider and without writing to GitHub.

## Features

- Reads a pull request diff from the GitHub files API, or a unified diff from disk.
- Drops paths that match ignore globs before redaction or a model call.
- Redacts common tokens and private keys, then trims the text to `max-diff-chars` and a fixed number of chunks.
- Calls `POST {base-url}/chat/completions` with retries, `Retry-After`, and a minimum interval between requests.
- Writes one comment marked with `<!-- pr-summary-action:v1 -->`, and updates that comment on the next run.
- `summary` asks for a summary, changes by area, risks, and a test plan. `commit-review` adds a Conventional Commit title suggestion and reviews commit subjects. `full` does both. The subject lint also runs with no model.
- Headings and fixed sentences are English, French, or Moroccan Darija. Darija comments set `dir="rtl"`. Model prose is requested in that language. JSON keys stay English.
- `dry-run` skips the comment. With no API key the model is skipped too. `fail-on-error` chooses whether a failure fails the job.
- The CLI is dry-run only.

## Quick start

Node.js 20 or newer.

```bash
npm ci
npm run lint && npm run format:check && npm run typecheck
npm test
npm run build
node dist/cli.js dry-run --diff-file tests/fixtures/sample.diff --commits-file tests/fixtures/commits.json --language en --mode full
```

No API key is required. The command does not call a model and does not post a comment.

## Architecture

```text
pull_request or local diff
        |
        v
validate inputs (language, mode, bounds, URL)
        |
        v
files from GitHub or a unified diff
        |
        v
drop ignore globs
        |
        v
redact -> trim to max-diff-chars -> chunk
        |
        +-- no api key --> inventory + commit-subject lint
        |
        +-- api key ----> chat completions (retry, rate limit)
                              |
                              v
                         redact model text
        |
        v
markdown + hidden marker
        |
        +-- dry-run or CLI --> stdout only
        |
        +-- action, dry-run false --> upsert the marker comment
```

The action bundle and the CLI are the same pipeline. Decisions, including why `pull_request_target` is rejected, are in [docs/architecture.md](docs/architecture.md). What leaves the runner is in [docs/privacy.md](docs/privacy.md).

## Environment

Action inputs are also read from `INPUT_<NAME>` (hyphens kept, so `api-key` is `INPUT_API-KEY`). `PR_SUMMARY_*` is the CLI and shell form. A CLI flag wins over the environment. The CLI always dry-runs.

| Name                                           | Required                        | Default                                                                                                      | Meaning                                                                                                                     |
| ---------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `api-key` / `PR_SUMMARY_API_KEY`               | When dry-run is false           | empty                                                                                                        | Bearer token for the model. Not written into the prompt or the comment.                                                     |
| `base-url` / `PR_SUMMARY_BASE_URL`             | No                              | `https://api.openai.com/v1`                                                                                  | Origin for `POST /chat/completions`. `http` and `https` only. No userinfo. Include `/v1` when the provider uses it.         |
| `model` / `PR_SUMMARY_MODEL`                   | No                              | `gpt-4o-mini`                                                                                                | Model id. The default is a name, not a guarantee that your endpoint serves it.                                              |
| `language` / `PR_SUMMARY_LANGUAGE`             | No                              | `en`                                                                                                         | `en`, `fr`, or `darija`.                                                                                                    |
| `max-diff-chars` / `PR_SUMMARY_MAX_DIFF_CHARS` | No                              | `60000`                                                                                                      | Integer from 1000 to 500000. Cap on redacted diff characters sent to the model.                                             |
| `ignore-paths` / `PR_SUMMARY_IGNORE_PATHS`     | No                              | `**/node_modules/**`, `**/dist/**`, `**/*.lock`, `**/package-lock.json`, `**/pnpm-lock.yaml`, `**/yarn.lock` | Globs separated by commas or newlines. Matching paths are omitted entirely.                                                 |
| `mode` / `PR_SUMMARY_MODE`                     | No                              | `summary`                                                                                                    | `summary`, `commit-review`, or `full`.                                                                                      |
| `dry-run` / `PR_SUMMARY_DRY_RUN`               | No                              | `false` in the action; always `true` in the CLI                                                              | When true, do not create or update a comment.                                                                               |
| `fail-on-error` / `PR_SUMMARY_FAIL_ON_ERROR`   | No                              | `false` in the action; `true` in the CLI                                                                     | When false, log the failure and exit 0. When true, exit 1.                                                                  |
| `github-token` / `GITHUB_TOKEN`                | To read or write a pull request | `github.token` in the action                                                                                 | Reads files and comments. Writes only when dry-run is false. Not sent to the model.                                         |
| `GITHUB_EVENT_NAME`                            | In the action                   | set by GitHub                                                                                                | Must be `pull_request`.                                                                                                     |
| `GITHUB_EVENT_PATH`                            | In the action                   | set by GitHub                                                                                                | Event payload with `pull_request.number`, title, and body.                                                                  |
| `GITHUB_REPOSITORY`                            | In the action                   | set by GitHub                                                                                                | `owner/repo`.                                                                                                               |
| `GITHUB_API_URL`                               | No                              | `https://api.github.com`                                                                                     | API origin. Pagination links to another origin are refused.                                                                 |
| `GITHUB_OUTPUT`                                | No                              | set by GitHub                                                                                                | Where the action writes outputs.                                                                                            |
| `PR_SUMMARY_MAX_RETRIES`                       | No                              | `3`                                                                                                          | Retries after the first attempt for retryable HTTP statuses and network errors. Range 0–8. Comment creates are not retried. |
| `PR_SUMMARY_RETRY_BASE_MS`                     | No                              | `400`                                                                                                        | Base backoff. `Retry-After` wins when it is present.                                                                        |
| `PR_SUMMARY_MIN_INTERVAL_MS`                   | No                              | `250`                                                                                                        | Minimum gap between outbound calls in one run.                                                                              |
| `PR_SUMMARY_TIMEOUT_MS`                        | No                              | `60000`                                                                                                      | Per-request timeout. Range 1000–300000.                                                                                     |
| `PR_SUMMARY_CHUNK_CHARS`                       | No                              | `12000`                                                                                                      | Chunk size, capped by `max-diff-chars`. Range 500–500000.                                                                   |
| `PR_SUMMARY_MAX_CHUNKS`                        | No                              | `6`                                                                                                          | Range 1–20. Extra text is trimmed and counted.                                                                              |
| `PR_SUMMARY_MAX_OUTPUT_TOKENS`                 | No                              | `1800`                                                                                                       | Sent as `max_tokens`, or `max_completion_tokens` if the provider rejects `max_tokens`.                                      |
| `PR_SUMMARY_TEMPERATURE`                       | No                              | `0.2`                                                                                                        | Omitted on the next attempt if the provider rejects it. Range 0–2.                                                          |
| `PR_SUMMARY_JSON_MODE`                         | No                              | `true`                                                                                                       | Sends `response_format: json_object` until the provider rejects it.                                                         |
| `PR_SUMMARY_MAX_FILES`                         | No                              | `300`                                                                                                        | Cap on files read from GitHub. Range 1–3000.                                                                                |
| `PR_SUMMARY_MAX_COMMITS`                       | No                              | `50`                                                                                                         | Cap on commits read for review mode. Range 1–200.                                                                           |
| `PR_SUMMARY_MAX_BODY_CHARS`                    | No                              | `4000`                                                                                                       | Cap on the pull request body placed in the prompt.                                                                          |
| `PR_SUMMARY_MAX_COMMENT_CHARS`                 | No                              | `60000`                                                                                                      | Cap on the rendered comment, under GitHub's 65536 limit.                                                                    |

Copy [.env.example](.env.example) if you want those names in a shell. This program does not load `.env` by itself.

Outputs: `summary`, `comment-id`, `conventional-title`, `dry-run`, `llm-called`, `error`, `skipped`.

## Usage

Keyless inventory, including French or Darija headings:

```bash
node dist/cli.js dry-run --diff-file tests/fixtures/sample.diff --language fr --mode summary
node dist/cli.js dry-run --diff-file tests/fixtures/sample.diff --language darija --mode summary
```

Call a model without posting. Prefer the environment variable so the key is not in the process list.

```bash
PR_SUMMARY_API_KEY=... PR_SUMMARY_BASE_URL=http://127.0.0.1:11434/v1 PR_SUMMARY_MODEL=llama3.2 \
  node dist/cli.js dry-run --diff-file tests/fixtures/sample.diff --mode full
```

That command is not part of the verified quick start. It was not run here, because no API key is configured.

Workflow for a real comment. `uses: ./` is the local action after `npm run build` (the built `dist/` is committed). A published `uses:` reference does not exist yet.

```yaml
name: PR summary
on:
  pull_request:
permissions:
  contents: read
  pull-requests: write
jobs:
  summary:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./
        with:
          api-key: ${{ secrets.OPENAI_API_KEY }}
          base-url: https://api.openai.com/v1
          model: gpt-4o-mini
          language: en
          max-diff-chars: "60000"
          mode: full
          dry-run: "false"
          fail-on-error: "false"
```

The read-only self-test is [.github/workflows/self-test.yml](.github/workflows/self-test.yml). It sets `dry-run: true`, does not pass an API key, and does not grant `pull-requests: write`.

`make dev` installs, builds, and runs the keyless command. `make test`, `make lint`, and `make build` are the other entry points. `docker compose up --build` builds the image (tests included) and runs that same keyless command; see [docs/docker-compose-capture.txt](docs/docker-compose-capture.txt).

## Structure

```text
.
├── action.yml
├── src/
│   ├── index.ts            action entry
│   ├── cli.ts              CLI entry
│   ├── execute.ts          shared run, outputs, exit code
│   ├── pipeline.ts         ignore, redact, chunk, model, comment
│   ├── config.ts           input validation
│   ├── diff/               parse, ignore, bounds, GitHub file mapping
│   ├── redact.ts
│   ├── chunk.ts
│   ├── llm/                client, prompt, JSON parse
│   ├── comment/            markdown and marker upsert
│   ├── github/             API and event payload
│   └── http/               rate limit and retry
├── tests/                  unit, mock integration, bundle
├── dist/                   esbuild bundle, target node20
├── docs/                   architecture, privacy, CLI + Docker captures
├── examples/workflow.yml
├── .github/workflows/      CI and self-test
├── Dockerfile
├── docker-compose.yml
└── Makefile
```

## Tests

```bash
npm test
npm run test:coverage
npm run build
npm run test:cli
```

Vitest is pinned to 4.1.12. Vitest 5 requires Node.js 22 or newer, and this action runs on Node.js 20.

`npm test` is 47 tests: input validation, globs, redaction, diff parsing, bounds, chunks, commit lint, model retries, comment rendering, the keyless CLI, and a local mock of GitHub plus chat completions. The mock checks that ignored file text and raw fixture secrets are absent from the model request, that the GitHub token and the API key stay on their own calls, and that a second run updates the marker comment instead of creating another. `npm run test:cli` runs the built `dist/cli.js` and `dist/index.js` the same way.

Coverage from `npm run test:coverage` on Node.js 20.20.2 at 2026-11-08 11:31 UTC, v8, including `src/**/*.ts` and excluding `src/index.ts` and `src/cli.ts`:

|            |                   |
| ---------- | ----------------- |
| Statements | 87.25% (972/1114) |
| Branches   | 79.38% (670/844)  |
| Functions  | 95.50% (170/178)  |
| Lines      | 87.02% (946/1087) |

`npm audit` on this tree reported 0 vulnerabilities after `minimatch` was overridden to 11.0.5. There are no runtime dependencies. `npm audit --omit=dev` is also 0.

## Limitations and roadmap

- No live model call and no live pull request comment were made. There is no owner API key in this environment, and posting a comment was not approved. The client and the comment upsert are covered with a local mock server. A real provider run and a real comment wait on a repo secret and owner approval.
- `docker compose up --build` was run successfully on Docker Desktop 29.9.2 / Compose v5.6.1. The image build runs tests; the container prints the same keyless inventory as the CLI. Capture: [docs/docker-compose-capture.txt](docs/docker-compose-capture.txt).
- The repo is on GitHub at [mohamedtaqysalmi/pr-summary-action](https://github.com/mohamedtaqysalmi/pr-summary-action) (private). CI verifies lint, tests, build, committed `dist/`, the bundle CLI, and `npm audit`. The first remote CI run failed only on an executable-bit diff for `dist/cli.js`; CI now ignores file-mode-only changes under `dist/`.
- The read-only self-test workflow (`.github/workflows/self-test.yml`) runs the local action with `dry-run: true` and no API key on `pull_request`. It does not post a comment and does not need a paid key. Verified on PR #1; capture: [docs/self-test-capture.txt](docs/self-test-capture.txt).
- Redaction misses split, encoded, and custom secrets. It can redact a long benign assignment to `password` or `api_key`. Details and the pattern list are in [docs/privacy.md](docs/privacy.md).
- GitHub may omit a patch. This action also stops at `PR_SUMMARY_MAX_FILES`, `PR_SUMMARY_MAX_COMMITS`, `max-diff-chars`, and `PR_SUMMARY_MAX_CHUNKS`. A multi-chunk run summarizes each chunk and then combines those notes, so a detail that is only visible across chunks can be lost.
- The model can be wrong. The comment says when no model was called. A keyless run is not a review.
- Darija and French model prose depend on the configured model. The fixed headings are translated in this repo. There is no embedded translator.
- `pull_request_target` is rejected on purpose.
- Two workflow runs that both see no marker comment can each create one. The next run updates every marker comment.
- Commit review without a model checks Conventional Commit form only. It does not judge the wording.
- The default model name may not exist on a non-OpenAI server. Set `model`.

Later, if the owner wants it: a live provider check (needs `OPENAI_API_KEY` or equivalent), a real marker-comment upsert on an approved PR, extra operator-supplied redaction patterns, and line comments. Line comments are not implemented.

## License

MIT. Copyright (c) 2026 Mohamed-Taqy Salmi. See [LICENSE](LICENSE).

Built by Mohamed-Taqy Salmi.

<!--
Repo metadata
description: GitHub Action that summarizes a pull request from a bounded, redacted diff and upserts one marker comment.
topics: github-action, pull-request, openai, typescript, code-review, conventional-commits, darija
-->
