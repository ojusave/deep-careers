/** Remember which search a qualification belongs to; this is not proof of factual accuracy. */
import type { Preferences } from "../types.ts";
import { normalizeEmployer, record } from "../validation.ts";

export function searchRequestContext(preferences: Preferences): Preferences {
  return {
    roles: preferences.roles.trim(),
    location: preferences.location.trim(),
    excludedEmployers: [...new Set(preferences.excludedEmployers.map(normalizeEmployer).filter(Boolean))].sort()
  };
}

/** A changed query needs a new Deep judgment, even if the old title still fits. */
export function matchesSearchRequest(value: unknown, preferences: Preferences): boolean {
  const context = record(value);
  if (typeof context.roles !== "string" || typeof context.location !== "string"
    || !Array.isArray(context.excludedEmployers) || context.excludedEmployers.length > 30
    || context.excludedEmployers.some(item => typeof item !== "string")) return false;
  return JSON.stringify(searchRequestContext(context as Preferences)) === JSON.stringify(searchRequestContext(preferences));
}
