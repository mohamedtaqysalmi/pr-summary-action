export function createRateLimiter(
  minIntervalMs: number,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): () => Promise<void> {
  let nextAt = 0;
  return async function wait(): Promise<void> {
    const current = now();
    const delay = Math.max(0, nextAt - current);
    nextAt = Math.max(nextAt, current) + minIntervalMs;
    if (delay > 0) {
      await sleep(delay);
    }
  };
}

export function retryDelayMs(
  retryAfter: string | null,
  attempt: number,
  baseMs: number,
  now: () => number,
): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 120) {
      return Math.round(seconds * 1000);
    }
    const dated = Date.parse(retryAfter);
    if (Number.isFinite(dated)) {
      return Math.min(120_000, Math.max(0, dated - now()));
    }
  }
  const exponential = baseMs * 2 ** attempt;
  const jitter = (attempt * 37) % 100;
  return Math.min(30_000, exponential + jitter);
}
