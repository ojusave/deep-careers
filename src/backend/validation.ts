/**
 * Validate the data sent to a research workflow before spending an Exa call.
 * Inputs are unknown browser data; outputs are the typed profile, preferences or job.
 * These checks enforce selected inputs and user choices, not factual truth.
 */
import type { Opportunity, Preferences, Profile, RequirementAssessment } from '../shared/types.ts';
import { citations, selectedEvidence, isExcluded, record, safeUrl, strings } from '../shared/validation.ts';
import { clarifyTargetRole, matchesTargetRole } from '../shared/jobs/role-intent.ts';
import { matchesSearchRequest, searchRequestContext } from '../shared/jobs/request-context.ts';
import { normalizeEmployers } from '../shared/candidate/employment.ts';
import { AppError } from './errors.ts';

/** Read a bounded string and explain missing or oversized input to the user. */
export function text(value: unknown, label = "Text", max = 2000, required = false): string {
  if (typeof value !== "string") {
    if (required) throw new AppError(`${label} is required.`);
    return "";
  }
  const result = value.trim();
  if (result.length > max) throw new AppError(`${label} is too long.`);
  if (required && !result) throw new AppError(`${label} is required.`);
  return result;
}

/** A downstream workflow needs a resolved identity and at least one selected fact. */
export function validateProfile(value: unknown): Profile {
  const p = record(value);
  const clarification = text(p.clarification, "Clarification", 2000);
  if (clarification) throw new AppError("Resolve the identity question before searching for roles.", 409, "CLARIFICATION_REQUIRED");
  const evidence = Array.isArray(p.evidence) ? p.evidence.slice(0, 80).map((v, i) => {
    const e = record(v);
    const sources = citations(e.sources);
    // Keep provenance and known provider confidence labels without treating
    // either as verification or inventing a citation for an edited claim.
    const confidence = ["low", "medium", "high", "user-provided"].includes(String(e.confidence)) ? String(e.confidence) : undefined;
    const sourceExcerpts = Array.isArray(e.sourceExcerpts) ? e.sourceExcerpts.slice(0, 3).flatMap(value => {
      const excerpt = record(value);
      const url = safeUrl(excerpt.url);
      return url && sources.some(source => source.url === url) && typeof excerpt.text === "string" ? [{
        url,
        text: excerpt.text.slice(0, 2000)
      }] : [];
    }) : [];
    return {
      id: text(e.id, "Evidence ID", 100, true),
      claim: text(e.claim, `Evidence ${i + 1}`, 3000, true),
      sources,
      sourceExcerpts,
      ...(confidence ? { confidence } : {}),
      confirmed: e.confirmed === true
    };
  }) : [];
  if (new Set(evidence.map(e => e.id)).size !== evidence.length) throw new AppError("Evidence IDs must be unique.");
  const employers = normalizeEmployers(Array.isArray(p.employers) ? p.employers.slice(0, 30).map(v => {
    const e = record(v);
    return {
      company: text(e.company, "Company", 200, true),
      role: text(e.role, "Role", 300),
      period: text(e.period, "Period", 300),
      status: e.status,
      sources: citations(e.sources),
      userProvided: e.userProvided === true
    };
  }) : []);
  const profile = {
    name: text(p.name, "Name", 200, true),
    summary: text(p.summary, "Summary", 4000),
    clarification: "",
    employers,
    evidence,
    grounding: [],
    receipt: p.receipt
  } as Profile;
  if (!selectedEvidence(profile).length) throw new AppError("Select at least one experience detail to use.", 409, "EVIDENCE_REQUIRED");
  return profile;
}

/** Keep the user's target function and removable employer exclusions authoritative. */
export function validatePreferences(value: unknown, _profile?: Profile): Preferences {
  const p = record(value);
  const roles = text(p.roles, "Target roles", 500, true);
  const clarification = clarifyTargetRole(roles);
  if (clarification) throw new AppError(`${clarification.question} Choose ${clarification.options.join(", ")}.`, 409, "TARGET_ROLE_AMBIGUOUS");
  return {
    roles,
    location: text(p.location, "Location or work preference", 500, true),
    excludedEmployers: [...new Set(strings(p.excludedEmployers, 30, 200))]
  };
}

/** Recheck a selected job, because browser-supplied data may be stale or edited. */
export function validateJob(value: unknown, preferences: Preferences): Opportunity {
  const j = record(value);
  const company = text(j.company, "Company", 200, true);
  if (isExcluded(company, preferences.excludedEmployers)) throw new AppError("This employer is excluded from your search.", 409, "EXCLUDED_EMPLOYER");
  const title = text(j.title, "Job title", 300, true);
  if (!matchesTargetRole(title, preferences.roles)) throw new AppError("This role does not match your requested function. Refresh the role search.", 409, "TARGET_ROLE_MISMATCH");
  if (j.fitVersion === 2 && !matchesSearchRequest(j.requestContext, preferences)) throw new AppError("Your search changed. Find roles again before creating this resume.", 409, "SEARCH_REQUEST_CHANGED");
  const url = safeUrl(j.url);
  if (!url) throw new AppError("A valid public job posting URL is required.");
  if (Array.isArray(j.assessment) && j.assessment.length > 20) throw new AppError("Refresh this role's fit assessment.", 409, "FIT_REVIEW_REQUIRED");
  const assessment: RequirementAssessment[] = Array.isArray(j.assessment) ? j.assessment.map(value => {
    const item = record(value);
    if (!["core", "required", "preferred"].includes(String(item.importance)) || !["direct", "transferable", "missing"].includes(String(item.support))) throw new AppError("Refresh this role's fit assessment.", 409, "FIT_REVIEW_REQUIRED");
    return {
      id: text(item.id, "Requirement ID", 250, true),
      text: text(item.text, "Requirement", 2000, true),
      importance: item.importance as RequirementAssessment["importance"],
      support: item.support as RequirementAssessment["support"],
      evidenceIds: strings(item.evidenceIds, 30, 100),
      reason: text(item.reason, "Fit assessment", 2000),
      sources: citations(item.sources)
    };
  }) : [];
  return {
    id: text(j.id, "Job ID", 200, true),
    company,
    title,
    location: text(j.location, "Location", 500),
    url,
    whyMatch: text(j.whyMatch, "Match explanation", 2000),
    evidenceIds: strings(j.evidenceIds, 50, 100),
    requirements: strings(j.requirements),
    gaps: strings(j.gaps),
    status: j.status === "open" ? "open" : "uncertain",
    sources: citations(j.sources),
    assessment,
    fitVersion: j.fitVersion === 2 ? 2 : undefined,
    ...(j.fitVersion === 2 ? { requestContext: searchRequestContext(preferences) } : {})
  };
}
