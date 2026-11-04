/** Deep may resolve a person directly; unresolved identities stay in the starting card. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, isValidElement, type ComponentType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { appendIdentityAnswer, identityConfirmationRequest, initialWorkspace, isIdentityResolution, type Workspace } from "../../src/frontend/browser/workspace.ts";
import type { Activity, CandidateResearchResult, Employer, IdentityResolution, OpportunitiesResult, Opportunity, Preferences, Profile, RoleResult } from "../../src/shared/types.ts";

const require = createRequire(import.meta.url);
const STORAGE_KEY = "next-move.workspace.v1";
const sourceRoot = fileURLToPath(new URL("../../src", import.meta.url));
const modules = new Map<string, Record<string, unknown>>();

// Load the actual TSX components, so markup assertions exercise the UI rather than a copied template.
function loadSource(path: string): Record<string, unknown> {
  const absolute = resolve(sourceRoot, path);
  if (modules.has(absolute)) return modules.get(absolute)!;
  const compiled = ts.transpileModule(readFileSync(absolute, "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const loaded = { exports: {} as Record<string, unknown> };
  modules.set(absolute, loaded.exports);
  new Function("require", "module", "exports", compiled)((id: string) => {
    if (!id.startsWith("@/") && !id.startsWith(".")) return require(id);
    const candidate = id.startsWith("@/") ? resolve(sourceRoot, id.slice(2)) : resolve(dirname(absolute), id);
    const file = [candidate, `${candidate}.ts`, `${candidate}.tsx`].find(existsSync);
    if (!file) throw new Error(`Cannot load ${id}`);
    return loadSource(file);
  }, loaded, loaded.exports);
  return loaded.exports;
}

const receipt = { stage: "candidate" as const, type: "deep" as const, requestId: "identity-req", elapsedMs: 1000, sourceCount: 1, retrievedAt: "2026-11-03" };
const identity: IdentityResolution = {
  kind: "identity", query: "Aditi Rao, engineer", question: "Which profile is yours?", receipt, grounding: [],
  candidates: [{ id: "person-1", name: "Aditi Rao", headline: "Software engineer", employer: "Example Tools", profileUrl: "https://example.com/aditi", sources: [{ url: "https://example.com/aditi", title: "Aditi Rao" }], confirmationToken: "signed-choice" }]
};
const profile: Profile = { name: "Earlier Candidate", summary: "Engineer", clarification: "", employers: [], evidence: [], receipt, grounding: [] };
type StartProps = {
  input: string; identity: IdentityResolution | null; busy: string | null; configured: boolean; heading: { current: null };
  events: Activity[]; elapsed: number; onInputChange: () => void; onResearch: () => void; onCancel: () => void; onConfirm: () => void; onEditIdentity: () => void;
};
const StartScreen = loadSource("frontend/features/start/start-screen.tsx").StartScreen as ComponentType<StartProps>;
function renderStart(resolution: IdentityResolution | null, events: Activity[] = [], busy: string | null = null) {
  let confirmations = 0;
  let searches = 0;
  const html = renderToStaticMarkup(createElement(StartScreen, {
    input: resolution?.query ?? "Aditi", identity: resolution, busy, configured: true, heading: { current: null }, events, elapsed: 1,
    onInputChange() {}, onResearch() { searches++; }, onCancel() {}, onConfirm() { confirmations++; }, onEditIdentity() {}
  }));
  return { html, confirmations, searches };
}

test("a single unresolved match offers an explicit choice without the browser selecting it", () => {
  const { html, confirmations, searches } = renderStart(identity);
  assert.equal(confirmations, 0);
  assert.equal(searches, 0);
  assert.equal((html.match(/>This is me<\/button>/g) || []).length, 1);
  assert.match(html, /Aditi Rao/);
  assert.match(html, /Software engineer/);
  assert.match(html, /Example Tools/);
  assert.match(html, /href="https:\/\/example.com\/aditi"/);
  assert.match(html, /None of these · Add a detail/);
  assert.match(html, /Edit details/);
  assert.doesNotMatch(html, /signed-choice|Professional experience|profile-grid/);
});

test("multiple identities stay separate and each has its own confirmation", () => {
  const second = { ...identity.candidates[0], id: "person-2", employer: "Other Company", profileUrl: "https://other.example/aditi", confirmationToken: "other-choice" };
  const { html } = renderStart({ ...identity, candidates: [...identity.candidates, second] });
  assert.equal((html.match(/>This is me<\/button>/g) || []).length, 2);
  assert.match(html, /Other Company/);
  assert.deepEqual(identityConfirmationRequest({ ...identity, candidates: [...identity.candidates, second] }, "person-2"), {
    input: identity.query, selectionToken: "other-choice"
  });
  assert.equal(identityConfirmationRequest(identity, "unknown"), null);
});

test("a question without provider activity replaces the original form without inventing research", () => {
  const clarification: IdentityResolution = { kind: "identity", query: "Aditi", question: "What is your full name or profile link?", candidates: [] };
  const events: Activity[] = [{ id: "validation", label: "Findings checked", state: "complete", origin: "app" }];
  const { html } = renderStart(clarification, events);
  assert.match(html, /class="start-form identity-step"/);
  assert.match(html, /id="identity-answer"/);
  assert.match(html, /What is your full name or profile link\?/);
  assert.doesNotMatch(html, /id="candidate-input"|Research complete|activity-region|This is me/);
  assert.match(renderStart(clarification, events, "candidate").html, /activity-region/);
});

test("real identity research activity stays below the choices and has an accurate completion label", () => {
  const events: Activity[] = [
    { id: "provider", label: "Sources received", state: "complete", origin: "exa", eventType: "done" },
    { id: "validation", label: "Identity choices checked", state: "complete", origin: "app" }
  ];
  const { html } = renderStart(identity, events);
  assert.ok(html.indexOf("This is me") < html.indexOf("activity-region"));
  assert.match(html, /Identity check complete/);
  assert.doesNotMatch(html, /Research complete/);
});

test("repeating a vague detail does not add an answer or create a confirmation", () => {
  assert.equal(appendIdentityAnswer("Aditi", " aditi "), null);
  assert.equal(appendIdentityAnswer("Aditi Rao\nSoftware engineer", "software ENGINEER"), null);
  assert.equal(appendIdentityAnswer("Aditi Rao", "Rao"), null);
  assert.equal(appendIdentityAnswer("Aditi", "Rao, Example Tools"), "Aditi\nRao, Example Tools");
  assert.equal(appendIdentityAnswer("Aditi", "https://example.com/aditi"), "Aditi\nhttps://example.com/aditi");
  assert.equal(identityConfirmationRequest({ ...identity, candidates: [] }, "person-1"), null);
});

test("invalid candidate URLs or token shapes cannot become an identity choice", () => {
  assert.equal(isIdentityResolution(identity), true);
  assert.equal(isIdentityResolution({ ...identity, candidates: [{ ...identity.candidates[0], profileUrl: "javascript:alert(1)" }] }), false);
  assert.equal(isIdentityResolution({ ...identity, candidates: [{ ...identity.candidates[0], confirmationToken: 123 }] }), false);
});

type ViewElement = ReactElement<Record<string, unknown>>;
type PendingRequest = {
  path: string;
  payload: Record<string, unknown>;
  resolve: (result: CandidateResearchResult | OpportunitiesResult | RoleResult) => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
  emitActivity: (activity: Activity) => void;
};
type StartActions = {
  identity: IdentityResolution | null;
  input: string;
  busy: string | null;
  onResearch: (input: string) => void;
  onConfirm: (candidateId: string) => void;
  onEditIdentity: () => void;
};

/**
 * Exercise the real Main event handlers with deferred server responses.
 * Only React's state/effect scheduling and the HTTP boundary are replaced here;
 * no browser, Exa request, or copied workflow implementation is involved.
 */
