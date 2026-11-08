# Privacy

This action sends a bounded slice of a pull request to whatever HTTP service you set as `base-url`. It does not have its own database.

## Sent to the model

Only when an API key is present and there is diff text or, in `commit-review` and `full`, commit text:

- The pull request title, after redaction, clipped to 300 characters.
- The pull request body, after redaction, clipped to `PR_SUMMARY_MAX_BODY_CHARS` (default 4000).
- The redacted diff, after ignore rules and after the `max-diff-chars` cap, split into at most `PR_SUMMARY_MAX_CHUNKS` chunks (default 6) of at most `PR_SUMMARY_CHUNK_CHARS` characters (default 12000, and never larger than `max-diff-chars`).
- Commit subjects, after redaction, when the mode includes commit review.
- The instruction text, including the language name, and a warning that the diff is untrusted.

The request is `POST {base-url}/chat/completions` with `Authorization: Bearer <api-key>`, `Content-Type: application/json`, and a JSON body of `model`, `messages`, and, when the provider accepts them, `temperature`, `max_tokens` or `max_completion_tokens`, and `response_format`. The API key is a header. It is not placed in the prompt.

The default `base-url` is `https://api.openai.com/v1`. If you set another URL, that host receives the prompt. A URL with a username or password is rejected. `http://127.0.0.1` is allowed so a local OpenAI-compatible server can be used.

## Not sent to the model

- `github-token` and `GITHUB_TOKEN`.
- The contents of paths matched by `ignore-paths`.
- Bytes cut off by `max-diff-chars`, the file cap, or the chunk cap, aside from a short omission notice.
- Secrets that matched the redaction patterns. They are replaced with `[REDACTED:<kind>]` first.
- Files whose patch GitHub omitted. The prompt only says that the patch was omitted.

## Written to GitHub

When `dry-run` is false, the action writes one pull request comment through the issues comments API. A later run updates every comment that contains `<!-- pr-summary-action:v1 -->` instead of creating another. The comment contains the summary, file inventory, and, depending on mode, risks, a test plan, a title suggestion, and commit-message notes. It does not contain the diff. Model text is redacted again before it is written. `@mentions` are broken with a zero-width space so the comment does not notify GitHub users named in the diff.

The token needs `pull-requests: write` for that comment. `dry-run: true` does not create or update a comment. The CLI never does, even if `PR_SUMMARY_DRY_RUN=false`.

Reads use `GET` on the pull request files, commits, and comments. Pagination links that leave the `GITHUB_API_URL` origin are refused.

## Logs

The action log line is counts only: files kept, files ignored, redaction count, chunk count, whether the model was called, dry-run, and the comment id. It does not print the diff, the API key, or the GitHub token. A failure message is redacted and clipped before it is logged. The CLI flag `--show-redacted-diff` prints the redacted diff on stderr. That flag does not exist on the action.

## Retention

This program does not store prompts or comments. The GitHub comment remains until someone deletes it. The provider at `base-url` stores the prompt under that provider’s policy. Actions log retention is the repository’s.

## Dry-run

- `dry-run: true` and no API key: local parse, ignore, redact, chunk, and commit-subject lint. No model HTTP call. No comment.
- `dry-run: true` and an API key: the model is called. No comment.
- `dry-run: false` requires an API key and a token. A model failure does not post a partial comment.

## Redaction limits

Patterns cover PEM private keys, AWS access key ids (`AKIA` plus 16 characters), GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, and `github_pat_`), OpenAI-style `sk-` keys, Slack `xox*` tokens, Stripe live keys, Google `AIza` keys, npm tokens, JWTs, Bearer and Basic credentials, and quoted or long assignments to `api_key`, `secret`, `password`, `passwd`, `access_token`, and `auth_token`.

This will miss secrets that are split, encoded, renamed, or written in a format that is not listed. It can also redact a long benign assignment. It is not a data-loss-prevention product. Ignored files are dropped rather than scanned, so a secret only in `package-lock.json` is not sent and is not counted.

## Event choice

`pull_request` is the only supported event. `pull_request_target` is rejected so a forked diff is not handled with a token that can write to the base repository.
