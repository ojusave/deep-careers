/**
 * Workflow 03: create a role-specific resume from selected candidate work evidence.
 * Read next: resume/draft.ts, then resume/review.ts. The browser renders the result and asks the person to review it before export.
 */
import type { RoleResult } from "../../shared/types.ts";
import type { EmitActivity } from "../providers/exa/deep.ts";
import { draftResume, prepareResumeInput } from "../features/resume/draft.ts";
import { applyResumeReview, reviewResumeDraft } from "../features/resume/review.ts";
export async function tailorResume(body: Record<string, unknown>, options: {
  signal?: AbortSignal;
  emit?: EmitActivity;
} = {}): Promise<RoleResult> {
  // 1. Reject stale job assessments and excluded work before spending on Deep.
  const input = prepareResumeInput(body);

  // 2. Research the selected role and draft bullets linked to its requirements.
  const draft = await draftResume(input, options);

  // 3. Use a separate Deep request to check meaning, relevance, and attribution.
  const review = await reviewResumeDraft({
    profile: {
      ...input.profile,
      employers: input.includedEmployers
    },
    job: input.job,
    requirements: input.requirements,
    summary: draft.summary,
    bullets: draft.bullets,
    skills: draft.skills
  }, options);

  // 4. Remove unsupported material and return the reviewable document data.
  const result = applyResumeReview(draft, review);
  // Qualification gaps must survive drafting and review unchanged.
  return {...result, gaps: [...new Set([...input.job.gaps, ...result.gaps])]};
}
