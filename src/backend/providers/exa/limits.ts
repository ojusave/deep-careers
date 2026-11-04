/**
 * Bound research spending and wait time inside this server process.
 * This is an MVP guard, not a distributed quota system across multiple servers.
 */
import { AppError } from '../../errors.ts';
export const DEEP_TIMEOUT_MS = 150_000;
export const MAX_RESPONSE_BYTES = 2_500_000;
export const DEFAULT_MAX_CONCURRENT_REQUESTS = 24;
export const DEFAULT_MAX_REQUESTS_PER_HOUR = 300;
type LimitState = {
  active: number;
  calls: number[];
};
const shared = globalThis as typeof globalThis & {
  __deepCareersLimits?: LimitState;
};
function configuredLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AppError(`${name} must be a positive whole number.`, 503, "INVALID_EXA_LIMIT_CONFIGURATION");
  }
  return value;
}
function stateNow(): LimitState {
  const state = shared.__deepCareersLimits ??= {
    active: 0,
    calls: []
  };
  state.calls = state.calls.filter(time => time > Date.now() - 3_600_000);
  return state;
}
/** Admit work immediately or reject it. There is deliberately no waiting queue. */
export function acquireDeepSlot(): () => void {
  const state = stateNow();
  if (state.active >= configuredLimit("EXA_MAX_CONCURRENT_REQUESTS", DEFAULT_MAX_CONCURRENT_REQUESTS)) {
    throw new AppError("Research is busy. Please try again shortly.", 429, "RESEARCH_BUSY");
  }
  state.active++;
  let released = false;
  return () => {
    if (!released) { released = true; state.active = Math.max(0, state.active - 1); }
  };
}

/** Count each HTTP attempt, including a retry. Reserving a slot alone costs no call. */
export function assertDeepBudgetAvailable(): void {
  const state = stateNow();
  if (state.calls.length >= configuredLimit("EXA_MAX_REQUESTS_PER_HOUR", DEFAULT_MAX_REQUESTS_PER_HOUR)) {
    throw new AppError("The hourly research limit has been reached. Try again later.", 429, "USAGE_LIMIT");
  }
}
export function recordDeepAttempt(): void {
  assertDeepBudgetAvailable();
  const state = stateNow();
  state.calls.push(Date.now());
}
