/**
 * Step 01b: research every identified employment entry with its own Deep request.
 * Input: the resolved profile. Output: the same profile enriched with sourced work, gaps, and receipts. Two workers run at a time.
 */
import { runDeep, type DeepResponse, type EmitActivity } from "../../providers/exa/deep.ts";
import type { Profile, WorkCoverage } from "../../../shared/types.ts";
import { AppError } from "../../errors.ts";
import { citations, citationsFor } from "../../../shared/validation.ts";
import { inferEmployerIndex, isEmploymentOnlyClaim } from "../../../shared/resume/document.ts";
import { researchRules } from "./identify.ts";
import { workEvidenceSchema } from "./schemas.ts";
import { assessWorkCoverage, boundProfileExcerpts, claimGrounding, excerptsFor, normalized, outputText, requireArray, rows } from "./evidence.ts";
export async function researchWorkHistory(profile: Profile, options: {
  signal?: AbortSignal;
  emit?: EmitActivity;
} = {}): Promise<Profile> {
  const seen = new Set(profile.evidence.map(item => normalized(item.claim)));
  profile.workCoverage = assessWorkCoverage(profile);
  if (!profile.employers.length) {
    boundProfileExcerpts(profile.evidence);
    return profile;
  }
  options.emit?.({
    id: "work-coverage",
    origin: "app",
    at: Date.now(),
    label: "Researching each role",
    detail: `${profile.employers.length} employment entries will each receive a focused Deep request.`,
    state: "running"
  });
  const identitySources = citations([...citationsFor(profile.grounding, "name"), ...profile.employers.flatMap(employer => employer.sources), ...profile.evidence.flatMap(item => item.sources)]).slice(0, 20);
  type EmploymentResearch = {
    result?: DeepResponse;
    failure?: string;
    receipt?: DeepResponse["receipt"];
  };
  const researched: EmploymentResearch[] = new Array(profile.employers.length);
  let nextIndex = 0;
  let cancellation: unknown;
  const worker = async () => {
    while (nextIndex < profile.employers.length && !cancellation && !options.signal?.aborted) {
      const employerIndex = nextIndex++;
      const employer = profile.employers[employerIndex];
      const roleLabel = `${employer.company}${employer.role ? ` · ${employer.role}` : ""}`;
      options.emit?.({
        id: `work:${employerIndex}:coverage`,
        origin: "app",
        scope: roleLabel,
        at: Date.now(),
        label: `Researching ${roleLabel}`,
        detail: "A focused Deep request is starting for this employment entry.",
        state: "running"
      });
      try {
        const result = await runDeep({
          stage: "candidate",
          outputSchema: workEvidenceSchema,
          fullText: true,
          query: `Research the specific work performed by ${profile.name} in this employment entry. Investigate its responsibilities, projects, deliverables, scope of ownership and supported outcomes, even if some facts have already been found. This research is bounded to accessible public professional evidence, not a claim of complete career coverage.\nIDENTITY ANCHORS: ${JSON.stringify({
            name: profile.name,
            sources: identitySources
          })}\nEMPLOYMENT ENTRY: ${JSON.stringify({
            employerIndex,
            ...employer
          })}\nALREADY FOUND CLAIMS (do not duplicate): ${JSON.stringify(profile.evidence.map(item => item.claim))}`,
          additionalQueries: [`"${profile.name}" "${employer.company}" "${employer.role}" ${employer.period} experience responsibilities projects`, `"${profile.name}" "${employer.company}" authored articles publications case studies`, `"${profile.name}" "${employer.company}" projects contributions portfolio outcomes`, `"${profile.name}" "${employer.company}" talks interviews presentations work`],
          systemPrompt: `${researchRules}
This is a focused follow-up for one established professional identity. Cross-check the supplied identity anchors, role and dates before attributing work. Do not merge another person with the same name or turn general company achievements into this person's work.
Inspect accessible role descriptions, detailed biographies and primary work sources. Seek up to 6 distinct substantive facts for this employment entry. Search beyond the profile headline and the most visible current work. Investigate official work pages, authored work, projects and talks as appropriate to this occupation. Use GitHub only when relevant and verify actual contribution; repository ownership, forks and mentions alone do not prove authorship or employment.
Each finding must reference the supplied employerIndex. Start every claim with the candidate's exact name, describe one specific action, responsibility or result, and explicitly establish the employment relationship. When the source ties the work to this specific role or tenure, include the exact role title or period as context; verify those anchors rather than appending a date or title merely because it appears in the input. For repeated roles at one company, do not move a contribution between roles or tenures. For work involving an event, distinguish the venue from the employer and say "while working at" or "while working as [role] at" only if the source establishes that fact. Do not attach outside work to this employer merely to fill a gap. Omit ambiguous or uncited claims.
Return one coverage entry for this employerIndex. State no_public_detail or source_unavailable when appropriate; do not fill an empty role with generic responsibilities. Do not invent source access or hidden/private employment details.`
        }, {
          signal: options.signal,
          emit: options.emit ? activity => options.emit?.({
            ...activity,
            id: `work:${employerIndex}:${activity.id}`,
            scope: roleLabel,
            ...(activity.id === "request" ? {
              label: activity.state === "running" ? `Researching ${roleLabel}` : activity.state === "failed" ? `${roleLabel} request failed` : `${roleLabel} request completed`
            } : {})
          }) : undefined
        });
        researched[employerIndex] = {
          receipt: result.receipt
        };
        requireArray(result.content, "findings");
        requireArray(result.content, "coverage");
        researched[employerIndex] = {
          result,
          receipt: result.receipt
        };
        options.emit?.({
          id: `work:${employerIndex}:coverage`,
          origin: "app",
          scope: roleLabel,
          at: Date.now(),
          label: `${roleLabel} researched`,
          detail: "Focused public research completed; checking the supported findings.",
          state: "complete"
        });
      } catch (error) {
        if (options.signal?.aborted || error instanceof AppError && error.code === "CANCELED") {
          cancellation = error;
          break;
        }
        researched[employerIndex] = {
          receipt: researched[employerIndex]?.receipt,
          failure: error instanceof AppError ? error.message : "Research did not finish."
        };
        options.emit?.({
          id: `work:${employerIndex}:coverage`,
          origin: "app",
          scope: roleLabel,
          at: Date.now(),
          label: `${roleLabel} research incomplete`,
          detail: "Initial findings are preserved.",
          state: "failed"
        });
      }
    }
  };
  // Each person uses two workers. The shared default allows 24 active requests,
  // enough for ten such profiles plus headroom; cancellation awaits in-flight work.
  await Promise.all([worker(), worker()]);
  if (cancellation || options.signal?.aborted) throw cancellation ?? new AppError("Research was canceled.", 499, "CANCELED");
  const outcomes = new Map<number, Pick<WorkCoverage, "outcome" | "note">>();
  researched.forEach((entry, employerIndex) => {
    const company = profile.employers[employerIndex].company;
    if (entry?.receipt) profile.researchReceipts!.push(entry.receipt);
    if (!entry?.result) {
      const note = entry?.failure || "Research did not finish.";
      (profile.researchWarnings ??= []).push(`${company}: ${note}`);
      outcomes.set(employerIndex, {
        outcome: "failed",
        note: "Focused research did not finish; initial findings are preserved."
      });
      return;
    }
    const work = entry.result;
    let accepted = 0;
    rows(work.content.findings).slice(0, 6).forEach((item, originalIndex) => {
      const claim = outputText(item.claim);
      const key = normalized(claim);
      const fields = claimGrounding(work.grounding, `findings[${originalIndex}]`);
      const sources = citations(fields.flatMap(field => field.citations));
      if (item.employerIndex !== employerIndex || !sources.length || !claim || seen.has(key) || !key.startsWith(`${normalized(profile.name)} `) || isEmploymentOnlyClaim(claim, profile.name) || inferEmployerIndex(claim, profile.employers) !== employerIndex || profile.evidence.length >= 80) return;
      const index = profile.evidence.length;
      seen.add(key);
      profile.evidence.push({
        id: `e-${index + 1}`,
        claim,
        sources,
        sourceExcerpts: excerptsFor(sources, work.sourcePages),
        confidence: fields.find(field => field.confidence)?.confidence,
        confirmed: false
      });
      profile.grounding.push(...fields.map(field => ({
        ...field,
        field: `evidence[${index}].claim`
      })));
      accepted++;
    });
    const coverage = rows(work.content.coverage).find(item => item.employerIndex === employerIndex);
    const unavailable = coverage?.outcome === "source_unavailable";
    outcomes.set(employerIndex, {
      outcome: accepted ? "evidence_found" : unavailable ? "source_unavailable" : "no_public_detail",
      note: accepted ? `${accepted} additional sourced work ${accepted === 1 ? "detail" : "details"} found. Public research may still be incomplete.` : unavailable ? outputText(coverage?.note, 500) || "Some role details were inaccessible. Add your experience to fill the gap." : coverage?.outcome === "no_public_detail" && outputText(coverage.note, 500) || "Focused research found no additional supported work details. Add unpublished experience to fill the gap."
    });
  });
  profile.workCoverage = assessWorkCoverage(profile).map(item => ({
    ...item,
    researched: outcomes.get(item.employerIndex)?.outcome !== "failed",
    ...outcomes.get(item.employerIndex)
  }));
  const completed = profile.workCoverage.filter(item => item.researched).length;
  boundProfileExcerpts(profile.evidence);
  options.emit?.({
    id: "work-coverage",
    origin: "app",
    at: Date.now(),
    label: "Role research checked",
    detail: `${completed} of ${profile.employers.length} employment entries received completed focused research.`,
    state: "complete"
  });
  return profile;
}
