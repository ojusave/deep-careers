/**
 * Shared data shapes used by the interface and the server.
 * These types describe data; they do not run searches or hold credentials.
 * Read Profile → Opportunity → RoleResult to follow the user journey.
 */

/** A link to a public source page. */
export type Citation = {
  url: string;
  title: string;
};

/** A real provider event or application stage shown in the activity panel. */
export type Activity = {
  id: string;
  label: string;
  detail?: string;
  state: "running" | "complete" | "failed";
  sources?: Citation[];
  origin?: "exa" | "app";
  eventType?: string;
  at?: number;
  scope?: string;
};

/** Connects a field in a generated result to its supporting source links. */
export type Grounding = {
  field: string;
  citations: Citation[];
  confidence?: "low" | "medium" | "high";
};

/** Records the cost and timing actually returned for one Deep request. */
export type Receipt = {
  stage: "candidate" | "opportunities" | "role";
  type: "deep";
  requestId: string;
  elapsedMs: number;
  costDollars?: number;
  sourceCount: number;
  retrievedAt: string;
};

/** A distinct professional profile returned by identity search, still awaiting the user's choice. */
export type IdentityCandidate = {
  id: string;
  name: string;
  headline: string;
  employer: string;
  profileUrl: string;
  sources: Citation[];
  /** A server-signed continuation; the browser cannot invent a confirmation. */
  confirmationToken: string;
};

/** An unresolved identity stays in the original input card for clarification. */
export type IdentityResolution = {
  kind: "identity";
  query: string;
  question: string;
  candidates: IdentityCandidate[];
  /** Token-expiry and other local recovery questions have no provider receipt. */
  receipt?: Receipt;
  grounding?: Grounding[];
};

/** Workflow 01 returns either an identity checkpoint or a researched profile. */
export type CandidateResearchResult = Profile | IdentityResolution;

/** One employment entry. The same company can appear more than once. */
export type Employer = {
  company: string;
  role: string;
  period: string;
  /** Current employment, or the most recent employment when no current role is known. */
  status: "current" | "earlier" | "uncertain";
  sources: Citation[];
  /** Explicitly edited by the person; this is supplied information, not source verification. */
  userProvided?: boolean;
};

/** A researched work claim. Only selected claims can support a job or resume. */
export type Evidence = {
  id: string;
  claim: string;
  sources: Citation[];
  sourceExcerpts?: {
    url: string;
    text: string;
  }[];
  confidence?: string;
  /** Legacy field name: means selected for use, not independently verified or manually reviewed. */
  confirmed: boolean;
};

/** Tracks what was found for one employment entry; a count is not proof of completeness. */
export type WorkCoverage = {
  employerIndex: number;
  company: string;
  evidenceCount: number;
  status: "covered" | "limited" | "missing";
  note: string;
  researched?: boolean;
  outcome?: "evidence_found" | "no_public_detail" | "source_unavailable" | "failed";
};

/** The resolved person and their professional evidence. */
export type Profile = {
  name: string;
  summary: string;
  clarification: string;
  employers: Employer[];
  evidence: Evidence[];
  receipt: Receipt;
  grounding: Grounding[];
  workCoverage?: WorkCoverage[];
  researchReceipts?: Receipt[];
  researchWarnings?: string[];
};

/** The next role the user wants, including removable employer exclusions. */
export type Preferences = {
  roles: string;
  location: string;
  excludedEmployers: string[];
};

/** Maps one job requirement to direct, transferable, or missing experience. */
export type RequirementAssessment = {
  id: string;
  text: string;
  importance: "core" | "required" | "preferred";
  support: "direct" | "transferable" | "missing";
  evidenceIds: string[];
  reason: string;
  sources: Citation[];
};

/** A discovered job, with its later qualification result when available. */
export type Opportunity = {
  id: string;
  company: string;
  title: string;
  location: string;
  url: string;
  whyMatch: string;
  evidenceIds: string[];
  requirements: string[];
  gaps: string[];
  status: "open" | "uncertain";
  sources: Citation[];
  assessment?: RequirementAssessment[];
  fitVersion?: number;
  /** Search preferences evaluated by Deep; a changed request needs a new assessment. */
  requestContext?: Preferences;
};

/** The qualified shortlist and the receipts for finding and checking it. */
export type OpportunitiesResult = {
  jobs: Opportunity[];
  receipt: Receipt;
  grounding: Grounding[];
  excludedCount: number;
  roleFilteredCount?: number;
  fitFilteredCount?: number;
  researchReceipts?: Receipt[];
  missingEvidence?: string[];
  fitVersion?: number;
};

/** One resume contribution linked to both a fact and relevant job requirements. */
export type ResumeBullet = {
  evidenceId: string;
  text: string;
  employerIndex?: number;
  requirementIds?: string[];
};

/** The draft returned after role research and a separate factual review. */
export type RoleResult = {
  summary: string;
  priorities: string[];
  bullets: ResumeBullet[];
  skills?: string[];
  qualityNotes?: string[];
  gaps: string[];
  changes: string[];
  receipt: Receipt;
  grounding: Grounding[];
  sources: Citation[];
  researchReceipts?: Receipt[];
  reviewVersion?: number;
};

/** The workspace data held in memory for the current page session. */
export type SavedWorkspace = {
  version: 1;
  input: string;
  profile: Profile | null;
  preferences: Preferences;
  opportunities: OpportunitiesResult | null;
  selectedJobId: string | null;
  role: RoleResult | null;
  identity?: IdentityResolution | null;
};
