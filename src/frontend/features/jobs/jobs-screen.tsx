/**
 * Opens immediately for workflow 02, showing live activity before the shortlist arrives.
 * Selecting a different role discards the old role-specific draft.
 * Requirement mappings and source receipts stay available in expandable details.
 */
import type { ReactNode, RefObject } from "react";
import type { OpportunitiesResult, Opportunity, Profile } from "@/shared/types";
import type { Screen, Workspace } from "@/frontend/browser/workspace";
import { safeHref } from "@/frontend/browser/research-stream";
import { Arrow } from "@/frontend/components/arrow";
import { Sources } from "@/frontend/components/sources";
import { ResearchReceipt } from "@/frontend/components/research-receipt";
type JobsActions = {
  navigate: (screen: Screen) => void;
  findJobs: () => void;
  selectJob: (job: Opportunity) => void;
  tailor: (job: Opportunity) => void;
};
type JobsScreenProps = {
  workspace: Workspace;
  opportunities: OpportunitiesResult | null;
  profile: Profile | null;
  selectedJob: Opportunity | null;
  busy: string | null;
  heading: RefObject<HTMLHeadingElement | null>;
  activity?: ReactNode;
  actions: JobsActions;
};
export function JobsScreen({
  workspace,
  opportunities,
  profile,
  selectedJob,
  busy,
  heading,
  activity,
  actions
}: JobsScreenProps) {
  const {
    navigate,
    findJobs,
    selectJob,
    tailor
  } = actions;
  const unresolved = selectedJob?.assessment?.filter(item => item.importance !== "preferred" && item.support !== "direct") ?? [];
  return <section className="jobs-screen no-print">
    <div className="section-heading">
      <div>
        <h1 ref={heading} tabIndex={-1}>Roles</h1>
        <p>{workspace.preferences.roles} · {workspace.preferences.location}</p>
      </div>
      <div className="section-actions">
        <button
          className="text-button"
          disabled={Boolean(busy)}
          onClick={() => navigate("profile")}
        >Preferences</button>
        <button
          className="secondary-button"
          disabled={Boolean(busy)}
          onClick={() => findJobs()}
        >{busy === "opportunities" ? "Searching…" : opportunities ? "Refresh" : "Try again"}</button>
      </div>
    </div>
    {activity}
    {/* No result means the request is pending or interrupted, not that Deep found zero matches. */}
    {opportunities && (opportunities.jobs.length ? <div className="jobs-grid">
      <div className="job-list" aria-label="Roles">
        {opportunities.jobs.map(job => <button
          key={job.id}
          className={`job-card ${selectedJob?.id === job.id ? "selected" : ""}`}
          aria-pressed={selectedJob?.id === job.id}
          disabled={Boolean(busy)}
          onClick={() => selectJob(job)}
        >
          <span className="company-line">
            {job.company}
          </span>
          <h2>
            {job.title}
          </h2>
          <span className="job-location">
            {job.location}
          </span>
        </button>)}
      </div>
      {selectedJob && <article className="job-detail">
        <div className="job-detail-top">
          <span className="quiet-label">
            {selectedJob.company}
          </span>
          <a
            className="text-link"
            href={safeHref(selectedJob.url)}
            target="_blank"
            rel="noopener noreferrer"
          >Posting ↗</a>
        </div>
        <h2>
          {selectedJob.title}
        </h2>
        <p className="job-location">
          {selectedJob.location}
        </p>
        <p className="quiet-label">Potential match · review fit and eligibility</p>
        <div className="fit-highlight">
          <p>
            {selectedJob.whyMatch}
          </p>
        </div>
        {unresolved.length > 0 && <details className="details-block" open>
          <summary>Needs review · {unresolved.length} requirements</summary>
          <p className="small muted">Public research does not establish every requirement. These gaps are not claimed in your resume.</p>
          <ul className="plain-list">
            {unresolved.map(item => <li key={item.id}>{item.text} <span className="quiet-label">— {item.support === "missing" ? "Not established" : "Transferable experience only"}</span></li>)}
          </ul>
        </details>}
        <details className="details-block">
          <summary>Why this fits</summary>
          <ul className="matching-evidence">
            {selectedJob.assessment?.map(requirement => <li key={requirement.id}>
              <p>
                {requirement.text}
              </p>
              <span className="quiet-label">{requirement.support === "direct" ? "Direct evidence" : requirement.support === "transferable" ? "Transferable experience" : "Not established"} · {requirement.importance}</span>
              <p className="small muted">
                {requirement.reason}
              </p>
              <Sources sources={requirement.sources} />
            </li>)}
          </ul>
        </details>
        <details className="details-block">
          <summary>Relevant experience</summary>
          <ul className="matching-evidence">
            {selectedJob.evidenceIds.map(id => profile?.evidence.find(item => item.id === id)).filter(item => Boolean(item?.confirmed)).map(item => item && <li key={item.id}>
              <p>
                {item.claim}
              </p>
              <Sources sources={item.sources} />
            </li>)}
          </ul>
        </details>
        {selectedJob.gaps.length > 0 && <details className="details-block">
          <summary>Gaps <span className="quiet-label">
              {selectedJob.gaps.length}
            </span></summary>
          <ul className="plain-list">
            {selectedJob.gaps.map((gap, index) => <li key={index}>
              {gap}
            </li>)}
          </ul>
        </details>}
        <details className="details-block">
          <summary>Research</summary>
          <p className="small muted">
            {selectedJob.status === "open" ? "Reported open by Deep" : "Availability needs checking"}
          </p>
          <Sources sources={selectedJob.sources} />
          {(opportunities.researchReceipts ?? [opportunities.receipt]).map((receipt, index) => <ResearchReceipt
            key={index}
            receipt={receipt}
            label={index ? "Fit check" : "Discovery"}
          />)}
        </details>
        <div className="job-detail-bottom">
          <button
            className="primary-button"
            disabled={Boolean(busy)}
            onClick={() => workspace.role ? navigate("resume") : tailor(selectedJob)}
          >{busy === "role" ? "Drafting…" : workspace.role ? "View resume" : "Create resume"} {!busy && <Arrow />}</button>
        </div>
      </article>}
    </div> : <div className="empty-state">
      <h2>No supported matches yet</h2>
      <p>The researched roles did not establish enough fit with your selected experience.</p>
      {Boolean(opportunities.missingEvidence?.length) && <details className="details-block">
        <summary>Experience to clarify</summary>
        <ul className="plain-list">
          {opportunities.missingEvidence!.map((item, index) => <li key={index}>
            {item}
          </li>)}
        </ul>
      </details>}
      <button className="secondary-button" onClick={() => navigate("profile")}>Review profile & preferences</button>
    </div>)}
  </section>;
}
