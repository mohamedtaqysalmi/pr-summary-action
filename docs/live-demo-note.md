# Live demo note

This file exists so a real pull request has a small, reviewable diff for
`pr-summary-action` to summarize with a live OpenAI-compatible call.

- Repo secret used: `OPENAI_API_KEY`
- Alternate secret available: `DEEPSEEK_API_KEY` (swap `base-url` / `model` in the workflow if preferred)
- Workflow: `.github/workflows/pr-summary.yml`
- Expected result: one marker comment on the PR (`<!-- pr-summary-action:v1 -->`)
