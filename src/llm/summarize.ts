import { SchemaError } from "../errors.js";
import type { RetryPolicy } from "../http/retry.js";
import type { AppConfig, ModelSummary, PullContext, ReviewedCommit } from "../types.js";
import type { DiffChunk } from "../chunk.js";
import { chatComplete, type LlmSession } from "./client.js";
import { parseModelSummary, parsePartialNote, type PartialNote } from "./parse.js";
import { buildChunkMessages, buildRepairMessages, buildSynthesisMessages } from "./prompt.js";

export async function summarizeDiff(input: {
  config: AppConfig;
  fetch: typeof fetch;
  pull: PullContext;
  chunks: DiffChunk[];
  commits: ReviewedCommit[];
  limiter: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  redact: (text: string) => string;
}): Promise<ModelSummary> {
  const policy: RetryPolicy = {
    maxRetries: input.config.maxRetries,
    retryBaseMs: input.config.retryBaseMs,
    timeoutMs: input.config.timeoutMs,
    retryUnsafe: true,
  };
  const session: LlmSession = {
    jsonMode: input.config.jsonMode,
    tokenField: "max_tokens",
    sendTemperature: true,
  };
  const apiKey = input.config.apiKey;
  if (!apiKey) {
    throw new SchemaError("Cannot call the model without an API key.");
  }
  const client = {
    fetch: input.fetch,
    baseUrl: input.config.baseUrl,
    apiKey,
    model: input.config.model,
    temperature: input.config.temperature,
    maxOutputTokens: input.config.maxOutputTokens,
    policy,
    limiter: input.limiter,
    sleep: input.sleep,
    now: input.now,
    redact: input.redact,
    session,
  };

  async function ask<T>(
    messages: ReturnType<typeof buildChunkMessages>,
    parse: (raw: string) => T,
  ): Promise<T> {
    const first = await chatComplete(client, messages);
    try {
      return parse(first);
    } catch (error) {
      if (!(error instanceof SchemaError)) {
        throw error;
      }
      const second = await chatComplete(client, buildRepairMessages(messages));
      return parse(second);
    }
  }

  const chunks = input.chunks.length > 0 ? input.chunks : [{ index: 0, text: "(no diff text)" }];
  if (chunks.length === 1) {
    const only = chunks[0];
    if (!only) {
      throw new SchemaError("No diff chunk was available.");
    }
    return ask(
      buildChunkMessages({
        language: input.config.language,
        mode: input.config.mode,
        pull: input.pull,
        chunkText: only.text,
        chunkIndex: 0,
        chunkCount: 1,
        partial: false,
        commits: input.commits,
      }),
      (raw) => parseModelSummary(raw, input.config.mode),
    );
  }

  const partials: PartialNote[] = [];
  for (const chunk of chunks) {
    partials.push(
      await ask(
        buildChunkMessages({
          language: input.config.language,
          mode: input.config.mode,
          pull: input.pull,
          chunkText: chunk.text,
          chunkIndex: chunk.index,
          chunkCount: chunks.length,
          partial: true,
          commits: input.commits,
        }),
        (raw) => parsePartialNote(raw),
      ),
    );
  }
  return ask(
    buildSynthesisMessages({
      language: input.config.language,
      mode: input.config.mode,
      pull: input.pull,
      partials,
      commits: input.commits,
    }),
    (raw) => parseModelSummary(raw, input.config.mode),
  );
}