function mainHarness(runEffects = false) {
  let cursor = 0;
  let effectCursor = 0;
  const slots: unknown[] = [];
  const requests: PendingRequest[] = [];
  const effects: { dependencies?: unknown[]; callback?: () => void | (() => void); cleanup?: () => void }[] = [];
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value: unknown) => {
        slots[index] = typeof value === "function" ? value(slots[index]) : value;
      }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(callback: () => void | (() => void), dependencies?: unknown[]) {
      const index = effectCursor++;
      const previous = effects[index];
      if (!previous || !dependencies || dependencies.some((value, item) => !Object.is(value, previous.dependencies?.[item]))) {
        effects[index] = { ...previous, dependencies, callback };
      }
    }
  };
  const compiled = ts.transpileModule(readFileSync(resolve(sourceRoot, "frontend/main.tsx"), "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const loaded = { exports: {} as { default: () => ViewElement } };
  new Function("require", "module", "exports", compiled)((id: string) => {
    if (id === "react") return react;
    if (id === "./browser/research-stream") return {
      researchRequest: (path: string, payload: PendingRequest["payload"], signal: AbortSignal, emitActivity: (activity: Activity) => void) => new Promise<CandidateResearchResult | OpportunitiesResult | RoleResult>((resolve, reject) => {
        requests.push({ path, payload, resolve, reject, signal, emitActivity });
      })
    };
    if (!id.startsWith("@/") && !id.startsWith(".")) return require(id);
    const base = id.startsWith("@/") ? resolve(sourceRoot, id.slice(2)) : resolve(sourceRoot, "frontend", id);
    const file = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
    if (!file) throw new Error(`Cannot load ${id}`);
    return loadSource(file);
  }, loaded, loaded.exports);
  return {
    requests,
    workspace: () => slots[0] as Workspace,
    render() {
      cursor = 0;
      effectCursor = 0;
      const tree = loaded.exports.default();
      if (runEffects) for (const effect of effects) {
        if (!effect.callback) continue;
        effect.cleanup?.();
        const callback = effect.callback;
        effect.callback = undefined;
        effect.cleanup = callback() || undefined;
      }
      return tree;
    },
    unmount() { effects.forEach(effect => effect.cleanup?.()); }
  };
}
function findView(tree: unknown, name: string): ViewElement | undefined {
  if (Array.isArray(tree)) return tree.map(child => findView(child, name)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(tree)) return undefined;
  if (typeof tree.type === "function" && tree.type.name === name) return tree;
  return findView(tree.props.children, name);
}
function startActions(tree: ViewElement): StartActions {
  const view = findView(tree, "StartScreen");
  assert.ok(view, "The identity interaction remains on Start");
  return view.props as StartActions;
}
function stubFocusTimer() {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout() { return 0; }, setInterval() { return 0; } } });
  return () => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  };
}
async function flushResponse() {
  await new Promise<void>(resolve => setImmediate(resolve));
}

