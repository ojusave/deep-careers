import test from "node:test";
import assert from "node:assert/strict";
import { buildDeepRequest, runDeep } from "../../../src/backend/providers/exa/deep.ts";
import { consumeExaStream } from "../../../src/backend/providers/exa/stream.ts";
import { researchResponse } from "../../../src/backend/http/response.ts";
import { candidateSchema } from "../../../src/backend/features/candidate/schemas.ts";
import { opportunitiesSchema } from "../../../src/backend/features/jobs/schemas.ts";
import { roleSchema } from "../../../src/backend/features/resume/schemas.ts";
import { researchCandidate } from "../../../src/backend/workflows/01-research-person.ts";
import { createIdentityConfirmationToken, type ConfirmedIdentity } from "../../../src/backend/features/candidate/resolve-identity.ts";
import { researchOpportunities } from "../../../src/backend/workflows/02-find-relevant-jobs.ts";
import { prepareResumeInput } from "../../../src/backend/features/resume/draft.ts";
import { tailorResume } from "../../../src/backend/workflows/03-create-resume.ts";
import { AppError } from "../../../src/backend/errors.ts";
import { candidateContext, citationsFor, grounding, hasUnsupportedNumbers, isExcluded, normalizeEmployer, safeUrl } from "../../../src/shared/validation.ts";
import { validatePreferences, validateProfile } from "../../../src/backend/validation.ts";
import { matchesSearchRequest, searchRequestContext } from "../../../src/shared/jobs/request-context.ts";
import type { Activity, Grounding, Opportunity, Profile, RequirementAssessment } from "../../../src/shared/types.ts";

const profile: Profile = {
  name: "Example Candidate", summary: "UNSELECTED summary", clarification: "",
  employers: [{ company: "Zoom Video Communications, Inc.", role: "Developer Advocate", period: "", status: "current", sources: [] },
    { company: "Example Previous", role: "Engineer", period: "", status: "earlier", sources: [] }],
  evidence: [{ id: "e-1", claim: "Created 3 SDK examples for a developer workshop.", confirmed: true, sources: [] },
    { id: "e-2", claim: "UNSELECTED built a spacecraft", confirmed: false, sources: [] }],
  receipt: { stage: "candidate", type: "deep", requestId: "test", elapsedMs: 1, sourceCount: 0, retrievedAt: "2026-01-01" }, grounding: [],
};
const preferences = { roles: "Developer relations", location: "Remote", excludedEmployers: ["Meta", "Zoom", "Example Previous"] };
const postingUrl = "https://careers.example.com/jobs/123";
const assessment: RequirementAssessment[] = [
  { id: "j1-r1", text: "Create SDK examples", importance: "core", support: "direct", evidenceIds: ["e-1"], reason: "Selected SDK examples.", sources: [{ url: postingUrl, title: "Role" }] },
  { id: "j1-r2", text: "Develop hands-on workshop materials", importance: "core", support: "direct", evidenceIds: ["e-1"], reason: "Selected developer workshop material.", sources: [{ url: postingUrl, title: "Role" }] },
];
const job: Opportunity = { id: "j1", company: "Example New", title: "Developer Advocate", location: "Remote", url: postingUrl, whyMatch: "Relevant workshop experience", requirements: assessment.map(item => item.text), gaps: [], evidenceIds: ["e-1"], status: "open", sources: [], assessment, fitVersion: 2, requestContext: preferences };
const requirementIds = assessment.map(item => item.id);

// Career research starts only after this controlled identity has been selected.
// Keep its profile citation distinct from the source supporting a work claim.
const selectedIdentity: ConfirmedIdentity = {
  id: "alex-example", name: "Alex Example", headline: "Finance professional", employer: "",
  profileUrl: "https://example.com/alex", sources: [{ title: "Profile", url: "https://example.com/alex" }],
};
async function researchConfirmedCandidate(input: string, options: Parameters<typeof researchCandidate>[1] = {}): Promise<Profile> {
  const result = await researchCandidate({ input, selectionToken: createIdentityConfirmationToken(input, selectedIdentity) }, options);
  assert.ok(!("kind" in result), "The chosen identity must be verified before career research completes");
  return result;
}

function properties(schema: unknown): number {
  if (schema === null || typeof schema !== "object") return 0;
  return Object.entries(schema).reduce((n, [key, value]) => n + (key === "properties" && typeof value === "object" && value ? Object.keys(value).length : 0) + properties(value), 0);
}

