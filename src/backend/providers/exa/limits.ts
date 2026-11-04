/**
 * Bound research spending and wait time inside this server process.
 * This is an MVP guard, not a distributed quota system across multiple servers.
 */
import { AppError } from '../../errors.ts';
export const DEEP_TIMEOUT_MS = 150_000;
export const MAX_RESPONSE_BYTES = 2_500_000;
type LimitState = {
  active: number;
  calls: number[];
};
const shared = globalThis as typeof globalThis & {
  __deepCareersLimits?: LimitState;
};
export function acquireDeepSlot(): () => void {
  const state = shared.__deepCareersLimits ??= {
    active: 0,
    calls: []
  };
  state.calls = state.calls.filter(time => time > Date.now() - 3_600_000);
  if (state.active >= 3) throw new AppError("Research is busy. Please try again shortly.", 429, "RESEARCH_BUSY");
  if (state.calls.length >= 90) throw new AppError("The MVP's hourly research limit has been reached. Try again later.", 429, "USAGE_LIMIT");
  state.active++;
  state.calls.push(Date.now());
  return () => {
    state.active = Math.max(0, state.active - 1);
  };
}
