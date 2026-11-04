/**
 * Assemble resume data and plain-text export from selected work. The frontend renders this document; backend checks reuse the conservative work-attribution helpers. This file makes no research calls.
 */
import type { Employer, Profile, ResumeBullet, RoleResult } from "../types.ts";
import { contactIssues } from "./contact.ts";
import { normalizeEmployer } from "../validation.ts";
import { isIncludedEmployer } from "../candidate/employment.ts";
export type ResumeDocument = {
  name: string;
  contact: string;
  summary: string;
  skills: string[];
  experience: Array<Employer & {
    sourceIndex: number;
    bullets: ResumeBullet[];
  }>;
  selectedWork: ResumeBullet[];
  issues: string[];
};
function words(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Reject a bare employment fact, while keeping facts that also describe work. */
export function isEmploymentOnlyClaim(claim: string, name = ""): boolean {
  let statement = claim.trim();
  if (name && statement.toLowerCase().startsWith(name.trim().toLowerCase())) statement = statement.slice(name.trim().length).trim();
  statement = statement.replace(/^(?:he|she|they|i)\s+/i, "");
  const employment = /^(?:(?:is|was|has been|had been)\s+(?:(?:currently|previously|formerly)\s+)?(?:an?\s+)?[^.!?]{0,140}\b(?:at|for|with)\b|(?:(?:currently|previously|formerly)\s+)?(?:works?|worked|serves?|served)\s+(?:as\b[^.!?]{0,120}\b(?:at|for)|at\b)|(?:joined|left)\s+\S+)/i.test(statement);
  if (!employment) return false;
  // A second clause can contain a real contribution; do not discard it.
  return !/\b(?:where|responsible for|helping|leading|including|by)\b|;|\band\s+(?:built|created|designed|developed|led|launched|wrote|published|delivered|organized|managed|implemented|improved)\b/i.test(statement);
}

/** Only explicit, unambiguous work-to-employer relationships may be grouped. */
export function inferEmployerIndex(claim: string, employers: Employer[]): number | undefined {
  const normalized = words(claim);
  // Keep punctuation so a company prefix cannot swallow a longer event name.
  const statement = claim.normalize("NFKC").toLowerCase();
  const event = /\b(?:conferences?|events?|meetups?|summits?|workshops?|webinars?|talks?|presentations?|panels?|keynotes?|spoke|speaking|attended)\b/u.test(normalized);
  const companyEnd = "(?=$|[.,;:!?()]|\\s+(?:and|where|while|when|during|using|on|with|to|by|from|between|in|as|through|that|before|after)\\b)";
  const matches = employers.flatMap((employer, index) => {
    const names = [...new Set([words(employer.company), words(normalizeEmployer(employer.company))])].filter(name => name.length >= 3);
    const mentioned = names.some(name => ` ${normalized} `.includes(` ${name} `));
    const related = names.some(name => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[^\\p{L}\\p{N}]+");
      const atCompany = new RegExp(`\\bat (?:the )?${escaped}${companyEnd}`, "u").test(statement);
      const forCompany = new RegExp(`\\bfor (?:the )?${escaped}${companyEnd}`, "u").test(statement);
      const employed = new RegExp(`\\b(?:(?:work(?:s|ed|ing)?|employed) (?:as [^.!?;]{1,120}? )?(?:at|for|by)|employee of) (?:the )?${escaped}${companyEnd}`, "u").test(statement);
      // An event's venue or host is not an employer. Keep event work separate
      // unless the claim independently establishes employment or work for it.
      return employed || forCompany || atCompany && !event;
    });
    return mentioned ? [{
      index,
      related
    }] : [];
  });
  if (matches.length === 1) return matches[0].related ? matches[0].index : undefined;
  // Separate roles or tenures at the same employer need an explicit unique
  // role/date anchor in the original claim. Never assign to the first entry.
  if (!matches.length || matches.some(item => !item.related) || new Set(matches.map(item => normalizeEmployer(employers[item.index].company))).size !== 1) return undefined;
  const containsPhrase = (value: string) => !!value && ` ${normalized} `.includes(` ${value} `);
  const anchored = matches.filter(item => {
    const employer = employers[item.index];
    const role = words(employer.role);
    const period = words(employer.period);
    const uniqueRole = !!role && matches.filter(other => words(employers[other.index].role) === role).length === 1;
    const uniquePeriod = /\d{4}/.test(period) && matches.filter(other => words(employers[other.index].period) === period).length === 1;
    const escapedRole = role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const roleAnchor = uniqueRole && new RegExp(`\\b(?:as(?: an?)?|(?:in|held) the) ${escapedRole}(?= (?:at|for|role|position|from|during|between|in)\\b|$)`, "u").test(normalized);
    const periodAnchor = uniquePeriod && containsPhrase(period) && (!/^\d{4}$/.test(period) || new RegExp(`\\b(?:in|during|from|since) ${period}\\b|\\(${period}\\)`, "u").test(statement));
    return roleAnchor || periodAnchor;
  });
  return anchored.length === 1 ? anchored[0].index : undefined;
}

