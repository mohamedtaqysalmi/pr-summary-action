# Progress

## Done

- Validated action inputs: api-key, base-url, model, language (`en`, `fr`, `darija`), max-diff-chars, ignore-paths, mode (`summary`, `commit-review`, `full`), dry-run, fail-on-error, github-token.
- Bounded diff retrieval, ignore globs, secret redaction, chunking, OpenAI-compatible client with retries.
- One hidden-marker comment upsert; CLI is dry-run only.
- Tests, Makefile, Dockerfile, Compose, CI, self-test workflow.
- Public repo: https://github.com/mohamedtaqysalmi/pr-summary-action
- GitHub Pages landing with dry-run simulation.
- Live OpenAI comment on PR #3 (`llm=true`, `gpt-4o-mini`); PR merged.
- Screenshot proof in `docs/live-pr-comment.png`, shown on Pages + README.

## In progress

- Nothing for P6 core delivery.

## Next

- Optional: wire `DEEPSEEK_API_KEY` as an alternate workflow example.
- Optional: pin the repo on the GitHub profile.
- Point GitHub Pages source to `main` `/docs` (single source of truth).

## Known issues

- Redaction is a pattern list. It misses split, encoded, and custom secrets.
- GitHub can omit patches; action also caps files/commits/chars/chunks.
- Two concurrent first runs can create two marker comments.
- `src/index.ts` and `src/cli.ts` are excluded from coverage (exit-code wrappers).
