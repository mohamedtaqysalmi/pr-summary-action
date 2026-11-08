import { LlmError } from "../errors.js";
import { fetchWithRetry, type RetryPolicy } from "../http/retry.js";
import { clip, isRecord } from "../text.js";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface LlmSession {
  jsonMode: boolean;
  tokenField: "max_tokens" | "max_completion_tokens";
  sendTemperature: boolean;
}

export interface LlmClientOptions {
  fetch: typeof fetch;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  policy: RetryPolicy;
  limiter: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  redact: (text: string) => string;
  session: LlmSession;
}

function chatUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

function messageContent(payload: unknown): string {
  if (!isRecord(payload)) {
    throw new LlmError("Model response was not a JSON object.");
  }
  const choices: unknown = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new LlmError("Model response did not include choices.");
  }
  const first: unknown = choices.map((entry: unknown) => entry)[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    throw new LlmError("Model response did not include a message.");
  }
  const content = first.message.content;
  if (typeof content === "string") {
    if (content.trim() === "") {
      throw new LlmError("Model message was empty.");
    }
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        parts.push(part);
      } else if (isRecord(part) && typeof part.text === "string") {
        parts.push(part.text);
      }
    }
    const joined = parts.join("");
    if (joined.trim() === "") {
      throw new LlmError("Model message was empty.");
    }
    return joined;
  }
  throw new LlmError("Model message content had an unsupported shape.");
}

function buildBody(options: LlmClientOptions, messages: ChatMessage[]): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages,
  };
  if (options.session.sendTemperature) {
    body.temperature = options.temperature;
  }
  body[options.session.tokenField] = options.maxOutputTokens;
  if (options.session.jsonMode) {
    body.response_format = { type: "json_object" };
  }
  return body;
}

async function postOnce(
  options: LlmClientOptions,
  messages: ChatMessage[],
): Promise<
  | { kind: "ok"; content: string }
  | { kind: "compat"; reason: string }
  | { kind: "fail"; error: LlmError }
> {
  try {
    const response = await fetchWithRetry({
      fetch: options.fetch,
      url: chatUrl(options.baseUrl),
      init: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": "pr-summary-action",
        },
        body: JSON.stringify(buildBody(options, messages)),
      },
      policy: { ...options.policy, retryUnsafe: true },
      limiter: options.limiter,
      sleep: options.sleep,
      now: options.now,
      redact: options.redact,
      label: "Model",
    });
    const payload: unknown = await response.json();
    return { kind: "ok", content: messageContent(payload) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Model request failed.";
    if (/HTTP 400:/.test(message)) {
      return { kind: "compat", reason: message };
    }
    return { kind: "fail", error: new LlmError(clip(options.redact(message), 500)) };
  }
}

export async function chatComplete(
  options: LlmClientOptions,
  messages: ChatMessage[],
): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await postOnce(options, messages);
    if (result.kind === "ok") {
      return result.content;
    }
    if (result.kind === "fail") {
      throw result.error;
    }
    const reason = result.reason;
    if (options.session.jsonMode && /response_format/i.test(reason)) {
      options.session.jsonMode = false;
      continue;
    }
    if (options.session.sendTemperature && /temperature/i.test(reason)) {
      options.session.sendTemperature = false;
      continue;
    }
    if (options.session.tokenField === "max_tokens" && /max_tokens/i.test(reason)) {
      options.session.tokenField = "max_completion_tokens";
      continue;
    }
    throw new LlmError(clip(options.redact(reason), 500));
  }
  throw new LlmError("Model request was rejected after compatibility retries.");
}