/** One document model supplies the preview, plain-text copy and export checks. */
export function buildResumeDocument(profile: Profile, role: RoleResult, contact = ""): ResumeDocument {
  const evidence = new Map(profile.evidence.filter(item => item.confirmed).map(item => [item.id, item]));
  const experience = profile.employers.map((employer, sourceIndex) => ({
    ...employer,
    sourceIndex,
    bullets: [] as ResumeBullet[]
  }));
  const selectedWork: ResumeBullet[] = [];
  const seen = new Set<string>();
  const issues: string[] = [];
  let missingSupport = false;
  for (const item of role.bullets) {
    const text = item.text.trim();
    const fact = evidence.get(item.evidenceId);
    if (!text) continue;
    if (!fact) {
      missingSupport = true;
      continue;
    }
    if (isEmploymentOnlyClaim(fact.claim, profile.name) || isEmploymentOnlyClaim(text, profile.name)) continue;
    const key = words(text);
    if (seen.has(key)) continue;
    seen.add(key);
    const inferred = inferEmployerIndex(fact.claim, profile.employers);
    // The backend checks generated indices; an editor choice is a user correction.
    // Missing indices in older drafts can be recovered from explicit source text.
    const employerIndex = item.employerIndex === undefined ? inferred : Number.isInteger(item.employerIndex) && item.employerIndex >= 0 && item.employerIndex < experience.length ? item.employerIndex : undefined;
    const bullet = {
      ...item,
      text,
      employerIndex
    };
    if (employerIndex !== undefined && experience[employerIndex] && isIncludedEmployer(experience[employerIndex])) experience[employerIndex].bullets.push(bullet);else selectedWork.push(bullet);
  }
  const summary = role.summary.trim();
  if (!profile.name.trim()) issues.push("Add your name before exporting.");
  issues.push(...contactIssues(contact));
  if (seen.size < 2) issues.push("Add or select more work evidence; this draft needs at least two concrete contributions.");
  if (missingSupport) issues.push("Some contributions no longer have selected evidence. Regenerate the draft.");
  if (experience.some(item => item.status === "uncertain")) issues.push("Review the employment marked uncertain in your profile before exporting.");
  return {
    name: profile.name.trim(),
    contact: contact.trim(),
    summary,
    skills: [...new Set((role.skills ?? []).map(skill => skill.trim()).filter(Boolean))],
    experience: experience.filter(isIncludedEmployer),
    selectedWork,
    issues
  };
}
export function resumePlainText(document: ResumeDocument): string {
  const sections: string[] = [document.name];
  const detailed = document.experience.filter(item => item.bullets.length > 0);
  const additional = document.experience.filter(item => !item.bullets.length && item.status !== "uncertain" && item.company.trim() && (item.role.trim() || item.period.trim()));
  if (document.contact) sections.push(document.contact);
  if (document.summary) sections.push(`PROFESSIONAL SUMMARY\n${document.summary}`);
  if (document.skills.length) sections.push(`SKILLS\n${document.skills.join(" · ")}`);
  if (detailed.length) sections.push("PROFESSIONAL EXPERIENCE\n" + detailed.map(employer => [[employer.company, employer.period].filter(Boolean).join(" | "), employer.role, ...employer.bullets.map(bullet => `• ${bullet.text}`)].filter(Boolean).join("\n")).join("\n\n"));
  if (document.selectedWork.length) sections.push(`SELECTED PROJECTS & CONTRIBUTIONS\n${document.selectedWork.map(bullet => `• ${bullet.text}`).join("\n")}`);
  if (additional.length) sections.push("ADDITIONAL EXPERIENCE\n" + additional.map(employer => [employer.company, employer.role, employer.period].filter(Boolean).join(" | ")).join("\n"));
  return sections.filter(Boolean).join("\n\n");
}
