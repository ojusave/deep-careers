/**
 * Keep candidate claims connected to their supporting source pages.
 * These helpers clean provider output and describe coverage; they do not prove every claim is true.
 */
import type { Citation, Evidence, Grounding, Profile, WorkCoverage } from "../../../shared/types.ts";
import type { SourcePage } from "../../providers/exa/deep.ts";
import { AppError } from "../../errors.ts";
import { candidateContext, record } from "../../../shared/validation.ts";
import { inferEmployerIndex, isEmploymentOnlyClaim } from "../../../shared/resume/document.ts";
export function outputText(value: unknown, max = 3000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
export function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.slice(0, 80).map(record) : [];
}
export function normalized(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
export function requireArray(content: Record<string, unknown>, key: string) {
  if (!Array.isArray(content[key])) throw new AppError("Deep returned an incomplete result. Please retry this step.", 502, "INVALID_DEEP_RESPONSE");
}
export function claimGrounding(grounding: Grounding[], path: string): Grounding[] {
  return grounding.filter(field => field.field === path || field.field === `${path}.claim`);
}

/** Excerpts retain returned page context only; citations and excerpts are not semantic verification. */
export function excerptsFor(sources: Citation[], pages: SourcePage[] = []): {
  url: string;
  text: string;
}[] {
  const pageKey = (url: string) => {
    const value = new URL(url);
    value.hash = "";
    return value.href;
  };
  return sources.flatMap(source => {
    const page = pages.find(item => pageKey(item.url) === pageKey(source.url));
    const content = page ? [...page.highlights, page.text].filter(Boolean).join("\n\n").slice(0, 2000) : "";
    return content ? [{
      url: source.url,
      text: content
    }] : [];
  }).slice(0, 3);
}
export function boundProfileExcerpts(evidence: Evidence[]) {
  let remaining = 40_000;
  const withContext = evidence.filter(item => item.sourceExcerpts?.length);
  // Share the budget across roles instead of allowing the first visible role to consume it.
  const perClaim = withContext.length ? Math.floor(remaining / withContext.length) : 0;
  for (const item of withContext) {
    let allowance = Math.min(perClaim, remaining);
    item.sourceExcerpts = (item.sourceExcerpts ?? []).flatMap(excerpt => {
      const text = excerpt.text.slice(0, allowance);
      allowance -= text.length;
      remaining -= text.length;
      return text ? [{
        url: excerpt.url,
        text
      }] : [];
    });
  }
}

/** Coverage is a small application check, not a claim about Deep's hidden trace. */
export function assessWorkCoverage(profile: Pick<Profile, "name" | "employers" | "evidence">): WorkCoverage[] {
  return profile.employers.map((employer, employerIndex) => {
    const distinct = new Set(profile.evidence.filter(item => item.sources.length > 0 && !isEmploymentOnlyClaim(item.claim, profile.name) && inferEmployerIndex(item.claim, profile.employers) === employerIndex).map(item => normalized(item.claim)));
    const evidenceCount = distinct.size;
    return {
      employerIndex,
      company: employer.company,
      evidenceCount,
      status: evidenceCount >= 2 ? "covered" : evidenceCount ? "limited" : "missing",
      note: evidenceCount >= 2 ? "Multiple public work details found; this is not a complete employment record." : evidenceCount ? "Only one concrete work detail found." : "No sourced work details found yet."
    };
  });
}
export function remapInitialGrounding(fields: Grounding[], evidenceIndices: Map<number, number>, employerIndices: Map<number, number>): Grounding[] {
  return fields.flatMap(field => {
    const match = /^(evidence|employers)\[(\d+)\](.*)$/.exec(field.field);
    if (!match) return [field];
    const target = (match[1] === "evidence" ? evidenceIndices : employerIndices).get(Number(match[2]));
    return target === undefined ? [] : [{
      ...field,
      field: `${match[1]}[${target}]${match[3]}`
    }];
  });
}

/** Keep selected claims intact; reject oversized input instead of silently dropping facts. */
export function limitedCandidateContext(profile: Profile) {
  const context = candidateContext(profile);
  if (context.evidence.reduce((total, item) => total + item.claim.length, 0) > 35_000) throw new AppError("Keep the selected experience to about 35,000 characters for this MVP.", 413, "PROFILE_TOO_LARGE");
  return context;
}
