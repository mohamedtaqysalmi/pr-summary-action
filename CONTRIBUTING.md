# Contributing

Thanks for looking at pr-summary-action. The author is Mohamed-Taqy Salmi.

## Setup

Node.js 20 or newer. From a fresh clone:

```bash
npm ci
npm test
npm run build
node dist/cli.js dry-run --diff-file tests/fixtures/sample.diff --commits-file tests/fixtures/commits.json --language en --mode full
```

`make lint`, `make test`, and `make build` repeat those checks.

## Commits

Use a Conventional Commit subject: `feat:`, `fix:`, `docs:`, `test:`, `ci:`, `build:`, `refactor:`, or `chore:`.

## Safety

- Do not commit `.env` files or live API keys.
- Do not point tests at a real pull request. The mocked server in `tests/helpers/server.ts` is the integration stand-in.
- The CLI cannot post comments. Do not add a CLI command that writes to GitHub.
- Fixture strings such as `AKIAIOSFODNN7EXAMPLE` are the public AWS example key, not a credential.

## Pull requests

Run `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:cli`. If `src/` changed, commit the rebuilt `dist/`.
