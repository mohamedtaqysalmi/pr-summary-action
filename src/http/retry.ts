import { ActionError } from "../errors.js";
import { clip } from "../text.js";
import { retryDelayMs } from "./limit.js";

export interface RetryPolicy {
  maxRetries: number;
  retryBaseMs: number;
  timeoutMs: number;
  /** When false, POST failures are returned to the caller without a second attempt. */
  retryUnsafe: boolean;
}

export interface FetchWithRetryOptions {
  fetch: typeof fetch;
  url: string;
  init: RequestInit;
  policy: RetryPolicy;
  limiter: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  redact: (text: string) => string;
  label: string;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function methodOf(init: RequestInit): string {
  return (init.method ?? "GET").toUpperCase();
}

export async function fetchWithRetry(options: FetchWithRetryOptions): Promise<Response> {
  const method = methodOf(options.init);
  const allowRetry = method !== "POST" || options.policy.retryUnsafe;
  const attempts = allowRetry ? options.policy.maxRetries + 1 : 1;
  let lastMessage = `${options.label} request failed`;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await options.limiter();
    let response: Response;
    try {
      response = await options.fetch(options.url, {
        ...options.init,
        signal: AbortSignal.timeout(options.policy.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "network error";
      lastMessage = `${options.label} request failed: ${clip(options.redact(reason), 300)}`;
      if (attempt >= attempts - 1) {
        throw new ActionError(lastMessage);
      }
      await options.sleep(retryDelayMs(null, attempt, options.policy.retryBaseMs, options.now));
      continue;
    }

    if (response.ok) {
      return response;
    }

    const body = await response.text();
    lastMessage = `${options.label} request failed with HTTP ${response.status}: ${clip(options.redact(body), 300)}`;
    const canRetry = allowRetry && isRetryableStatus(response.status) && attempt < attempts - 1;
    if (!canRetry) {
      throw new ActionError(lastMessage);
    }
    await options.sleep(
      retryDelayMs(
        response.headers.get("retry-after"),
        attempt,
        options.policy.retryBaseMs,
        options.now,
      ),
    );
  }

  throw new ActionError(lastMessage);
}