test("Main opens a profile returned by Deep directly without an identity confirmation round trip", async context => {
  context.after(stubFocusTimer());
  const app = mainHarness();
  startActions(app.render()).onResearch("Aditi Rao, Example Tools");
  assert.deepEqual(app.requests[0].payload, { input: "Aditi Rao, Example Tools" });
  assert.equal(startActions(app.render()).busy, "candidate");
  app.requests[0].resolve({ ...profile, name: "Aditi Rao" });
  await flushResponse();
  const tree = app.render();
  assert.ok(findView(tree, "ProfileScreen"));
  assert.equal(findView(tree, "StartScreen"), undefined);
  assert.equal(app.requests.length, 1);
});

test("Main stays on an unresolved result, then a useful text reply can resolve directly to the profile", async context => {
  context.after(stubFocusTimer());
  const app = mainHarness();
  startActions(app.render()).onResearch("Aditi");
  app.requests[0].resolve({ ...identity, query: "Aditi" });
  await flushResponse();
  const checkpoint = startActions(app.render());
  assert.equal(checkpoint.identity?.query, "Aditi");
  assert.equal(app.requests.length, 1, "Rendering choices must not select a candidate");
  assert.equal(findView(app.render(), "ProfileScreen"), undefined);
  checkpoint.onResearch("Aditi\nRao, Example Tools");
  assert.deepEqual(app.requests[1].payload, { input: "Aditi\nRao, Example Tools" });
  app.requests[1].resolve({ ...profile, name: "Aditi Rao" });
  await flushResponse();
  const tree = app.render();
  assert.ok(findView(tree, "ProfileScreen"));
  assert.equal(findView(tree, "StartScreen"), undefined);
});

