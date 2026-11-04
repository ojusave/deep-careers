/** Keep employment labels consistent without guessing dates or changing source facts. */
import type { Employer } from "../types.ts";
import { safeUrl } from "../validation.ts";

/** Older responses separated current and last. Only use last as most recent when no current role exists. */
export function normalizeEmployers<T extends { status: unknown }>(employers: readonly T[]): Array<Omit<T, "status"> & { status: Employer["status"] }> {
  const hasCurrent = employers.some(employer => employer.status === "current");
  return employers.map(employer => ({
    ...employer,
    status: employer.status === "last" ? hasCurrent ? "earlier" : "current"
      : employer.status === "current" || employer.status === "earlier" ? employer.status : "uncertain"
  }));
}

/** Included history can supply dates and titles, but selection alone never proves a skill. */
export function isIncludedEmployer(employer: Employer): boolean {
  return employer.status !== "uncertain" && Boolean(employer.company.trim())
    && (employer.userProvided === true || employer.sources.some(source => Boolean(safeUrl(source.url))));
}