function sse(events: unknown[]): ReadableStream<Uint8Array> {
  const data = events.map(event => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\r\n\r\n`).join("");
  const bytes = new TextEncoder().encode(data);
  return new ReadableStream({ start(controller) {
    // Deliberately split in the middle of event headers and UTF-8 payloads.
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    controller.close();
  } });
}

type MockOutput = { content: unknown; grounding: Grounding[] };
type MockStages = { qualify?: (request: Record<string, unknown>) => MockOutput; review?: (request: Record<string, unknown>) => MockOutput };

function queryData<T>(request: Record<string, unknown>, marker: string): T {
  const line = String(request.query).split("\n").find(line => line.startsWith(`${marker}: `));
  assert.ok(line, `Missing ${marker} fixture data`);
  return JSON.parse(line.slice(marker.length + 2)) as T;
}

function qualificationFixture(request: Record<string, unknown>, criteria = assessment.map(({ text, importance, evidenceIds, support, reason }) => ({ requirement: text, importance, evidenceIds, support, reason }))): MockOutput {
  const jobs = queryData<Array<{ jobId: string; url: string }>>(request, "JOBS");
  const rows = jobs.flatMap(job => criteria.map(criterion => ({ jobId: job.jobId, postingUrl: job.url, postingStatus: "open", requestMatch: "match", ...criterion })));
  return { content: { criteria: rows },
    grounding: rows.flatMap((row, i) => [
      { field: `criteria[${i}].postingStatus`, citations: [{ url: row.postingUrl, title: "Primary posting" }] },
      { field: `criteria[${i}].requirement`, citations: [{ url: row.postingUrl, title: "Primary posting" }] },
    ]) };
}

function supportedReviewFixture(request: Record<string, unknown>): MockOutput {
  const data = queryData<{ targets: string[] }>(request, "REVIEW DATA");
  return { content: { checks: data.targets.map(target => ({ target, supported: true, relevant: true, employerSupported: true, reason: "The controlled fixture directly supports this claim and requirement." })) }, grounding: [] };
}

// Positive stage fixtures isolate the older structural tests. Dedicated tests
// below supply negative semantic verdicts and verify the integration honors them.
async function mockDeep(content: unknown, work: (requests: Record<string, unknown>[]) => Promise<void>, extras: Record<string, unknown> = {}, stages: MockStages = {}) {
  const original = globalThis.fetch;
  const oldKey = process.env.EXA_API_KEY;
  const requests: Record<string, unknown>[] = [];
  const shared = globalThis as typeof globalThis & { __deepCareersLimits?: { active: number; calls: number[] } };
  const oldLimits = shared.__deepCareersLimits;
  shared.__deepCareersLimits = { active: 0, calls: [] };
  process.env.EXA_API_KEY = "local-test-placeholder";
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.exa.ai/search");
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(request);
    const schema = request.outputSchema as { properties: Record<string, unknown> };
    if (schema.properties.criteria || schema.properties.checks) {
      const output = schema.properties.criteria ? (stages.qualify ?? qualificationFixture)(request) : (stages.review ?? supportedReviewFixture)(request);
      return Response.json({ requestId: schema.properties.criteria ? "qualification-request" : "review-request", costDollars: { total: 0.012 }, results: [], output });
    }
    return Response.json({ requestId: "actual-provider-request", costDollars: { total: 0.012 }, results: [], output: { content, grounding: [] }, ...extras });
  };
  try { await work(requests); }
  finally { globalThis.fetch = original; shared.__deepCareersLimits = oldLimits; if (oldKey === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = oldKey; }
}

test("all schemas stay inside Deep's ten-property budget and calls explicitly select Deep", () => {
  for (const schema of [candidateSchema, opportunitiesSchema, roleSchema]) assert.ok(properties(schema) <= 10);
  assert.deepEqual([candidateSchema, opportunitiesSchema, roleSchema].map(properties), [10, 10, 10]);
  const request = buildDeepRequest({ stage: "candidate", query: "test", systemPrompt: "test", outputSchema: candidateSchema }, true);
  assert.equal(request.type, "deep");
  assert.equal(request.stream, true);
  const seeded = buildDeepRequest({ stage: "candidate", query: "Candidate identity", systemPrompt: "Inspect work", outputSchema: candidateSchema,
    additionalQueries: ["Candidate company A projects", "Candidate company A projects", "", "Candidate company B publications"] });
  assert.deepEqual(seeded.additionalQueries, ["Candidate company A projects", "Candidate company B publications"]);
});

test("employer exclusions handle legal aliases without unsafe substring matching", () => {
  assert.equal(normalizeEmployer("Zoom Video Communications, Inc."), "zoom");
  assert.equal(isExcluded("Zoom Communications Inc.", ["Zoom"]), true);
  assert.equal(isExcluded("Meta Platforms", ["Facebook"]), true);
  assert.equal(isExcluded("Metabase", ["Meta"]), false);
  assert.equal(isExcluded("Citadel Securities", ["Citadel"]), false);
  const prefs = validatePreferences(preferences, profile);
  assert.equal(isExcluded("Zoom", prefs.excludedEmployers), true);
  assert.equal(isExcluded("Example Previous", prefs.excludedEmployers), true);
  assert.deepEqual(validatePreferences({ ...preferences, excludedEmployers: [] }, profile).excludedEmployers, []);
  assert.equal(isExcluded("Zoom", validatePreferences({ ...preferences, excludedEmployers: ["Meta"] }, profile).excludedEmployers), false);
});

test("ambiguous identity and no selected evidence block downstream research", () => {
  assert.throws(() => validateProfile({ ...profile, clarification: "Which person?" }), (error: unknown) => error instanceof AppError && error.code === "CLARIFICATION_REQUIRED");
  assert.throws(() => validateProfile({ ...profile, evidence: [] }), (error: unknown) => error instanceof AppError && error.code === "EVIDENCE_REQUIRED");
  const context = JSON.stringify(candidateContext(profile));
  assert.match(context, /Created 3 SDK/);
  assert.doesNotMatch(context, /UNSELECTED/);
  assert.doesNotMatch(context, /Zoom/); // Employment is supplied separately from selected work evidence.
});

test("grounding retains exact field citations even without result pages", () => {
  const fields = grounding([
    { field: "evidence[0].claim", citations: [{ url: "https://example.com/first", title: "First" }], confidence: "high" },
    { field: "/evidence/1/claim", citations: [{ url: "https://example.com/second", title: "Second" }] },
    { field: "evidence.2.claim", citations: [{ url: "javascript:alert(1)", title: "Unsafe" }] },
  ]);
  assert.equal(citationsFor(fields, "evidence[0]")[0]?.url, "https://example.com/first");
  assert.equal(citationsFor(fields, "evidence[1]")[0]?.url, "https://example.com/second");
  assert.deepEqual(citationsFor(fields, "evidence[2]"), []);
  assert.equal(safeUrl("http://127.0.0.1/"), null);
  assert.equal(safeUrl("https://example.com/role"), "https://example.com/role");
});

test("SSE authoritative done replaces partial/reset data and retains final-only sources", async () => {
  const activities: Activity[] = [];
  const final = await consumeExaStream(sse([
    { type: "text-delta", delta: "wrong partial" },
    { type: "grounding", grounding: [{ field: "name", citations: [{ url: "https://wrong.example.com", title: "Old" }] }] },
    { type: "stream-reset", streamReset: true },
    { type: "text-delta", delta: "replacement" },
    { type: "done", requestId: "final", results: [{ url: "https://final.example.com", title: "Final" }], output: { content: { name: "Final" }, grounding: [] } },
    "[DONE]",
  ]), activity => activities.push(activity));
  assert.deepEqual(final.output, { content: { name: "Final" }, grounding: [] });
  assert.equal((final.results as { url: string }[])[0].url, "https://final.example.com");
  assert.ok(activities.some(a => a.id === "grounding" && a.state === "running" && a.sources?.length === 0));
  assert.equal(activities.filter(a => a.id === "synthesis" && a.label === "Receiving structured findings").length, 2);
});

test("truncated SSE cannot become a successful response", async () => {
  await assert.rejects(consumeExaStream(sse([{ type: "text-delta", delta: "partial" }, "[DONE]"])), (error: unknown) => error instanceof AppError && error.code === "INCOMPLETE_DEEP_RESPONSE");
});

test("candidate research is generic and preserves citations without treating findings as user verification", async () => {
  await mockDeep({}, async requests => {
    const activities: Activity[] = [];
    const result = await researchConfirmedCandidate("Alex Example, finance", { emit: activity => activities.push(activity) });
    assert.equal(result.evidence[0].confirmed, false);
    assert.equal(result.evidence[0].sources[0].url, "https://example.com/talk");
    assert.equal(result.receipt.sourceCount, 2); // Identity anchor plus the independent work source.
    assert.equal(result.receipt.requestId, "actual-provider-request");
    assert.equal(result.receipt.costDollars, 0.012);
    assert.ok(activities.findLast(item => item.id === "grounding")?.sources?.some(source => source.url === "https://example.com/talk"));
    assert.equal(requests[0].type, "deep");
  }, { output: { content: { name: "Alex Example", summary: "Professional", clarification: "", employers: [], evidence: [{ claim: "Presented a professional workshop." }] }, grounding: [
    { field: "name", citations: selectedIdentity.sources },
    { field: "evidence[0].claim", citations: [{ url: "https://example.com/talk", title: "Talk" }] },
  ] } });
});

test("ambiguous candidate output never exposes blended claims", async () => {
  await mockDeep({ name: "Alex", summary: "Mixed", clarification: "Which employer?", employers: [profile.employers[0]], evidence: [{ claim: "Mixed namesake" }] }, async requests => {
    const input = "Alex Example, finance";
    const result = await researchCandidate({ input, selectionToken: createIdentityConfirmationToken(input, selectedIdentity) });
    assert.equal(requests.length, 1); // A contradictory profile must never trigger employer research.
    assert.ok("kind" in result && result.kind === "identity");
    assert.equal(result.question, "Which employer?");
    assert.deepEqual(result.candidates, []);
    assert.equal("evidence" in result, false);
    assert.equal("employers" in result, false);
    assert.equal("summary" in result, false);
  });
});

test("empty summaries become explicit source-based drafts instead of blank headings", async () => {
  await mockDeep({ summary: "", priorities: [], bullets: [{ evidenceId: "e-1", text: "Created SDK examples for a developer workshop.", employerIndex: -1, requirementIds }], skills: ["SDK", "Python", "developer workshop"], gaps: [], changes: [] }, async requests => {
    const result = await tailorResume({ profile, preferences, job });
    assert.equal(result.summary, profile.evidence[0].claim);
    assert.ok(result.summary.trim().length > 0);
    assert.deepEqual(result.skills, ["SDK", "developer workshop"]);
    assert.equal(requests.length, 2);
    assert.deepEqual(result.researchReceipts?.map(receipt => receipt.requestId), ["actual-provider-request", "review-request"]);
    assert.equal(result.reviewVersion, 1);
  });
});

test("employer attribution requires included history and an explicit single-employer work connection", async () => {
  const included: Profile = { ...profile, employers: [
    { company: "Acme", role: "Engineer", period: "", status: "current", sources: [{ title: "Acme employment", url: "https://example.com/acme" }] },
    { company: "Beta", role: "Engineer", period: "", status: "earlier", sources: [], userProvided: true },
  ], evidence: [
    { id: "e-1", claim: "Built API examples and taught developer workshops while working at Acme.", confirmed: true, sources: [] },
    { id: "e-2", claim: "Created an independent portfolio using Acme APIs.", confirmed: true, sources: [] },
    { id: "e-3", claim: "Built API examples at Acme and Beta.", confirmed: true, sources: [] },
  ] };
  const includedJob = { ...job, assessment: assessment.map(item => ({ ...item, evidenceIds: included.evidence.map(evidence => evidence.id) })) };
  const response = { summary: "Developer educator with demonstrated work creating API examples and teaching workshops.", priorities: [], bullets: included.evidence.map(item => ({ evidenceId: item.id, text: item.claim, employerIndex: 0, requirementIds })), skills: [], gaps: [], changes: [] };
  await mockDeep(response, async requests => {
    const result = await tailorResume({ profile: included, preferences, job: includedJob, employmentIncluded: true });
    assert.equal(result.bullets[0].employerIndex, 0);
    assert.equal(result.bullets[1].employerIndex, -1);
    assert.equal(result.bullets[2].employerIndex, -1);
    assert.match(String(requests[0].query), /INCLUDED EMPLOYMENT DATA: \[\{"index":0,"company":"Acme"/);
  });
  await mockDeep(response, async requests => {
    const result = await tailorResume({ profile: included, preferences, job: includedJob });
    assert.ok(result.bullets.every(bullet => bullet.employerIndex === -1));
    assert.match(String(requests[0].query), /INCLUDED EMPLOYMENT DATA: \[\]/);
  });
  await mockDeep({ ...response, bullets: [{ ...response.bullets[0], employerIndex: -1 }] }, async () => {
    const result = await tailorResume({ profile: included, preferences, job: includedJob, employmentIncluded: true });
    assert.equal(result.bullets[0].employerIndex, -1); // Preserve an explicit unassigned decision for the document helper.
  });
});

test("tailoring preserves original employer indices across included history, draft and semantic review", async () => {
  const included: Profile = { ...profile, employers: [
    { company: "UnsupportedCo", role: "Engineer", period: "2017–2019", status: "earlier", sources: [] },
    { company: "UncertainCo", role: "Engineer", period: "2019–2021", status: "uncertain", sources: [{ title: "Uncertain history", url: "https://example.com/uncertain" }] },
    { company: "IncludedCo", role: "Developer Advocate", period: "2021–Present", status: "current", sources: [], userProvided: true },
  ], evidence: [{ id: "e-1", claim: "Created 3 SDK examples for a developer workshop while working at IncludedCo.", confirmed: true, sources: [] }] };
  const chronology: RequirementAssessment = { id: "j1-r3", text: "Previous role as a Developer Advocate", importance: "required", support: "direct", evidenceIds: ["employment-2"], reason: "Included user-provided history supplies this title.", sources: [{ url: postingUrl, title: "Role" }] };
  const selectedJob = { ...job, assessment: [...assessment, chronology] };
  const response = { summary: "Developer educator with experience creating SDK examples for workshops.", priorities: [], bullets: [
    { evidenceId: "e-1", text: included.evidence[0].claim, employerIndex: 2, requirementIds },
  ], skills: [], gaps: [], changes: [] };
  await mockDeep(response, async requests => {
    const result = await tailorResume({ profile: included, preferences, job: selectedJob, employmentIncluded: true });
    assert.equal(requests.length, 2);
    assert.equal(result.bullets[0].employerIndex, 2);
    const employment = queryData<Array<{ index: number; provenance: string }>>(requests[0], "INCLUDED EMPLOYMENT DATA");
    assert.deepEqual(employment.map(item => item.index), [2]);
    assert.equal(employment[0].provenance, "user-provided");
    const review = queryData<{ employment: Array<{ index: number; provenance: string }> }>(requests[1], "REVIEW DATA");
    assert.deepEqual(review.employment.map(item => item.index), [2]);
    assert.equal(review.employment[0].provenance, "user-provided");
    assert.match(String(requests[0].query), /Selection controls inclusion, not factual verification/);
    assert.doesNotMatch(String(requests[0].query), /REVIEWED EMPLOYMENT|CONFIRMED CANDIDATE/);
  });
  await mockDeep(response, async requests => {
    const unsupported = { ...selectedJob, assessment: [...assessment, { ...chronology, evidenceIds: ["employment-0"] }] };
    await assert.rejects(tailorResume({ profile: included, preferences, job: unsupported, employmentIncluded: true }),
      (error: unknown) => error instanceof AppError && error.code === "FIT_REVIEW_REQUIRED");
    assert.equal(requests.length, 0);
  });
});

test("biography-only evidence does not become accomplishments or a nominally complete resume", async () => {
  const biography = { id: "e-bio", claim: "Example Candidate is currently a Developer Advocate at Zoom and previously worked at Example Previous.", confirmed: true, sources: [] };
  const mixed: Profile = { ...profile, evidence: [...profile.evidence, biography] };
  await mockDeep({ summary: "Developer educator with demonstrated work creating SDK examples for a developer workshop.", priorities: [], bullets: [
    { evidenceId: "e-bio", text: biography.claim, employerIndex: 0, requirementIds },
    { evidenceId: "e-1", text: "Created SDK examples for a developer workshop.", employerIndex: -1, requirementIds },
  ], skills: [], gaps: [], changes: [] }, async () => {
    const result = await tailorResume({ profile: mixed, preferences, job });
    assert.deepEqual(result.bullets.map(bullet => bullet.evidenceId), ["e-1"]);
    assert.ok(result.qualityNotes?.some(note => note.includes("biography")));
  });
  await mockDeep({}, async requests => {
    await assert.rejects(tailorResume({ profile: { ...profile, evidence: [biography] }, preferences, job }), (error: unknown) => error instanceof AppError && error.code === "WORK_EVIDENCE_REQUIRED");
    assert.equal(requests.length, 0);
  });
});

test("opportunities enforce exclusions, closed-role removal and selected IDs", async () => {
  await mockDeep({ jobs: [
    { ...job, company: "Zoom", url: "https://example.com/zoom" },
    { ...job, company: "Example Previous", url: "https://example.com/previous" },
    { ...job, status: "closed", url: "https://example.com/closed" },
    { ...job, evidenceIds: ["e-2", "made-up"], url: "https://example.com/unselected" },
    { ...job, company: "Metabase", evidenceIds: ["e-1", "made-up"], url: "https://example.com/good" },
  ] }, async requests => {
    const result = await researchOpportunities({ profile, preferences });
    assert.equal(result.excludedCount, 2);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].company, "Metabase");
    assert.deepEqual(result.jobs[0].evidenceIds, ["e-1"]);
    assert.doesNotMatch(String(requests[0].query), /UNSELECTED/);
    assert.equal(requests[0].type, "deep");
    assert.equal(requests.length, 2);
    assert.equal(result.jobs[0].fitVersion, 2);
    assert.deepEqual(result.researchReceipts?.map(receipt => receipt.requestId), ["actual-provider-request", "qualification-request"]);
  });
});

test("requested product function wins over prior DevRel titles when actual product work is supported", async () => {
  const productProfile: Profile = { ...profile, evidence: [...profile.evidence,
    { id: "e-product-1", claim: "Owned the roadmap for a developer-facing web product.", confirmed: true, sources: [] },
    { id: "e-product-2", claim: "Led customer interviews to prioritize features for the web product.", confirmed: true, sources: [] },
  ] };
  await mockDeep({ jobs: [
    { ...job, title: "Senior Developer Advocate", url: "https://example.com/devrel" },
    { ...job, title: "Product Manager", url: "https://example.com/product" },
  ] }, async requests => {
    const result = await researchOpportunities({ profile: productProfile, preferences: { ...preferences, roles: "Product management" } });
    assert.deepEqual(result.jobs.map(item => item.title), ["Product Manager"]);
    assert.equal(result.roleFilteredCount, 1);
    assert.match(String(requests[0].query), /Product management/);
    assert.match(String(requests[0].systemPrompt), /HARD search constraint/);
  }, {}, { qualify: request => qualificationFixture(request, [
    { requirement: "Own the web product roadmap", importance: "core", evidenceIds: ["e-product-1"], support: "direct", reason: "Confirmed roadmap ownership." },
    { requirement: "Lead customer discovery and prioritization", importance: "core", evidenceIds: ["e-product-2"], support: "direct", reason: "Selected interviews and prioritization." },
  ]) });
});

test("ambiguous product requests clarify before spending a Deep call", async () => {
  await mockDeep({ jobs: [] }, async requests => {
    await assert.rejects(researchOpportunities({ profile, preferences: { ...preferences, roles: "product" } }), (error: unknown) => error instanceof AppError && error.code === "TARGET_ROLE_AMBIGUOUS");
    assert.equal(requests.length, 0);
  });
});

test("removing a default employer exclusion is respected by search", async () => {
  await mockDeep({ jobs: [{ ...job, company: "Zoom", url: "https://example.com/zoom" }] }, async () => {
    const result = await researchOpportunities({ profile, preferences: { ...preferences, excludedEmployers: [] } });
    assert.equal(result.jobs[0]?.company, "Zoom");
    assert.equal(result.excludedCount, 0);
  });
});

test("tailoring researches role context and disallows unknown proof or inflated numbers", async () => {
  assert.equal(hasUnsupportedNumbers("Created 300 examples", "Created 3 examples"), true);
  await mockDeep({ summary: "10 years of leadership", priorities: ["Teach developers"], bullets: [
    { evidenceId: "e-1", text: "Created 300 SDK examples.", requirementIds },
    { evidenceId: "e-2", text: "Built a spacecraft", requirementIds },
    { evidenceId: "unknown", text: "Invented experience", requirementIds },
  ], gaps: [], changes: [] }, async requests => {
    const result = await tailorResume({ profile, preferences, job });
    assert.deepEqual(result.bullets, [{ evidenceId: "e-1", text: profile.evidence[0].claim, employerIndex: -1, requirementIds }]);
    assert.equal(result.summary, profile.evidence[0].claim);
    assert.ok(result.qualityNotes?.some(note => note.includes("original selected wording")));
    assert.match(String(requests[0].query), /https:\/\/careers.example.com\/jobs\/123/);
    assert.doesNotMatch(String(requests[0].query), /UNSELECTED/);
    assert.equal(requests[0].type, "deep");
  });
});

test("opportunity integration withholds product jobs when Deep finds only transferable collaboration", async () => {
  const collaborator: Profile = { ...profile, evidence: [{ id: "e-1", claim: "Hosted API workshops and collaborated with product managers.", confirmed: true, sources: [] }] };
  await mockDeep({ jobs: [{ ...job, title: "Product Manager", whyMatch: "Strong fit because API workshops prove product ownership." }] }, async requests => {
    const result = await researchOpportunities({ profile: collaborator, preferences: { ...preferences, roles: "Product management" } });
    assert.deepEqual(result.jobs, []);
    assert.equal(result.fitFilteredCount, 1);
    assert.deepEqual(result.missingEvidence, ["Own the web application roadmap", "Lead customer discovery and prioritization"]);
    assert.equal(requests.length, 2);
    assert.ok(requests.every(request => request.type === "deep"));
  }, {}, { qualify: request => qualificationFixture(request, [
    { requirement: "Own the web application roadmap", importance: "core", evidenceIds: ["e-1"], support: "transferable", reason: "Product collaboration does not demonstrate roadmap ownership." },
    { requirement: "Lead customer discovery and prioritization", importance: "core", evidenceIds: [], support: "missing", reason: "Workshops do not establish discovery or prioritization experience." },
  ]) });
});

test("draft integration rejects semantic inflation even when IDs and every number remain valid", async () => {
  const inflated = "Created 3 SDK examples for a developer workshop, directly increasing platform adoption.";
  assert.equal(hasUnsupportedNumbers(inflated, profile.evidence[0].claim), false);
  await mockDeep({ summary: "Developer educator with demonstrated work creating SDK examples and workshop materials.", priorities: [],
    bullets: [{ evidenceId: "e-1", text: inflated, employerIndex: -1, requirementIds }], skills: [], gaps: [], changes: [],
  }, async requests => {
    await assert.rejects(tailorResume({ profile, preferences, job }), (error: unknown) => error instanceof AppError && error.code === "NO_SUPPORTED_DRAFT");
    assert.equal(requests.length, 2);
    const review = queryData<{ draft: { bullets: Array<{ text: string }> } }>(requests[1], "REVIEW DATA");
    assert.equal(review.draft.bullets[0].text, inflated); // Numeric guard alone did not remove it.
  }, {}, { review: request => {
    const output = supportedReviewFixture(request);
    const content = output.content as { checks: Array<{ target: string; supported: boolean; reason: string }> };
    content.checks = content.checks.map(check => check.target === "bullet:0" ? { ...check, supported: false, reason: "The selected work does not establish a causal increase in adoption." } : check);
    return output;
  } });
});

test("resume preparation retains unknown required and core criteria without inventing support", () => {
  const missing: RequirementAssessment = { id: "j1-gap", text: "Python expertise", importance: "required", support: "missing", evidenceIds: [], reason: "Not established by selected work.", sources: [{ url: postingUrl, title: "Role" }] };
  const coreGap: RequirementAssessment = { ...missing, id: "j1-core-gap", text: "Maintain a Python SDK", importance: "core" };
  const prepared = prepareResumeInput({ profile, preferences, job: { ...job, assessment: [...assessment, missing, coreGap], gaps: [missing.text, coreGap.text] } });
  assert.deepEqual(prepared.requirements.slice(2), [missing, coreGap]);
  assert.deepEqual(prepared.job.gaps, [missing.text, coreGap.text]);
});

test("resume preparation requires two directly supported work responsibilities and valid provenance", () => {
  const gap: RequirementAssessment = { id: "gap", text: "Maintain a Python SDK", importance: "core", support: "missing", evidenceIds: [], reason: "Not established.", sources: [{ url: postingUrl, title: "Role" }] };
  const biography = { id: "bio", claim: "Example Candidate is currently a Developer Advocate at Zoom.", confirmed: true, sources: [] };
  const included = { ...profile, evidence: [...profile.evidence, biography] };
  const additionalGaps = [1, 2, 3].map(i => ({ ...gap, id: `gap-${i}` }));
  const prepared = prepareResumeInput({ profile: included, preferences, job: { ...job, assessment: [...assessment, ...additionalGaps], gaps: additionalGaps.map(item => item.text) } });
  assert.deepEqual(prepared.requirements.slice(2), additionalGaps);
  assert.ok(prepared.requirements.slice(2).every(item => item.support === "missing" && item.evidenceIds.length === 0));
  const invalidJobs = [
    { ...job, status: "uncertain" },
    { ...job, assessment: [assessment[0], ...additionalGaps] },
    { ...job, assessment: assessment.map(item => ({ ...item, evidenceIds: ["bio"] })) },
    { ...job, assessment: [assessment[0], { ...assessment[1], sources: [] }] },
    { ...job, assessment: [...assessment, { ...gap, evidenceIds: ["e-1"] }] },
  ];
  for (const invalid of invalidJobs) assert.throws(() => prepareResumeInput({ profile: included, preferences, job: invalid }),
    (error: unknown) => error instanceof AppError && error.code === "FIT_REVIEW_REQUIRED");
});

test("resume draft cannot use missing requirements even when candidate and requirement IDs exist", async () => {
  const missing: RequirementAssessment = { id: "j1-gap", text: "Python expertise", importance: "required", support: "missing", evidenceIds: [], reason: "Not established by selected work.", sources: [{ url: postingUrl, title: "Role" }] };
  const extraEvidence = { id: "e-3", claim: "Hosted a technical meetup for API developers.", confirmed: true, sources: [] };
  const selectedProfile = { ...profile, evidence: [...profile.evidence, extraEvidence] };
  const selectedJob = { ...job, assessment: [...assessment, missing], gaps: [missing.text] };
  await mockDeep({ summary: "Developer educator with demonstrated SDK examples and workshop materials.", priorities: [], bullets: [
    { evidenceId: "e-1", text: profile.evidence[0].claim, employerIndex: -1, requirementIds: [...requirementIds, missing.id] },
    { evidenceId: "e-3", text: extraEvidence.claim, employerIndex: -1, requirementIds: [missing.id] },
  ], skills: [], gaps: [], changes: [] }, async requests => {
    const result = await tailorResume({ profile: selectedProfile, preferences, job: selectedJob });
    assert.equal(requests.length, 2);
    // The model returned no gaps; the original qualification gap must survive.
    assert.deepEqual(result.gaps, [missing.text]);
    assert.deepEqual(result.bullets.map(item => ({ evidenceId: item.evidenceId, requirementIds: item.requirementIds })), [{ evidenceId: "e-1", requirementIds }]);
    const sent = queryData<RequirementAssessment[]>(requests[0], "ASSESSED REQUIREMENTS");
    assert.equal(sent.find(item => item.id === missing.id)?.support, "missing");
  });
});

test("legacy jobs cannot bypass fit qualification before a paid resume call", async () => {
  await mockDeep({}, async requests => {
    for (const legacy of [{ ...job, fitVersion: undefined }, { ...job, assessment: undefined }]) {
      await assert.rejects(tailorResume({ profile, preferences, job: legacy }), (error: unknown) => error instanceof AppError && error.code === "FIT_REVIEW_REQUIRED");
    }
    assert.equal(requests.length, 0);
  });
});

test("full search requests reach both Deep stages and only matching verdicts reach the shortlist", async () => {
  const cases = [
    { roles: "DevRel at Anthropic", company: "Anthropic", title: "Developer Advocate", location: "Any location" },
    { roles: "remote product management in healthcare", company: "Care Team", title: "Product Manager", location: "Any location" },
    { roles: "backend engineering in SF at Exa", company: "Exa", title: "Software Engineer", location: "Any location" },
    { roles: "Anthropic", company: "Anthropic", title: "Developer Advocate", location: "Remote" },
    { roles: "DevRel at Anthropic or OpenAI", company: "OpenAI", title: "Developer Advocate", location: "Remote" },
    { roles: "roles at Sales", company: "Sales", title: "Software Engineer", location: "Any location" }
  ];
  for (const item of cases) {
    const requested = { ...preferences, roles: item.roles, location: item.location };
    const discovered = { ...job, company: item.company, title: item.title };
    for (const verdict of ["match", "mismatch", "uncertain"]) {
      await mockDeep({ jobs: [discovered] }, async requests => {
        const result = await researchOpportunities({ profile, preferences: requested });
        assert.equal(requests.length, 2, "Discovery and qualification, without an extra intent call");
        assert.ok(requests.every(request => String(request.query).includes(JSON.stringify(item.roles))));
        assert.ok(requests.every(request => String(request.query).includes(item.location)));
        assert.equal(result.fitVersion, 2);
        assert.equal(result.jobs.length, verdict === "match" ? 1 : 0, `${item.roles}: ${verdict}`);
        if (result.jobs.length) {
          assert.deepEqual(result.jobs[0].requestContext, searchRequestContext(requested));
          assert.equal(prepareResumeInput({ profile, preferences: requested, job: result.jobs[0] }).job.fitVersion, 2);
        }
      }, {}, { qualify: request => {
        const output = qualificationFixture(request);
        const content = output.content as { criteria: Array<Record<string, unknown>> };
        content.criteria.forEach(row => { row.requestMatch = verdict; });
        return output;
      } });
    }
  }
});

test("stale or missing search context blocks tailoring before any paid call", async () => {
  await mockDeep({}, async requests => {
    for (const changed of [
      { ...preferences, roles: "Developer relations at Anthropic" },
      { ...preferences, location: "San Francisco" },
      { ...preferences, excludedEmployers: ["Another Company"] }
    ]) await assert.rejects(tailorResume({ profile, preferences: changed, job }), (error: unknown) => error instanceof AppError && error.code === "SEARCH_REQUEST_CHANGED");
    for (const requestContext of [undefined, {}, { ...preferences, excludedEmployers: [3] }]) {
      await assert.rejects(tailorResume({ profile, preferences, job: { ...job, requestContext } }), (error: unknown) => error instanceof AppError && error.code === "SEARCH_REQUEST_CHANGED");
    }
    assert.equal(requests.length, 0);
  });
  const reordered = { ...preferences, excludedEmployers: ["Example Previous", "Zoom Video Communications, Inc.", "Meta", "Meta"] };
  assert.equal(matchesSearchRequest(job.requestContext, reordered), true);
  assert.equal(prepareResumeInput({ profile, preferences: reordered, job }).job.fitVersion, 2);
});

test("same-origin guard runs before any paid operation", async () => {
  let called = false;
  const response = await researchResponse(new Request("https://app.example.com/api/research", { method: "POST", headers: { origin: "https://other.example.com", "content-type": "application/json" }, body: "{}" }), async () => { called = true; });
  assert.equal(response.status, 403);
  assert.equal(called, false);
});

// Restore environment settings after each HTTP check so a test cannot change
// how later requests choose their public origin.
async function withPublicOrigins(config: { APP_ORIGIN?: string; RENDER_EXTERNAL_URL?: string }, work: () => Promise<void>) {
  const keys = ["APP_ORIGIN", "RENDER_EXTERNAL_URL"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) {
    if (config[key] === undefined) delete process.env[key];
    else process.env[key] = config[key];
  }
  try { await work(); }
  finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("HTTP origin accepts Render's public URL when Next.js receives an internal URL", async () => {
  await withPublicOrigins({ RENDER_EXTERNAL_URL: "https://next-move.onrender.com/" }, async () => {
    let called = false;
    const response = await researchResponse(new Request("http://0.0.0.0:10000/api/research", {
      method: "POST", headers: { origin: "https://next-move.onrender.com", "content-type": "application/json" }, body: "{}",
    }), async () => { called = true; return { ok: true }; });
    assert.equal(response.status, 200);
    assert.equal(called, true);
    assert.deepEqual(await response.json(), { ok: true });
  });
});

test("HTTP origin uses APP_ORIGIN ahead of Render's default domain", async () => {
  await withPublicOrigins({ APP_ORIGIN: "https://careers.example.com", RENDER_EXTERNAL_URL: "https://next-move.onrender.com" }, async () => {
    for (const [origin, expectedStatus] of [["https://careers.example.com", 200], ["https://next-move.onrender.com", 403]] as const) {
      let called = false;
      const response = await researchResponse(new Request("http://0.0.0.0:10000/api/research", {
        method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}",
      }), async () => { called = true; return { ok: true }; });
      assert.equal(response.status, expectedStatus);
      assert.equal(called, expectedStatus === 200);
    }
  });
});

test("HTTP origin rejects hostile origins even when forwarded headers match them", async () => {
  await withPublicOrigins({ RENDER_EXTERNAL_URL: "https://next-move.onrender.com" }, async () => {
    let called = false;
    const response = await researchResponse(new Request("http://0.0.0.0:10000/api/research", {
      method: "POST", headers: { origin: "https://hostile.example.com", "x-forwarded-host": "hostile.example.com", "x-forwarded-proto": "https", "content-type": "application/json" }, body: "{}",
    }), async () => { called = true; });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "INVALID_ORIGIN");
    assert.equal(called, false);
  });
});

test("HTTP origin preserves local same-origin behavior without public URL settings", async () => {
  await withPublicOrigins({}, async () => {
    for (const [origin, expectedStatus] of [["http://localhost:3100", 200], ["https://hostile.example.com", 403]] as const) {
      let called = false;
      const response = await researchResponse(new Request("http://localhost:3100/api/research", {
        method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}",
      }), async () => { called = true; return { ok: true }; });
      assert.equal(response.status, expectedStatus);
      assert.equal(called, expectedStatus === 200);
    }
  });
});

test("HTTP origin fails closed for invalid public URL configuration", async () => {
  await withPublicOrigins({ APP_ORIGIN: "not-a-url", RENDER_EXTERNAL_URL: "https://next-move.onrender.com" }, async () => {
    let called = false;
    const response = await researchResponse(new Request("http://localhost:3100/api/research", {
      method: "POST", headers: { origin: "http://localhost:3100", "content-type": "application/json" }, body: "{}",
    }), async () => { called = true; });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "INVALID_APP_ORIGIN");
    assert.equal(called, false);
  });
});

test("app SSE sends real activities followed by a typed final result", async () => {
  const response = await researchResponse(new Request("https://app.example.com/api/research", { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: "{}" }), async (_body, { emit }) => {
    emit?.({ id: "actual", label: "Received data", state: "complete" });
    return { name: "Example" };
  });
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  const stream = await response.text();
  assert.match(stream, /event: activity/);
  assert.match(stream, /event: complete\ndata: \{"name":"Example"\}/);
  assert.doesNotMatch(stream, /event: error/);
});

test("malformed provider JSON is a response error, never a misleading connection error", async () => {
  const original = globalThis.fetch;
  const oldKey = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "local-test-placeholder";
  globalThis.fetch = async () => new Response("not-json", { status: 200 });
  try {
    await assert.rejects(runDeep({ stage: "candidate", query: "test", systemPrompt: "test", outputSchema: candidateSchema }), (error: unknown) => error instanceof AppError && error.code === "INVALID_DEEP_RESPONSE");
  } finally { globalThis.fetch = original; if (oldKey === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = oldKey; }
});