test("Main keeps asking while Deep remains uncertain, and explicit choice sends only that candidate's token", async context => {
  context.after(stubFocusTimer());
  const app = mainHarness();
  startActions(app.render()).onResearch("Aditi");
  app.requests[0].resolve({ ...identity, query: "Aditi", candidates: [] });
  await flushResponse();
  startActions(app.render()).onResearch("Aditi\nEngineer");
  const unresolved = { ...identity, query: "Aditi\nEngineer" };
  app.requests[1].resolve(unresolved);
  await flushResponse();
  assert.equal(findView(app.render(), "ProfileScreen"), undefined);
  startActions(app.render()).onConfirm("person-1");
  assert.deepEqual(app.requests[2].payload, { input: unresolved.query, selectionToken: "signed-choice" });
  app.requests[2].reject(new Error("Your profile selection expired. Search again."));
  await flushResponse();
  const retry = startActions(app.render());
  assert.equal(retry.identity, null);
  retry.onResearch(retry.input);
  assert.deepEqual(app.requests[3].payload, { input: unresolved.query });
});

test("refresh starts empty instead of restoring browser data, while the current session still works", async context => {
  context.after(stubFocusTimer());
  context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ configured: true }), {
    headers: { "Content-Type": "application/json" }
  }));
  const legacy = {
    ...initialWorkspace(), input: "Previous candidate", profile, identity, identityPending: true,
    preferences: { roles: "Product", location: "London", excludedEmployers: ["Previous employer"] },
    contact: "previous@example.com", contactInfo: { email: "previous@example.com", linkedin: "https://linkedin.com/in/previous", other: "London" },
    opportunities: { jobs: [{ id: "old-job" }] }, selectedJobId: "old-job", role: { summary: "Old resume" },
    resumeReviewed: true
  };
  const values = new Map([
    [STORAGE_KEY, JSON.stringify(legacy)],
    [`${STORAGE_KEY}.before-fit-review`, JSON.stringify(legacy)],
    ["unrelated-setting", "keep"]
  ]);
  let reads = 0;
  let writes = 0;
  const storage = {
    getItem(key: string) { reads++; return values.get(key) ?? null; },
    setItem(key: string, value: string) { writes++; values.set(key, value); },
    removeItem(key: string) { values.delete(key); }
  };
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  context.after(() => {
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });

  const app = mainHarness(true);
  assert.equal(startActions(app.render()).input, "");
  await flushResponse();
  assert.deepEqual(app.workspace(), initialWorkspace());
  assert.equal(values.has(STORAGE_KEY), false);
  assert.equal(values.has(`${STORAGE_KEY}.before-fit-review`), false);

  startActions(app.render()).onResearch(identity.query);
  app.requests[0].resolve(identity);
  await flushResponse();
  startActions(app.render()).onConfirm("person-1");
  app.requests[1].resolve({ ...profile, name: "Aditi Rao" });
  await flushResponse();
  const profileView = findView(app.render(), "ProfileScreen");
  assert.ok(profileView, "The current session can progress from identity to profile");
  const actions = profileView.props.actions as {
    updatePreferences: (preferences: Workspace["preferences"]) => void;
    research: (input: string) => void;
  };
  actions.updatePreferences({ roles: "Engineering", location: "Remote", excludedEmployers: ["Example Tools"] });
  app.render();
  assert.equal(app.workspace().preferences.roles, "Engineering");

  actions.research(identity.query);
  app.render();
  app.unmount();
  assert.equal(app.requests[2].signal.aborted, true, "Leaving the page aborts pending research");

  const refreshed = mainHarness(true);
  const start = startActions(refreshed.render());
  await flushResponse();
  assert.equal(start.input, "");
  assert.equal(start.identity, null);
  assert.equal(start.busy, null);
  assert.deepEqual(refreshed.workspace(), initialWorkspace(), "Profile, jobs, resume, preferences, contact, and identity all reset");
  assert.equal(refreshed.requests.length, 0);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  assert.equal(values.get("unrelated-setting"), "keep");
  refreshed.unmount();
});

