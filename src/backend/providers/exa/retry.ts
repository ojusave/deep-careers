/** Retry only an actual provider rate-limit response; never queue new research. */
export const MAX_DEEP_ATTEMPTS = 3;

export function retryDelayMs(header: string | null, retryNumber: number, now = Date.now(), random = Math.random): number {
  const value = header?.trim();
  const base = 2000 * 2 ** (retryNumber - 1);
  const jitter = 1 + Math.round(base * 3 * random());
  if (value && /^\d+(?:\.\d+)?$/.test(value)) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.min(seconds * 1000 + jitter, 2_147_483_647);
  }
  // A date must look like an HTTP-date, not an invalid numeric header such as -1.
  if (value && /[A-Za-z]{3}/.test(value)) {
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.min(Math.max(0, date - now) + jitter, 2_147_483_647);
  }
  // A wider window spreads independent users after a burst, without delaying
  // their first request. Two retries wait 2–8s and 4–16s when no header is given.
  return base + jitter;
}

/** Stop and the overall Deep timeout both interrupt backoff and clear its listener. */
export function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); signal.removeEventListener("abort", onAbort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
