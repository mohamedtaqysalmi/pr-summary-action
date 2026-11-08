# Progress

## Done

- Validated action inputs: api-key, base-url, model, language (`en`, `fr`, `darija`), max-diff-chars, ignore-paths, mode (`summary`, `commit-review`, `full`), dry-run, fail-on-error, github-token.
- Bounded diff retrieval from the GitHub pull files API and from a unified diff file. Ignore globs run before redaction.
- Secret redaction before any model call, and again on model text before a comment is rendered.
- Chunking with a chunk cap. OpenAI-compatible chat calls with retries, `Retry-After`, a minimum interval, and compatibility fallbacks for `response_format`, `temperature`, and `max_tokens`.
- One hidden-marker comment (`<!-- pr-summary-action:v1 -->`), updated in place. The CLI cannot post.
- Keyless dry-run prints an inventory and a deterministic Conventional Commit lint. It does not invent a model summary.
- Vitest coverage of the library, plus a mock GitHub/model integration and a bundled CLI/action test.
- Makefile, Dockerfile, Compose, CI workflow, and a read-only self-test workflow.
- Node.js 20.20.2 ran the tests, lint, typecheck, and keyless CLI on 2026-11-08. `esbuild` target is `node20`.

## In progress

- Nothing local. Fresh-clone verification is the last check before the source archive.

## Next

- Live model call and a real pull request comment, only after the owner approves a key and a destination.
- Push to GitHub and remote CI, only when publishing is allowed. Neither has been done.

## Known issues

- Docker is not installed in this environment, so `docker compose up` was not executed. The Dockerfile and Compose file are present and unrun.
- Redaction is a pattern list. It misses split, encoded, and custom secrets, and it can redact a long benign assignment.
- GitHub can omit patches, and this action also caps files, commits, characters, and chunks.
- Two concurrent first runs can create two marker comments. The next run updates every comment that has the marker.
- `src/index.ts` and `src/cli.ts` are excluded from the coverage table. They only set `process.exitCode`. `npm run test:cli` executes the bundles.