type ProfileActions = {
  findJobs: () => void;
  updateProfile: (change: Partial<Profile>) => void;
  updatePreferences: (change: Partial<Preferences>) => void;
  updateEmployer: (index: number, change: Partial<Employer>) => void;
  research: (input: string) => void;
};
function profileActions(tree: ViewElement): ProfileActions {
  const view = findView(tree, "ProfileScreen");
  assert.ok(view);
  return view.props.actions as ProfileActions;
}
const sourcedProfile: Profile = {
  ...profile, name: "Aditi Rao",
  employers: [
    { company: "Example Tools", role: "Engineer", period: "2024–Present", status: "current", sources: identity.candidates[0].sources },
    { company: "Earlier Tools", role: "Engineer", period: "2020–2024", status: "earlier", sources: identity.candidates[0].sources }
  ],
  evidence: [
    { id: "e-1", claim: "Built SDK tooling at Example Tools.", confirmed: false, sources: identity.candidates[0].sources },
    { id: "e-2", claim: "Created API onboarding guides at Earlier Tools.", confirmed: false, sources: identity.candidates[0].sources }
  ]
};
const job: Opportunity = {
  id: "job-1", company: "Next Tools", title: "Developer Tools Engineer", location: "Remote", url: "https://example.com/jobs/1",
  whyMatch: "SDK work", evidenceIds: ["e-1", "e-2"], requirements: ["Build SDKs"], gaps: [], status: "open", sources: []
};
const jobs: OpportunitiesResult = { jobs: [job], receipt: { ...receipt, stage: "opportunities" }, grounding: [], excludedCount: 0, fitVersion: 1 };
const role: RoleResult = {
  summary: "Developer tools engineer.", priorities: [], gaps: [], changes: [], sources: [], grounding: [],
  receipt: { ...receipt, stage: "role" }, bullets: [{ evidenceId: "e-1", text: "Built SDK tooling at Example Tools.", employerIndex: 0 }]
};

