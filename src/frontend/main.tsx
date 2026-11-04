"use client";

/**
 * Frontend entry point: coordinates screens, browser state, and calls to our API routes.
 * Follow research → findJobs → tailor to see the user journey.
 * Screen markup lives under features/; provider code never enters this browser module.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { researchRequest } from "./browser/research-stream";
import { clearLegacyWorkspace, identityConfirmationRequest, initialWorkspace, isIdentityResolution, type Screen, type Workspace } from "./browser/workspace";
import { buildResumeDocument, resumePlainText } from "@/shared/resume/document";
import { formatResumeContact, parseResumeContact, type ResumeContact } from "@/shared/resume/contact";
import { clarifyTargetRole } from "@/shared/jobs/role-intent";
import type { Activity, CandidateResearchResult, Employer, OpportunitiesResult, Opportunity, Preferences, Profile, RoleResult } from "@/shared/types";
import { ActivityFeed } from "./components/activity-feed";
import { StartScreen } from "./features/start/start-screen";
import { ProfileScreen } from "./features/candidate/profile-screen";
import { JobsScreen } from "./features/jobs/jobs-screen";
import { ResumeScreen } from "./features/resume/resume-screen";
function BrandMark() {
  return <span className="brand-mark" aria-hidden="true">
    <i />
    <i />
    <i />
  </span>;
}
export default function Main() {
  const [workspace, setWorkspace] = useState<Workspace>(initialWorkspace);
  const [screen, setScreen] = useState<Screen>("start");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [events, setEvents] = useState<Activity[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [clarification, setClarification] = useState("");
  const [excludedInput, setExcludedInput] = useState("");
  const [resumeEditorOpen, setResumeEditorOpen] = useState(false);
  const [copyComplete, setCopyComplete] = useState(false);
  const [editingEvidence, setEditingEvidence] = useState<string | null>(null);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const startTime = useRef(0);
  const heading = useRef<HTMLHeadingElement | null>(null);

  // 1. Keep this session in React memory. A page reload starts with an empty workspace.
  useEffect(() => {
    try {
      clearLegacyWorkspace(localStorage);
    } catch { /* Storage access is optional; the app never restores data from it. */ }
    fetch("/api/health").then(response => response.json()).then((data: {
      configured?: boolean;
    }) => setConfigured(Boolean(data.configured))).catch(() => setConfigured(null));
    return () => controller.current?.abort();
  }, []);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startTime.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  function navigate(next: Screen, identityResolved = false) {
    if (workspace.identityPending && next !== "start" && !identityResolved) return;
    setScreen(next);
    setError("");
    window.setTimeout(() => heading.current?.focus(), 30);
  }
  function addActivity(item: Activity) {
    setEvents(previous => [...previous.filter(existing => existing.id !== item.id), {
      ...item,
      at: item.at ?? Date.now()
    }]);
  }

  // 2. Run one backend workflow. Ignore late results from a canceled or replaced request.
  async function run<T>(label: string, path: string, payload: unknown, accept: (result: T) => void, onFailure?: () => void) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const id = ++requestId.current;
    setError("");
    setNotice("");
    setBusy(label);
    setEvents([]);
    setElapsed(0);
    startTime.current = Date.now();
    try {
      const result = await researchRequest<T>(path, payload, abort.signal, item => {
        if (id === requestId.current) addActivity(item);
      });
      if (id !== requestId.current) return;
      accept(result);
    } catch (failure) {
      if (id !== requestId.current) return;
      onFailure?.();
      if (abort.signal.aborted) setNotice("Research stopped. Your work is still available in this session."); else setError(failure instanceof Error ? failure.message : "Research could not finish. Please try again.");
    } finally {
      if (id === requestId.current) {
        setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
        setBusy(null);
        controller.current = null;
      }
    }
  }

  // 3. Deep resolves the identity first; only unresolved searches return a clarification card.
  function research(input: string, selectionToken?: string) {
    if (!input.trim()) return;
    if (input.length > 8000) {
      setError("Keep your starting details and additions under 8,000 characters. Shorten the text in Start, then research again.");
      return;
    }
    // Preserve the old profile while preventing it from being used for a different identity.
    setWorkspace(previous => ({
      ...previous, input, identityPending: true,
      identity: selectionToken ? previous.identity : previous.identity ? { ...previous.identity, query: input, candidates: [] } : null,
      opportunities: null, selectedJobId: null, role: null, resumeReviewed: false
    }));
    setScreen("start");
    void run<CandidateResearchResult>("candidate", "/api/research", {
      input,
      ...(selectionToken ? { selectionToken } : {})
    }, result => {
      if (isIdentityResolution(result)) {
        setWorkspace(previous => ({ ...previous, input: result.query, identity: result, identityPending: true }));
        setScreen("start");
        return;
      }
      // Also handle a clarification from an older server without opening a half-empty profile.
      if (result.clarification) {
        setWorkspace(previous => ({ ...previous, identityPending: true, identity: {
          kind: "identity", query: input, question: result.clarification, candidates: [],
          receipt: result.receipt, grounding: result.grounding
        } }));
        setScreen("start");
        return;
      }
      // A resolved identity has already continued through career research in the same server request.
      const profile = {
        ...result,
        evidence: result.evidence.map(item => ({
          ...item,
          // This flag means “include in my search,” not that the user verified the claim.
          confirmed: true
        }))
      };
      const excluded = [...new Set(result.employers.filter(employer => employer.status === "current").map(employer => employer.company).filter(Boolean))];
      setWorkspace(previous => ({
        ...previous,
        input,
        profile,
        identity: null,
        identityPending: false,
        preferences: {
          ...previous.preferences,
          excludedEmployers: previous.profile?.name.trim().toLowerCase() === profile.name.trim().toLowerCase() ? previous.preferences.excludedEmployers : excluded
        },
        opportunities: null,
        selectedJobId: null,
        role: null,
        resumeReviewed: false
      }));
      setClarification("");
      navigate("profile", true);
    }, () => {
      // Expired or rejected continuations return to editable input, never a stale-token loop.
      if (selectionToken) setWorkspace(previous => ({ ...previous, identity: null, identityPending: true }));
    });
  }
  function confirmIdentity(candidateId: string) {
    if (!workspace.identity || busy) return;
    const request = identityConfirmationRequest(workspace.identity, candidateId);
    if (request) research(request.input, request.selectionToken);
  }
  function editIdentity() {
    setWorkspace(previous => ({ ...previous, identity: null, identityPending: true }));
    setEvents([]);
    setError("");
  }

  // Changing selected evidence or profile details invalidates jobs and drafts made from them.
  function updateProfile(change: Partial<Profile>) {
    setWorkspace(previous => ({
      ...previous,
      profile: previous.profile ? {
        ...previous.profile,
        ...change
      } : null,
      opportunities: null,
      selectedJobId: null,
      role: null,
      resumeReviewed: false
    }));
  }
  function updatePreferences(change: Partial<Preferences>) {
    setWorkspace(previous => ({
      ...previous,
      preferences: {
        ...previous.preferences,
        ...change
      },
      opportunities: null,
      selectedJobId: null,
      role: null,
      resumeReviewed: false
    }));
  }
  function updateContact(change: Partial<ResumeContact>) {
    setCopyComplete(false);
    setWorkspace(previous => {
      const contactInfo = {
        ...(previous.contactInfo ?? parseResumeContact(previous.contact)),
        ...change
      };
      return {
        ...previous,
        contactInfo,
        contact: formatResumeContact(contactInfo),
        resumeReviewed: false
      };
    });
  }
  function updateEmployer(index: number, change: Partial<Employer>) {
    if (!workspace.profile) return;
    const original = workspace.profile.employers[index];
    if (!original || !(["company", "role", "period", "status"] as const).some(key => change[key] !== undefined && change[key] !== original[key])) return;
    const employers = workspace.profile.employers.map((employer, item) => item === index ? {
      ...employer,
      ...change,
      // A user edit is usable, but its old citations no longer verify the changed facts.
      sources: [],
      userProvided: true
    } : employer);
    const oldCompany = original.company;
    updateProfile({
      employers
    });
    if (change.company !== undefined && change.company !== oldCompany) {
      updatePreferences({
        excludedEmployers: [...new Set(workspace.preferences.excludedEmployers.map(company => company === oldCompany ? change.company! : company).filter(Boolean))]
      });
    }
  }
  function findJobs(event?: FormEvent) {
    event?.preventDefault();
    if (busy || workspace.identityPending || !workspace.profile || workspace.profile.clarification
      || !workspace.profile.evidence.some(item => item.confirmed && item.claim.trim())
      || !workspace.preferences.roles.trim() || !workspace.preferences.location.trim()
      || clarifyTargetRole(workspace.preferences.roles)) return;
    // Open the destination before waiting for Deep. Old matches and drafts belong to the previous search.
    setWorkspace(previous => ({
      ...previous, opportunities: null, selectedJobId: null, role: null, resumeReviewed: false
    }));
    navigate("jobs");
    void run<OpportunitiesResult>("opportunities", "/api/opportunities", {
      profile: { ...workspace.profile, evidence: workspace.profile.evidence.filter(item => item.confirmed && item.claim.trim()) },
      preferences: workspace.preferences,
      employmentIncluded: true
    }, result => {
      setWorkspace(previous => ({
        ...previous,
        opportunities: result,
        selectedJobId: result.jobs[0]?.id ?? null,
        role: null,
        resumeReviewed: false
      }));
    });
  }
  function tailor(job: Opportunity) {
    if (busy || workspace.identityPending || !workspace.profile || workspace.profile.clarification
      || !workspace.profile.evidence.some(item => item.confirmed && item.claim.trim())) return;
    void run<RoleResult>("role", "/api/tailor", {
      profile: { ...workspace.profile, evidence: workspace.profile.evidence.filter(item => item.confirmed && item.claim.trim()) },
      preferences: workspace.preferences,
      job,
      employmentIncluded: true
    }, result => {
      setWorkspace(previous => ({
        ...previous,
        selectedJobId: job.id,
        role: result,
        resumeReviewed: false
      }));
      setResumeEditorOpen(false);
      setCopyComplete(false);
      navigate("resume");
    });
  }
  function reset() {
    if (!window.confirm("Start a new search and clear this session?")) return;
    requestId.current++;
    controller.current?.abort();
    setBusy(null);
    setEvents([]);
    setWorkspace(initialWorkspace());
    setNotice("");
    navigate("start");
  }
  function updateResume(change: Partial<RoleResult>) {
    setCopyComplete(false);
    setWorkspace(previous => ({
      ...previous,
      role: previous.role ? {
        ...previous.role,
        ...change
      } : null,
      resumeReviewed: false
    }));
  }
  async function copyResume() {
    if (!resumeDocument || !canExport) return;
    try {
      await navigator.clipboard.writeText(resumePlainText(resumeDocument));
      setCopyComplete(true);
    } catch {
      setError("The browser could not copy the resume. Use Download text below, or select the document text directly.");
    }
  }
  function download(format: "text" | "json") {
    if (!resumeDocument || !canExport) return;
    const content = format === "text" ? resumePlainText(resumeDocument) : JSON.stringify(resumeDocument, null, 2);
    const url = URL.createObjectURL(new Blob([content], {
      type: format === "text" ? "text/plain;charset=utf-8" : "application/json"
    }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${workspace.profile?.name || "resume"}-resume.${format === "text" ? "txt" : "json"}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // 4. Derive the current view, then pass data and actions to its screen component.
  const profile = workspace.profile;
  const selectedJob = workspace.opportunities?.jobs.find(job => job.id === workspace.selectedJobId)
    ?? workspace.opportunities?.jobs[0]
    ?? null;
  const resumeDocument = profile && workspace.role ? buildResumeDocument(profile, workspace.role, workspace.contact) : null;
  const canExport = Boolean(resumeDocument && !resumeDocument.issues.length && workspace.resumeReviewed && !busy && !workspace.identityPending);
  const screens: {
    id: Screen;
    title: string;
    enabled: boolean;
  }[] = [{
    id: "start",
    title: "Start",
    enabled: true
  }, {
    id: "profile",
    title: "Profile",
    enabled: Boolean(profile) && !workspace.identityPending
  }, {
    id: "jobs",
    title: "Roles",
    enabled: (screen === "jobs" || Boolean(workspace.opportunities)) && !workspace.identityPending
  }, {
    id: "resume",
    title: "Resume",
    enabled: Boolean(workspace.role) && !workspace.identityPending
  }];
  return <div className="app-shell">
    <header className="site-header no-print">
      <button
        className="brand"
        onClick={() => navigate(profile && !workspace.identityPending ? "profile" : "start")}
        disabled={Boolean(busy)}
        aria-label="Next Move home"
      >
        <BrandMark />
        <span>next move</span>
      </button>
      <div className="header-right">
        <span className="powered">Exa Deep</span>
        {(profile || workspace.identityPending)
          && <button
            className="text-button"
            onClick={reset}
            disabled={Boolean(busy)}
          >New search</button>}
      </div>
    </header>
    <main>
      {screen !== "start"
        && <nav className="step-nav no-print" aria-label="Progress">
          {screens.map(step => <button
            key={step.id}
            className={screen === step.id ? "active" : ""}
            aria-current={screen === step.id ? "step" : undefined}
            disabled={!step.enabled || Boolean(busy)}
            onClick={() => navigate(step.id)}
          >
            {step.title}
          </button>)}
        </nav>}
      {configured === false
        && <div className="setup-notice no-print">Add <code>EXA_API_KEY</code> to <code>.env.local</code> and restart.</div>}
      {notice && <div className="notice no-print" role="status">
        {notice}
      </div>}
      {error
        && <div className="error no-print" role="alert">
          <p>
            {error}
          </p>
          <button className="text-button" onClick={() => setError("")}>Dismiss</button>
        </div>}
      {screen === "start"
        && <StartScreen
          input={workspace.input}
          busy={busy}
          configured={configured}
          heading={heading}
          events={events}
          elapsed={elapsed}
          identity={workspace.identity ?? null}
          onInputChange={input => setWorkspace(previous => ({
            ...previous,
            input,
            identity: null,
            identityPending: previous.identityPending || Boolean(previous.profile)
          }))}
          onResearch={research}
          onConfirm={confirmIdentity}
          onEditIdentity={editIdentity}
          onCancel={() => controller.current?.abort()}
        />}
      {screen !== "start" && screen !== "jobs"
        && <div className="no-print">
          <ActivityFeed
            events={events}
            busy={busy}
            elapsed={elapsed}
            onCancel={() => controller.current?.abort()}
          />
        </div>}
      {screen === "profile" && profile
        && <ProfileScreen
          workspace={workspace}
          profile={profile}
          busy={busy}
          configured={configured}
          heading={heading}
          form={{
            clarification,
            excludedInput,
            editingEvidence
          }}
          actions={{
            research,
            updateProfile,
            updatePreferences,
            updateEmployer,
            findJobs,
            setClarification,
            setExcludedInput,
            setEditingEvidence
          }}
        />}
      {screen === "jobs" && profile
        && <JobsScreen
          workspace={workspace}
          opportunities={workspace.opportunities}
          profile={profile}
          selectedJob={selectedJob}
          busy={busy}
          heading={heading}
          activity={<ActivityFeed
            events={events}
            busy={busy}
            elapsed={elapsed}
            onCancel={() => controller.current?.abort()}
          />}
          actions={{
            navigate,
            findJobs,
            tailor,
            selectJob: job => setWorkspace(previous => previous.selectedJobId === job.id ? previous : {
              ...previous,
              selectedJobId: job.id,
              role: null,
              resumeReviewed: false
            })
          }}
        />}
      {screen === "resume" && profile && workspace.role && selectedJob && resumeDocument
        && <ResumeScreen
          workspace={workspace}
          profile={profile}
          role={workspace.role}
          selectedJob={selectedJob}
          resumeDocument={resumeDocument}
          busy={busy}
          heading={heading}
          resumeEditorOpen={resumeEditorOpen}
          copyComplete={copyComplete}
          canExport={canExport}
          actions={{
            navigate,
            setResumeEditorOpen,
            copyResume,
            download,
            tailor,
            updateContact,
            updateResume,
            setResumeReviewed: resumeReviewed => setWorkspace(previous => ({
              ...previous,
              resumeReviewed
            }))
          }}
        />}
    </main>
  </div>;
}
