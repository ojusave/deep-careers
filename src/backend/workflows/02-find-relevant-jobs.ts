/**
 * Workflow 02: discover openings, then qualify them before the user sees them.
 * Input: selected profile evidence and preferences. Output: supported matches, gaps, sources, and both Deep receipts.
 */
import type { OpportunitiesResult } from "../../shared/types.ts";
import type { EmitActivity } from "../providers/exa/deep.ts";
import { validatePreferences, validateProfile } from "../validation.ts";
import { discoverOpportunities } from "../features/jobs/discover.ts";
import { qualifyOpportunities } from "../features/jobs/qualify.ts";
export async function researchOpportunities(body: Record<string, unknown>, options: {
  signal?: AbortSignal;
  emit?: EmitActivity;
} = {}): Promise<OpportunitiesResult> {
  // 1. Only selected candidate evidence may reach the search. Selection is not verification.
  const profile = validateProfile(body.profile);
  const preferences = validatePreferences(body.preferences, profile);

  // 2. Discovery finds possibilities within the requested function and exclusions.
  const result = await discoverOpportunities(profile, preferences, options);
  const {
    excludedCount,
    roleFilteredCount
  } = result;

  // 3. A separate Deep pass reads requirements and can withhold every possibility.
  const qualification = await qualifyOpportunities(profile, preferences, result.jobs, {
    ...options,
    employmentIncluded: body.employmentIncluded === true
  });

  // 4. Keep receipts and grounding from both stages so the result is inspectable.
  return {
    jobs: qualification.jobs,
    excludedCount,
    roleFilteredCount,
    fitFilteredCount: qualification.filteredCount,
    missingEvidence: qualification.missingEvidence,
    fitVersion: 1,
    researchReceipts: [result.receipt, ...(qualification.receipt ? [qualification.receipt] : [])],
    grounding: [...result.grounding, ...qualification.grounding.map(item => ({
      ...item,
      field: `qualification.${item.field}`
    }))],
    receipt: result.receipt
  };
}