test("Main starts with all research selected and can find roles immediately, while deselection invalidates generated work", async context => {
  context.after(stubFocusTimer());
  const app = mainHarness();
  startActions(app.render()).onResearch(identity.query);
  app.requests[0].resolve(sourcedProfile);
  await flushResponse();
  assert.ok(app.workspace().profile?.evidence.every(item => item.confirmed));
  assert.deepEqual(app.workspace().preferences, {
    roles: "Open to suitable roles", location: "Any location", excludedEmployers: ["Example Tools"]
  });
  profileActions(app.render()).findJobs();
  assert.equal(app.requests[1].path, "/api/opportunities");
  assert.equal(app.requests[1].payload.employmentIncluded, true);
  assert.equal("employmentReviewed" in app.requests[1].payload, false);
  assert.deepEqual((app.requests[1].payload.profile as Profile).evidence.map(item => item.id), ["e-1", "e-2"]);
  assert.deepEqual(app.requests[1].payload.preferences, app.workspace().preferences);
  (findView(app.render(), "JobsScreen")!.props.actions as { findJobs: () => void }).findJobs();
  assert.equal(app.requests.length, 2, "Busy searches cannot be submitted twice");
  app.requests[1].resolve(jobs);
  await flushResponse();
  const jobActions = findView(app.render(), "JobsScreen")!.props.actions as { tailor: (job: Opportunity) => void };
  jobActions.tailor(job);
  assert.equal(app.requests[2].payload.employmentIncluded, true);
  app.requests[2].resolve(role);
  await flushResponse();
  const resumeActions = findView(app.render(), "ResumeScreen")!.props.actions as { navigate: (screen: string) => void };
  resumeActions.navigate("profile");
  profileActions(app.render()).updateProfile({ evidence: app.workspace().profile!.evidence.map(item => ({ ...item, confirmed: item.id === "e-2" })) });
  assert.equal(app.workspace().opportunities, null);
  assert.equal(app.workspace().role, null);
  profileActions(app.render()).findJobs();
  assert.deepEqual((app.requests[3].payload.profile as Profile).evidence.map(item => item.id), ["e-2"]);
  app.requests[3].resolve(jobs);
  await flushResponse();
  (findView(app.render(), "JobsScreen")!.props.actions as { navigate: (screen: string) => void }).navigate("profile");
  profileActions(app.render()).updateProfile({ evidence: app.workspace().profile!.evidence.map(item => ({ ...item, confirmed: false })) });
  profileActions(app.render()).findJobs();
  assert.equal(app.requests.length, 4, "An empty selection cannot start job research");
});

test("same-person research preserves chosen preferences and exclusions, and employer edits lose stale citations", async context => {
  context.after(stubFocusTimer());
  const app = mainHarness();
  startActions(app.render()).onResearch(identity.query);
  app.requests[0].resolve(sourcedProfile);
  await flushResponse();
  profileActions(app.render()).updateEmployer(0, { role: "Engineering Lead", status: "earlier" });
  assert.equal(app.workspace().profile!.employers[0].role, "Engineering Lead");
  assert.equal(app.workspace().profile!.employers[0].status, "earlier");
  assert.equal(app.workspace().profile!.employers[0].userProvided, true);
  assert.deepEqual(app.workspace().profile!.employers[0].sources, []);
  const preferences = { roles: "Product management", location: "Remote", excludedEmployers: [] };
  profileActions(app.render()).updatePreferences(preferences);
  profileActions(app.render()).research(identity.query);
  app.requests[1].resolve({ ...sourcedProfile, name: "ADITI RAO" });
  await flushResponse();
  assert.deepEqual(app.workspace().preferences, preferences);
  assert.ok(app.workspace().profile!.evidence.every(item => item.confirmed));
  profileActions(app.render()).findJobs();
  assert.deepEqual(app.requests[2].payload.preferences, preferences);
});

test("Find roles immediately opens Roles and forwards real research events before the result arrives", async context => {
  context.after(stubFocusTimer());
  const app = mainHarness();
  startActions(app.render()).onResearch(identity.query);
  app.requests[0].resolve(sourcedProfile);
  await flushResponse();
  profileActions(app.render()).findJobs();
  const pending = findView(app.render(), "JobsScreen");
  assert.ok(pending, "Roles must render before the request resolves");
  assert.equal(findView(app.render(), "ProfileScreen"), undefined);
  assert.equal(pending.props.opportunities, null);
  assert.equal(pending.props.busy, "opportunities");

  const event: Activity = {
    id: "provider-results", origin: "exa", eventType: "results", scope: "opportunities", state: "complete",
    label: "Source pages received", detail: "Request exa-role-1 returned a source page.", at: Date.UTC(2026, 10, 3, 12, 30),
    sources: [{ url: "https://example.com/jobs/1", title: "Developer Tools Engineer" }]
  };
  app.requests[1].emitActivity(event);
  const live = findView(findView(app.render(), "JobsScreen")!.props.activity, "ActivityFeed");
  assert.ok(live, "The Roles pane receives the existing live activity component");
  assert.deepEqual(live.props.events, [event]);
  assert.equal(live.props.busy, "opportunities");
  app.requests[1].resolve(jobs);
  await flushResponse();
  const completed = findView(app.render(), "JobsScreen");
  assert.ok(completed);
  assert.equal(completed.props.busy, null);
  assert.deepEqual(completed.props.opportunities, jobs);

  (completed.props.actions as { findJobs: () => void }).findJobs();
  const refreshed = findView(app.render(), "JobsScreen");
  assert.equal(refreshed?.props.opportunities, null, "A new search cannot display the previous shortlist as its result");
  assert.equal(app.workspace().selectedJobId, null);
  assert.equal(app.workspace().role, null);
});

