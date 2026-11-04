/**
 * Choose which research workflow 02 should use; all contributions start selected.
 * This screen shows claims, employment, gaps, and job preferences.
 * Actions update the central workspace so dependent jobs and resumes can be invalidated.
 */
import type { FormEvent, RefObject } from "react";
import type { Employer, Preferences, Profile } from "@/shared/types";
import type { Workspace } from "@/frontend/browser/workspace";
import { clarifyTargetRole } from "@/shared/jobs/role-intent";
import { Arrow } from "@/frontend/components/arrow";
import { Sources } from "@/frontend/components/sources";
import { ResearchReceipt } from "@/frontend/components/research-receipt";
export type ProfileFormState = {
  clarification: string;
  excludedInput: string;
  editingEvidence: string | null;
};
type ProfileActions = {
  research: (input: string) => void;
  updateProfile: (change: Partial<Profile>) => void;
  updatePreferences: (change: Partial<Preferences>) => void;
  updateEmployer: (index: number, change: Partial<Employer>) => void;
  findJobs: (event?: FormEvent) => void;
  setClarification: (value: string) => void;
  setExcludedInput: (value: string) => void;
  setEditingEvidence: (id: string | null) => void;
};
type ProfileScreenProps = {
  workspace: Workspace;
  profile: Profile;
  busy: string | null;
  configured: boolean | null;
  heading: RefObject<HTMLHeadingElement | null>;
  form: ProfileFormState;
  actions: ProfileActions;
};
export function ProfileScreen({
  workspace,
  profile,
  busy,
  configured,
  heading,
  form,
  actions
}: ProfileScreenProps) {
  const {
    clarification,
    excludedInput,
    editingEvidence
  } = form;
  const {
    research,
    updateProfile,
    updatePreferences,
    updateEmployer,
    findJobs,
    setClarification,
    setExcludedInput,
    setEditingEvidence
  } = actions;
  const selectedCount = profile.evidence.filter(item => item.confirmed && item.claim.trim()).length;
  const roleClarification = clarifyTargetRole(workspace.preferences.roles);
  const canFind = Boolean(!workspace.identityPending && !profile.clarification && selectedCount && workspace.preferences.roles.trim() && workspace.preferences.location.trim() && !roleClarification);
  const currentEmployer = profile?.employers.find(item => item.status === "current");
  const uncertainEmployment = profile?.employers.filter(item => item.status === "uncertain").length ?? 0;
  const workGaps = profile?.workCoverage?.filter(item => item.status !== "covered").length ?? 0;
  const findHint = !selectedCount ? "Select experience to use." : !workspace.preferences.roles.trim() ? "Choose a role." : roleClarification ? "Choose a role type." : !workspace.preferences.location.trim() ? "Choose a location." : "";
  return <section className="profile-screen no-print">
    <div className="section-heading">
      <div className="profile-identity">
        <h1 ref={heading} tabIndex={-1}>
          {profile.clarification ? "One more detail" : profile.name || "Your profile"}
        </h1>
        {!profile.clarification && currentEmployer && <p>
          {[currentEmployer.role, currentEmployer.company].filter(Boolean).join(" · ")}
        </p>}
      </div>
      <button
        className="text-button"
        disabled={Boolean(busy) || !workspace.input.trim()}
        onClick={() => research(workspace.input)}
      >Refresh research</button>
    </div>
    {profile.clarification ? <form
      className="clarification-card"
      onSubmit={event => {
        event.preventDefault();
        research(`${workspace.input}\n\nAdditional information from the candidate: ${clarification}`);
      }}
    >
      <h2>
        {profile.clarification}
      </h2>
      <label className="sr-only" htmlFor="clarification">Additional details</label>
      <textarea
        id="clarification"
        value={clarification}
        onChange={event => setClarification(event.target.value)}
        placeholder="A profile link or another detail"
        rows={3}
        required
        disabled={Boolean(busy)}
      />
      <button className="primary-button" disabled={Boolean(busy) || !clarification.trim()}>Continue <Arrow /></button>
      <ResearchReceipt receipt={profile.receipt} />
    </form> : <div className="profile-grid">
      <div className="profile-main">
        <div className="subsection-heading">
          <h2>Experience</h2>
          <div className="section-actions">
            <span className="quiet-label">{selectedCount} selected</span>
            {profile.evidence.length > 0 && <button
              className="text-button"
              disabled={Boolean(busy)}
              onClick={() => updateProfile({
                evidence: profile.evidence.map(item => ({
                  ...item,
                  confirmed: selectedCount !== profile.evidence.filter(item => item.claim.trim()).length
                }))
              })}
            >
              {selectedCount === profile.evidence.filter(item => item.claim.trim()).length ? "Clear selection" : "Select all"}
            </button>}
          </div>
        </div>
        {workGaps > 0 && <p className="helper-text">Work details incomplete for {workGaps} {workGaps === 1 ? "role" : "roles"}.</p>}
        <div className="evidence-list">
          {profile.evidence.map((evidence, index) => <article className={`evidence-card ${evidence.confirmed ? "is-confirmed" : ""}`} key={evidence.id}>
            <input
              id={`evidence-${index}`}
              className="evidence-checkbox"
              type="checkbox"
              checked={evidence.confirmed}
              disabled={Boolean(busy)}
              aria-label={`Use contribution ${index + 1}`}
              onChange={event => updateProfile({
                evidence: profile.evidence.map(item => item.id === evidence.id ? {
                  ...item,
                  confirmed: event.target.checked
                } : item)
              })}
            />
            <div className="evidence-body">
              {editingEvidence === evidence.id ? <div className="evidence-edit">
                <textarea
                  aria-label={`Contribution ${index + 1}`}
                  value={evidence.claim}
                  rows={4}
                  maxLength={3000}
                  disabled={Boolean(busy)}
                  onChange={event => updateProfile({
                    evidence: profile.evidence.map(item => item.id === evidence.id ? {
                      ...item,
                      claim: event.target.value,
                      sources: [],
                      sourceExcerpts: [],
                      confidence: "user-provided"
                    } : item)
                  })}
                />
                <button className="text-button" onClick={() => setEditingEvidence(null)}>Done</button>
              </div> : <label className="evidence-text" htmlFor={`evidence-${index}`}>
                {evidence.claim}
              </label>}
              <div className="evidence-meta">
                <div>
                  {evidence.confidence === "user-provided" ? <span className="muted small">Edited</span> : <Sources sources={evidence.sources} />}
                </div>
                <button
                  className="text-button"
                  disabled={Boolean(busy)}
                  onClick={() => setEditingEvidence(editingEvidence === evidence.id ? null : evidence.id)}
                >
                  {editingEvidence === evidence.id ? "Close" : "Edit"}
                </button>
              </div>
            </div>
          </article>)}
        </div>
        {!profile.evidence.length && <div className="empty-state">
          <p>No work evidence yet. Add experience below.</p>
        </div>}
        <details className="details-block">
          <summary>Add experience</summary>
          <textarea
            aria-label="Additional experience"
            value={clarification}
            onChange={event => setClarification(event.target.value)}
            placeholder="Paste experience or add a link"
            rows={4}
            disabled={Boolean(busy)}
          />
          <button
            className="secondary-button"
            onClick={() => research(`${workspace.input}\n\nAdditional experience supplied by the candidate: ${clarification}`)}
            disabled={Boolean(busy) || !clarification.trim()}
          >Research again</button>
        </details>
        <details className="details-block">
          <summary>Employment <span className="quiet-label">
              {uncertainEmployment ? `${uncertainEmployment} to review` : workGaps ? `${workGaps} work gaps` : profile.employers.length}
            </span></summary>
          <div className="employment-list">
            {profile.employers.map((employer, index) => <div className="employer" key={index}>
              <input
                aria-label={`Employer ${index + 1}`}
                value={employer.company}
                onChange={event => updateEmployer(index, {
                  company: event.target.value
                })}
                disabled={Boolean(busy)}
              />
              <input
                aria-label={`Role at employer ${index + 1}`}
                value={employer.role}
                onChange={event => updateEmployer(index, {
                  role: event.target.value
                })}
                disabled={Boolean(busy)}
              />
              <input
                aria-label={`Dates at employer ${index + 1}`}
                value={employer.period}
                onChange={event => updateEmployer(index, {
                  period: event.target.value
                })}
                disabled={Boolean(busy)}
              />
              <select
                aria-label={`Employment status at ${employer.company}`}
                value={employer.status}
                onChange={event => updateEmployer(index, {
                  status: event.target.value as Employer["status"]
                })}
                disabled={Boolean(busy)}
              >
                <option value="current">Current / most recent</option>
                <option value="earlier">Earlier</option>
                <option value="uncertain">Needs review</option>
              </select>
              <Sources sources={employer.sources} />
              {profile.workCoverage?.find(item => item.employerIndex === index) && <div className="employment-coverage">
                <span className="quiet-label">{profile.workCoverage.find(item => item.employerIndex === index)!.evidenceCount} work details · {profile.workCoverage.find(item => item.employerIndex === index)!.status}</span>
                <p className="small muted">
                  {profile.workCoverage.find(item => item.employerIndex === index)!.note}
                </p>
              </div>}
            </div>)}
          </div>
        </details>
        <details className="details-block">
          <summary>Profile details</summary>
          <label className="field-label" htmlFor="profile-name">Name</label>
          <input
            id="profile-name"
            value={profile.name}
            onChange={event => updateProfile({
              name: event.target.value
            })}
            disabled={Boolean(busy)}
          />
          <label className="field-label" htmlFor="profile-summary">Summary</label>
          <textarea
            id="profile-summary"
            value={profile.summary}
            rows={4}
            onChange={event => updateProfile({
              summary: event.target.value
            })}
            disabled={Boolean(busy)}
          />
        </details>
        <details className="details-block">
          <summary>Research</summary>
          {profile.researchWarnings?.map((warning, index) => <p className="small muted" key={index}>
            {warning}
          </p>)}
          {(profile.researchReceipts?.length ? profile.researchReceipts : [profile.receipt]).map((receipt, index) => <ResearchReceipt
            key={receipt.requestId || index}
            receipt={receipt}
            label={`Request ${index + 1}`}
          />)}
        </details>
      </div>
      <aside className="profile-sidebar">
        <form onSubmit={findJobs}>
          <div className="sidebar-card">
            <h2>Find roles</h2>
            <label className="field-label" htmlFor="target-roles">Role</label>
            <input
              id="target-roles"
              value={workspace.preferences.roles}
              onChange={event => updatePreferences({
                roles: event.target.value
              })}
              placeholder="Product manager"
              required
              disabled={Boolean(busy)}
            />
            {roleClarification && <div className="role-clarification">
              <p className="helper-text">
                {roleClarification.question}
              </p>
              <div className="preference-shortcuts">
                {roleClarification.options.map(option => <button
                  key={option}
                  type="button"
                  className="secondary-button"
                  disabled={Boolean(busy)}
                  onClick={() => updatePreferences({
                    roles: option
                  })}
                >
                  {option}
                </button>)}
              </div>
            </div>}
            <button
              type="button"
              className="inline-option"
              onClick={() => updatePreferences({
                roles: "Open to suitable roles"
              })}
              disabled={Boolean(busy)}
            >Any role</button>
            <label className="field-label" htmlFor="target-location">Location</label>
            <input
              id="target-location"
              value={workspace.preferences.location}
              onChange={event => updatePreferences({
                location: event.target.value
              })}
              placeholder="Remote, US"
              required
              disabled={Boolean(busy)}
            />
            <button
              type="button"
              className="inline-option"
              onClick={() => updatePreferences({
                location: "Any location"
              })}
              disabled={Boolean(busy)}
            >Anywhere</button>
            <div className="exclusion-preview">
              <span className="field-label">Excluded companies</span>
              <div className="chips">
                {workspace.preferences.excludedEmployers.map(company => <span className="chip" key={company}>
                  {company}
                  <button
                    type="button"
                    aria-label={`Include ${company} in search`}
                    disabled={Boolean(busy)}
                    onClick={() => updatePreferences({
                      excludedEmployers: workspace.preferences.excludedEmployers.filter(item => item !== company)
                    })}
                  >×</button>
                </span>)}
                {!workspace.preferences.excludedEmployers.length && <span className="quiet-label">None</span>}
              </div>
            </div>
            <details className="details-block">
              <summary>Add exclusion</summary>
              <div className="add-exclusion">
                <input
                  aria-label="Company to exclude"
                  value={excludedInput}
                  onChange={event => setExcludedInput(event.target.value)}
                  placeholder="Company name"
                  disabled={Boolean(busy)}
                  onKeyDown={event => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (excludedInput.trim()) {
                        updatePreferences({
                          excludedEmployers: [...new Set([...workspace.preferences.excludedEmployers, excludedInput.trim()])]
                        });
                        setExcludedInput("");
                      }
                    }
                  }}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Add exclusion"
                  disabled={Boolean(busy) || !excludedInput.trim()}
                  onClick={() => {
                    updatePreferences({
                      excludedEmployers: [...new Set([...workspace.preferences.excludedEmployers, excludedInput.trim()])]
                    });
                    setExcludedInput("");
                  }}
                >+</button>
              </div>
            </details>
            <div className="profile-action">
              <button className="primary-button full-width" disabled={Boolean(busy) || !canFind || configured === false}>{busy === "opportunities" ? "Searching…" : "Find roles"} {!busy && <Arrow />}</button>
              {findHint && <p className="helper-text">
                {findHint}
              </p>}
            </div>
          </div>
        </form>
      </aside>
    </div>}
  </section>;
}
