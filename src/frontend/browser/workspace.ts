/**
 * Defines the current session: profile, preferences, results and review choices.
 * Main keeps this data in React memory, so a browser reload starts fresh.
 * Identity helpers validate server responses and prepare follow-up requests.
 */
import type { ResumeContact } from "../../shared/resume/contact.ts";
import type { IdentityResolution, SavedWorkspace } from "../../shared/types.ts";
import { safeUrl } from "../../shared/validation.ts";
export type Screen = "start" | "profile" | "jobs" | "resume";
export type Workspace = SavedWorkspace & {
  contact: string;
  contactInfo?: ResumeContact;
  resumeReviewed: boolean;
  identity?: IdentityResolution | null;
  identityPending?: boolean;
};
const LEGACY_STORAGE_KEY = "next-move.workspace.v1";

/** Remove only this app's old saved session; leave other browser data alone. */
export function clearLegacyWorkspace(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(LEGACY_STORAGE_KEY);
  storage.removeItem(`${LEGACY_STORAGE_KEY}.before-fit-review`);
}
export const initialWorkspace = (): Workspace => ({
  version: 1,
  input: "",
  profile: null,
  preferences: {
    roles: "Open to suitable roles",
    location: "Any location",
    excludedEmployers: []
  },
  opportunities: null,
  selectedJobId: null,
  role: null,
  contact: "",
  resumeReviewed: false,
  identity: null,
  identityPending: false
});
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function citations(value: unknown): boolean {
  return Array.isArray(value)
    && value.every(item => object(item) && typeof item.url === "string" && typeof item.title === "string");
}
function validReceipt(value: unknown): boolean {
  return object(value) && ["candidate", "opportunities", "role"].includes(String(value.stage)) && value.type === "deep"
    && typeof value.requestId === "string"
    && typeof value.elapsedMs === "number"
    && Number.isFinite(value.elapsedMs)
    && typeof value.sourceCount === "number"
    && typeof value.retrievedAt === "string"
    && (value.costDollars === undefined || typeof value.costDollars === "number");
}
function validGrounding(value: unknown): boolean {
  return Array.isArray(value)
    && value.every(item => object(item) && typeof item.field === "string" && citations(item.citations));
}
/** Unresolved identity choices are display data; the browser never chooses a person itself. */
export function isIdentityResolution(value: unknown): value is IdentityResolution {
  return object(value) && value.kind === "identity" && typeof value.query === "string"
    && typeof value.question === "string" && Array.isArray(value.candidates)
    && value.candidates.every(candidate => object(candidate)
      && [candidate.id, candidate.name, candidate.headline, candidate.employer, candidate.confirmationToken].every(item => typeof item === "string")
      && Boolean(safeUrl(candidate.profileUrl)) && citations(candidate.sources))
    && (value.receipt === undefined || validReceipt(value.receipt))
    && (value.grounding === undefined || validGrounding(value.grounding));
}

/** Preserve useful context without repeatedly appending boilerplate or the same answer. */
export function appendIdentityAnswer(query: string, answer: string): string | null {
  const clean = answer.trim();
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const existing = normalize(query);
  const added = normalize(clean);
  if (!added || ` ${existing} `.includes(` ${added} `)) return null;
  return `${query.trim()}\n${clean}`;
}

/** Explicit choices use a signed token. Free-text follow-ups ask Deep to resolve the identity again. */
export function identityConfirmationRequest(identity: IdentityResolution, candidateId: string) {
  const candidate = identity.candidates.find(item => item.id === candidateId);
  return candidate?.confirmationToken ? { input: identity.query, selectionToken: candidate.confirmationToken } : null;
}
