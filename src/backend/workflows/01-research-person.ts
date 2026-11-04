/**
 * Workflow 01: turn identifying text into a profile the person can review.
 * Read next: candidate/resolve-identity.ts. Deep first resolves the right person;
 * only ambiguity asks for clarification before career and work-history research.
 */
import type { CandidateResearchResult } from "../../shared/types.ts";
import type { EmitActivity } from "../providers/exa/deep.ts";
import { text } from "../validation.ts";
import { identifyPerson } from "../features/candidate/identify.ts";
import { researchWorkHistory } from "../features/candidate/work-history.ts";
import { identityQuestion, resolveIdentity, sameProfileUrl, verifyIdentityConfirmation, type ConfirmedIdentity } from "../features/candidate/resolve-identity.ts";
import { citationsFor } from "../../shared/validation.ts";
import { normalized } from "../features/candidate/evidence.ts";
import { AppError } from "../errors.ts";
export async function researchCandidate(body: Record<string, unknown>, options: {
  signal?: AbortSignal;
  emit?: EmitActivity;
} = {}): Promise<CandidateResearchResult> {
  // 1. Validate the starting information before making any paid request.
  const input = text(body.input, "Name and professional context", 8000, true);

  // 2. Deep gets one identity task and uses its own research loop. Continue in
  // this same request when its decision and evidence support a resolved match.
  if (options.signal?.aborted) throw new AppError("Research was canceled.", 499, "CANCELED");
  let selectedIdentity: ConfirmedIdentity;
  if (body.selectionToken === undefined) {
    const lookup = await resolveIdentity(input, options);
    if (options.signal?.aborted) throw new AppError("Research was canceled.", 499, "CANCELED");
    if (lookup.kind === "identity") return lookup;
    selectedIdentity = lookup.identity;
  } else {
    const choice = verifyIdentityConfirmation(input, body.selectionToken);
    if (!choice) return identityQuestion(input, "That profile selection expired or changed. Find your profile again before continuing.");
    selectedIdentity = choice;
  }

  // 3. Research exactly the selected person, then verify that Deep retained the anchor.
  const profile = await identifyPerson(input, { ...options, identity: selectedIdentity });
  if (options.signal?.aborted) throw new AppError("Research was canceled.", 499, "CANCELED");
  const selectedProfileGrounded = citationsFor(profile.grounding, "name")
    .some(source => sameProfileUrl(source.url, selectedIdentity.profileUrl));
  if (profile.clarification || normalized(profile.name) !== normalized(selectedIdentity.name) || !selectedProfileGrounded) {
    return {
      ...identityQuestion(input, profile.clarification || "I couldn't verify the selected profile consistently. Add a more specific professional profile link or employer."),
      receipt: profile.receipt
    };
  }
  if (selectedIdentity.resolutionReceipt) profile.researchReceipts = [selectedIdentity.resolutionReceipt, ...(profile.researchReceipts ?? [profile.receipt])];

  // 4. Give every employment entry focused research only after the identity check passes.
  return researchWorkHistory(profile, options);
}