test("failed and canceled role research stays on a retryable Roles pane without claiming an empty result", async context => {
  context.after(stubFocusTimer());
  for (const outcome of ["failed", "canceled"]) {
    const app = mainHarness();
    startActions(app.render()).onResearch(identity.query);
    app.requests[0].resolve(sourcedProfile);
    await flushResponse();
    profileActions(app.render()).findJobs();
    if (outcome === "canceled") {
      const activity = findView(findView(app.render(), "JobsScreen")!.props.activity, "ActivityFeed");
      assert.ok(activity);
      (activity.props.onCancel as () => void)();
      assert.equal(app.requests[1].signal.aborted, true);
    }
    app.requests[1].reject(new Error(outcome === "failed" ? "Provider unavailable" : "Request canceled"));
    await flushResponse();
    const stopped = findView(app.render(), "JobsScreen");
    assert.ok(stopped);
    assert.equal(stopped.props.busy, null);
    assert.equal(stopped.props.opportunities, null);
    const html = renderToStaticMarkup(stopped);
    assert.match(html, />Try again<\/button>/);
    assert.match(html, />Preferences<\/button>/);
    assert.doesNotMatch(html, /No supported matches|The researched roles did not|class="empty-state"/);
    const actions = stopped.props.actions as { findJobs: () => void; navigate: (screen: string) => void };
    if (outcome === "canceled") {
      actions.navigate("profile");
      profileActions(app.render()).findJobs();
    } else actions.findJobs();
    assert.equal(app.requests.length, 3);
    assert.ok(findView(app.render(), "JobsScreen"));
    assert.equal(app.requests[2].path, "/api/opportunities");
  }
});

test("Roles renders pending, interrupted, and completed-empty states distinctly", () => {
  const JobsScreen = loadSource("frontend/features/jobs/jobs-screen.tsx").JobsScreen as ComponentType<Record<string, unknown>>;
  const common = {
    workspace: { ...initialWorkspace(), profile: sourcedProfile }, profile: sourcedProfile, selectedJob: null,
    heading: { current: null }, actions: { navigate() {}, findJobs() {}, selectJob() {}, tailor() {} }
  };
  const pending = renderToStaticMarkup(createElement(JobsScreen, {
    ...common, opportunities: null, busy: "opportunities", activity: createElement("p", { role: "status" }, "Real provider event")
  }));
  assert.match(pending, />Roles<\/h1>/);
  assert.match(pending, /Searching…/);
  assert.ok(pending.indexOf("Roles</h1>") < pending.indexOf("Real provider event"));
  assert.doesNotMatch(pending, /No supported matches|class="empty-state"/);
  const interrupted = renderToStaticMarkup(createElement(JobsScreen, { ...common, opportunities: null, busy: null }));
  assert.match(interrupted, />Try again<\/button>/);
  assert.doesNotMatch(interrupted, /disabled=""|No supported matches|class="empty-state"/);
  const empty = renderToStaticMarkup(createElement(JobsScreen, { ...common, opportunities: { ...jobs, jobs: [] }, busy: null }));
  assert.match(empty, /No supported matches yet/);
  assert.match(empty, />Refresh<\/button>/);
});
