/**
 * Review, edit, and export the role-specific resume produced by workflow 03.
 * The document preview contains only resume content; editing and evidence stay outside it.
 * Export actions remain disabled until contact details and review requirements are met.
 */
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Opportunity, Profile, RoleResult } from "@/shared/types";
import type { ResumeDocument } from "@/shared/resume/document";
import { parseResumeContact, type ResumeContact } from "@/shared/resume/contact";
import type { Screen, Workspace } from "@/frontend/browser/workspace";
import { Sources } from "@/frontend/components/sources";
import { ResearchReceipt } from "@/frontend/components/research-receipt";
import { ResumeDocumentView } from "./resume-preview";
type ResumeActions = {
  navigate: (screen: Screen) => void;
  setResumeEditorOpen: Dispatch<SetStateAction<boolean>>;
  setResumeReviewed: (reviewed: boolean) => void;
  copyResume: () => Promise<void>;
  download: (format: "text" | "json") => void;
  tailor: (job: Opportunity) => void;
  updateContact: (change: Partial<ResumeContact>) => void;
  updateResume: (change: Partial<RoleResult>) => void;
};
type ResumeScreenProps = {
  workspace: Workspace;
  profile: Profile;
  role: RoleResult;
  selectedJob: Opportunity;
  resumeDocument: ResumeDocument;
  busy: string | null;
  heading: RefObject<HTMLHeadingElement | null>;
  resumeEditorOpen: boolean;
  copyComplete: boolean;
  canExport: boolean;
  actions: ResumeActions;
};
export function ResumeScreen({
  workspace,
  profile,
  role,
  selectedJob,
  resumeDocument,
  busy,
  heading,
  resumeEditorOpen,
  copyComplete,
  canExport,
  actions
}: ResumeScreenProps) {
  const {
    navigate,
    setResumeEditorOpen,
    setResumeReviewed,
    copyResume,
    download,
    tailor,
    updateContact,
    updateResume
  } = actions;
  const resumeFix = !workspace.contact.trim() ? "Add contact details." : !role.summary.trim() ? "Add a summary." : "Review the missing details.";
  return <section className="resume-screen">
    <div className="section-heading no-print">
      <div>
        <h1 ref={heading} tabIndex={-1}>Resume</h1>
        <p>{selectedJob.title} · {selectedJob.company}</p>
      </div>
      <button
        className="text-button"
        disabled={Boolean(busy)}
        onClick={() => navigate("jobs")}
      >Back to roles</button>
    </div>
    <p className="small muted no-print">Tailored draft · Review facts and role requirements before applying.</p>
    <div className="resume-toolbar no-print">
      <button
        className="secondary-button"
        disabled={Boolean(busy)}
        aria-expanded={resumeEditorOpen}
        aria-controls="resume-editor"
        onClick={() => setResumeEditorOpen(open => !open)}
      >
        {resumeEditorOpen ? "Preview" : "Edit"}
      </button>
      <div className="resume-toolbar-actions">
        <label className="review-check">
          <input
            type="checkbox"
            checked={workspace.resumeReviewed}
            disabled={Boolean(busy) || Boolean(resumeDocument.issues.length)}
            onChange={event => setResumeReviewed(event.target.checked)}
          />
          <span>Reviewed</span>
        </label>
        <button
          className="primary-button"
          title="Opens the print dialog. Choose Save as PDF."
          disabled={!canExport}
          onClick={() => window.print()}
        >Save PDF</button>
        <details className="resume-downloads">
          <summary>More</summary>
          <div>
            <button
              className="text-button"
              disabled={!canExport}
              onClick={() => void copyResume()}
            >
              {copyComplete ? "Copied" : "Copy text"}
            </button>
            <button
              className="text-button"
              disabled={!canExport}
              onClick={() => download("text")}
            >Download text</button>
            <button
              className="text-button"
              disabled={!canExport}
              onClick={() => download("json")}
            >Download JSON</button>
            <button
              className="text-button"
              disabled={Boolean(busy)}
              onClick={() => tailor(selectedJob)}
            >
              {busy === "role" ? "Regenerating…" : "Regenerate with Deep"}
            </button>
          </div>
        </details>
      </div>
    </div>
    {resumeDocument.issues.length > 0 && <div className="resume-quality no-print" role="status">
      <span>
        {resumeFix}
      </span>
      <div className="section-actions">
        <details>
          <summary>{resumeDocument.issues.length} {resumeDocument.issues.length === 1 ? "item" : "items"}</summary>
          <ul>
            {resumeDocument.issues.map((issue, index) => <li key={index}>
              {issue}
            </li>)}
          </ul>
        </details>
        <button
          className="text-button"
          disabled={Boolean(busy)}
          onClick={() => setResumeEditorOpen(true)}
        >Edit</button>
      </div>
    </div>}
    {resumeEditorOpen && <section
      className="resume-editor no-print"
      id="resume-editor"
      aria-label="Edit resume"
    >
      <fieldset disabled={Boolean(busy)}>
        <label className="field-label" htmlFor="resume-email">Email</label>
        <input
          id="resume-email"
          type="email"
          autoComplete="email"
          required
          value={(workspace.contactInfo ?? parseResumeContact(workspace.contact)).email}
          placeholder="you@example.com"
          onChange={event => updateContact({
            email: event.target.value
          })}
        />
        <label className="field-label" htmlFor="resume-linkedin">LinkedIn</label>
        <input
          id="resume-linkedin"
          type="url"
          required
          value={(workspace.contactInfo ?? parseResumeContact(workspace.contact)).linkedin}
          placeholder="https://www.linkedin.com/in/your-profile"
          onChange={event => updateContact({
            linkedin: event.target.value
          })}
        />
        <label className="field-label" htmlFor="resume-contact">Other contact details <span className="quiet-label">optional</span></label>
        <input
          id="resume-contact"
          value={(workspace.contactInfo ?? parseResumeContact(workspace.contact)).other}
          placeholder="Location · portfolio · phone"
          onChange={event => updateContact({
            other: event.target.value
          })}
        />
        <label className="field-label" htmlFor="resume-summary">Summary <span className="quiet-label">optional</span></label>
        <textarea
          id="resume-summary"
          rows={4}
          value={role.summary}
          onChange={event => updateResume({
            summary: event.target.value
          })}
        />
        {Boolean(role.skills?.length) && <div className="resume-editor-skills">
          <span className="field-label">Skills</span>
          <div className="chips">
            {role.skills!.map(skill => <span className="chip" key={skill}>
              {skill}
              <button
                type="button"
                aria-label={`Remove skill ${skill}`}
                onClick={() => updateResume({
                  skills: role!.skills!.filter(item => item !== skill)
                })}
              >×</button>
            </span>)}
          </div>
        </div>}
        <div className="resume-editor-bullets">
          <h2>Contributions</h2>
          {role.bullets.map((bullet, index) => {
            const evidence = profile.evidence.find(item => item.id === bullet.evidenceId);
            const inferred = resumeDocument.experience.find(employer => employer.bullets.some(item => item.evidenceId === bullet.evidenceId))?.sourceIndex ?? -1;
            return <div className="resume-edit-bullet" key={`${bullet.evidenceId}-${index}`}>
            <label className="sr-only" htmlFor={`resume-bullet-${index}`}>Contribution {index + 1}</label>
            <textarea
              id={`resume-bullet-${index}`}
              rows={3}
              value={bullet.text}
              onChange={event => updateResume({
                bullets: role!.bullets.map((item, itemIndex) => itemIndex === index ? {
                  ...item,
                  text: event.target.value
                } : item)
              })}
            />
            <div className="resume-edit-bullet-bottom">
              <select
                aria-label={`Employer for contribution ${index + 1}`}
                value={bullet.employerIndex ?? inferred}
                onChange={event => updateResume({
                  bullets: role!.bullets.map((item, itemIndex) => itemIndex === index ? {
                    ...item,
                    employerIndex: Number(event.target.value)
                  } : item)
                })}
              >
                <option value={-1}>Independent work</option>
                {profile.employers.map((employer, employerIndex) => <option value={employerIndex} key={employerIndex}>
                  {employer.company}
                </option>)}
              </select>
              <button
                type="button"
                className="text-button"
                onClick={() => updateResume({
                  bullets: role!.bullets.filter((_, itemIndex) => itemIndex !== index)
                })}
              >Remove</button>
            </div>
            {evidence && <details className="resume-original-evidence">
              <summary>Evidence</summary>
              <p>
                {evidence.claim}
              </p>
              <Sources sources={evidence.sources} />
            </details>}
          </div>;
          })}
        </div>
        <button
          type="button"
          className="text-button"
          onClick={() => navigate("profile")}
        >Edit employment</button>
      </fieldset>
    </section>}
    <div className={`resume-preview-column${resumeEditorOpen ? " is-editing" : ""}`}>
      <ResumeDocumentView document={resumeDocument} />
    </div>
    <details className="details-block resume-details no-print">
      <summary>Details</summary>
      <div className="resume-meta">
        {role.changes.length > 0 && <section>
          <h2>Tailoring</h2>
          <ul className="plain-list">
            {role.changes.map((change, index) => <li key={index}>
              {change}
            </li>)}
          </ul>
        </section>}
        {role.priorities.length > 0 && <section>
          <h2>Role priorities</h2>
          <ul className="plain-list">
            {role.priorities.map((priority, index) => <li key={index}>
              {priority}
            </li>)}
          </ul>
        </section>}
        {role.gaps.length > 0 && <section>
          <h2>Gaps</h2>
          <ul className="plain-list">
            {role.gaps.map((gap, index) => <li key={index}>
              {gap}
            </li>)}
          </ul>
        </section>}
        {Boolean(role.qualityNotes?.length) && <section>
          <h2>Draft checks</h2>
          <ul className="plain-list">
            {role.qualityNotes!.map((note, index) => <li key={index}>
              {note}
            </li>)}
          </ul>
        </section>}
        <section>
          <h2>Requirement coverage</h2>
          <ul className="matching-evidence">
            {selectedJob.assessment?.filter(item => item.importance === "core").map(requirement => <li key={requirement.id}>
              <p>
                {requirement.text}
              </p>
              <span className="quiet-label">
                {role!.bullets.some(bullet => bullet.requirementIds?.includes(requirement.id)) ? "Represented in resume" : "Not represented in resume"}
              </span>
            </li>)}
          </ul>
        </section>
        <section>
          <h2>Evidence</h2>
          {role.bullets.map((bullet, index) => {
            const evidence = profile.evidence.find(item => item.id === bullet.evidenceId);
            return evidence ? <div className="resume-original-evidence" key={index}>
            <p>
              {bullet.text}
            </p>
            <p className="small muted">Matches: {selectedJob.assessment?.filter(item => bullet.requirementIds?.includes(item.id)).map(item => item.text).join("; ") || "Needs review"}</p>
            <details>
              <summary>Original experience</summary>
              <p>
                {evidence.claim}
              </p>
              <Sources sources={evidence.sources} />
            </details>
          </div> : null;
          })}
        </section>
        <Sources sources={role.sources} label="Role sources" />
        {(role.researchReceipts ?? [role.receipt]).map((receipt, index) => <ResearchReceipt
          key={index}
          receipt={receipt}
          label={index ? "Draft review" : "Role research"}
        />)}
      </div>
    </details>
  </section>;
}
