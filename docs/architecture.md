# Architecture

pr-summary-action turns a pull request diff into one comment. The same code path serves the GitHub Action (`dist/index.js`) and the keyless CLI (`dist/cli.js`).

## Decisions

**No runtime dependencies.** The published action is an esbuild bundle aimed at Node 20. `npm audit --omit=dev` has nothing to scan except this package. ESLint’s transitive `minimatch` is pinned to 11.0.5 with an override because older 10.x releases have a moderate ReDoS advisory and are only used while linting. Vitest is pinned to 4.1.12 because Vitest 5 requires Node.js 22, and the action runtime is Node.js 20.

**Redact before the model, and again before the comment.** Ignore rules run first so lockfiles and build output are not redacted or sent. The remaining text is redacted, then cut to `max-diff-chars`, then split into a bounded number of chunks. Model prose is passed through the same patterns before it is rendered, in case the model echoes a token that reached it.

**The keyless path does not invent a review.** Without an API key the tool still parses, ignores, redacts, chunks, and lints commit subjects. The comment text says that no model was called. It does not fill in a summary, risks, or a test plan.

**One comment, found by a hidden marker.** `<!-- pr-summary-action:v1 -->` is how a later run finds the note. If several marker comments exist, each is updated to the same body. A create that fails after GitHub stored the comment is recovered by listing again and updating. Two runs that both see an empty list can still create two comments; the next successful run updates both.

**The CLI cannot post.** `dry-run` is forced for `dist/cli.js`. Posting exists only in the action entrypoint, and only when `dry-run` is false.

**`pull_request_target` is rejected.** A forked pull request is untrusted input. That event can carry a token able to write to the base repository, so this action does not run there.

**Headings are translated. JSON keys are not.** English, French, and Moroccan Darija (Arabic script, `dir="rtl"`) are fixed strings in `src/i18n.ts`. The model is asked to write values in the selected language. Darija quality depends on the model you configure. This repository does not contain a translator.

## Flow

```text
pull_request or local diff
  -> validate inputs
  -> list files (GitHub) or parse a unified diff (CLI)
  -> drop ignore globs
  -> redact
  -> trim to max-diff-chars
  -> chunk
  -> optional OpenAI-compatible calls (retry, rate limit)
  -> render markdown + hidden marker
  -> dry-run prints it, otherwise upsert the marker comment
```

## Failure

`fail-on-error` defaults to false in the action so a provider outage does not fail the workflow. It defaults to true in the CLI so a bad local command is visible. On failure the action sets the `error` and `skipped` outputs and does not write a comment.
