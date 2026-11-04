import test from "node:test";
import assert from "node:assert/strict";
import { candidateSchema, workEvidenceSchema } from "../../../src/backend/features/candidate/schemas.ts";
import { researchCandidate } from "../../../src/backend/workflows/01-research-person.ts";
import { createIdentityConfirmationToken, type ConfirmedIdentity } from "../../../src/backend/features/candidate/resolve-identity.ts";
import { identifyPerson } from "../../../src/backend/features/candidate/identify.ts";
import { validateProfile } from "../../../src/backend/validation.ts";
import type { Activity, Profile } from "../../../src/shared/types.ts";

// These enrichment tests start after a person deliberately chooses this profile.
// The expected identity stays fixed, independently of each mocked Deep response.
const selectedIdentity: ConfirmedIdentity = {
  id: "alex-example", name: "Alex Example", headline: "Research Engineer", employer: "Acme",
  profileUrl: "https://example.com/alex", sources: [{ title: "Profile", url: "https://example.com/alex" }],
};
async function researchConfirmedCandidate(body: { input: string }, options: Parameters<typeof researchCandidate>[1] = {}): Promise<Profile> {
  const selectionToken = createIdentityConfirmationToken(body.input, selectedIdentity);
  const result = await researchCandidate({ ...body, selectionToken }, options);
  assert.ok(!("kind" in result), "The chosen identity must be verified before employer research");
  return result;
}

const employer = { company: "Acme", role: "Research Engineer", period: "2022–2025", status: "last" };
const profileContent = { name: "Alex Example", summary: "Research engineer.", clarification: "", employers: [employer], evidence: [
  { claim: "Alex Example is a Research Engineer at Acme." },
] };
const profileGrounding = [
  { field: "name", citations: [{ title: "Profile", url: "https://example.com/alex" }] },
  { field: "employers[0].company", citations: [{ title: "Profile", url: "https://example.com/alex" }] },
  { field: "evidence[0].claim", citations: [{ title: "Profile", url: "https://example.com/alex" }] },
];

type MockResult = { content: unknown; grounding?: unknown[]; status?: number; results?: unknown[] };
const resolvedIdentityResponse: MockResult = {
  content: { resolution: "resolved", question: "", candidates: [{
    name: selectedIdentity.name, headline: selectedIdentity.headline, employer: selectedIdentity.employer,
    profileUrl: selectedIdentity.profileUrl, matchEvidence: "Alex Example is the Research Engineer at Acme named in the request.",
  }] },
  grounding: [
    { field: "candidates[0].name", citations: selectedIdentity.sources },
    { field: "candidates[0].matchEvidence", citations: selectedIdentity.sources },
  ],
};
async function withResponses(results: MockResult[], work: (requests: Record<string, unknown>[]) => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.EXA_API_KEY;
  const requests: Record<string, unknown>[] = [];
  process.env.EXA_API_KEY = "test-placeholder";
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.exa.ai/search");
    requests.push(JSON.parse(String(init?.body)));
    const result = results[requests.length - 1];
    assert.ok(result, "No extra paid request or unbounded research loop is allowed");
    return Response.json({ requestId: `request-${requests.length}`, results: result.results ?? [], costDollars: { total: 0.012 }, output: { content: result.content, grounding: result.grounding ?? [] } }, { status: result.status ?? 200 });
  };
  try { await work(requests); }
  finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = previousKey; }
}

function propertyCount(schema: unknown): number {
  if (!schema || typeof schema !== "object") return 0;
  return Object.entries(schema).reduce((count, [key, value]) => count + (key === "properties" && value && typeof value === "object" ? Object.keys(value).length : 0) + propertyCount(value), 0);
}

test("candidate and work schemas fit Deep's total property budget", () => {
  assert.equal(propertyCount(candidateSchema), 10);
  assert.equal(propertyCount(workEvidenceSchema), 7);
  const schema = candidateSchema as { properties: { employers: { items: { properties: { status: { enum: string[] } } } } } };
  assert.deepEqual(schema.properties.employers.items.properties.status.enum, ["current", "earlier", "uncertain"]);
});

test("career parsing normalizes legacy last status without promoting unknown or older history", async () => {
  const cases = [
    { input: ["current", "last", "earlier", "uncertain", "unknown"], expected: ["current", "earlier", "earlier", "uncertain", "uncertain"] },
    { input: ["last", "earlier", "uncertain"], expected: ["current", "earlier", "uncertain"] },
    { input: ["earlier", "uncertain"], expected: ["earlier", "uncertain"] }
  ];
  for (const scenario of cases) {
    const employers = scenario.input.map((status, index) => ({ ...employer, company: index ? `Employer ${index}` : "Acme", status }));
    await withResponses([{ content: { ...profileContent, employers }, grounding: profileGrounding }], async requests => {
      const result = await identifyPerson("Alex Example, Acme", { identity: selectedIdentity });
      assert.deepEqual(result.employers.map(item => item.status), scenario.expected);
      assert.deepEqual(result.employers.map(item => item.period), employers.map(item => item.period), "Normalization must not rewrite researched dates");
      assert.ok(result.employers.every(item => item.userProvided !== true), "Public research cannot become user-provided history");
      assert.equal(requests.length, 1);
      assert.match(String(requests[0].systemPrompt), /most recent supported employment when there is no current employer/);
    });
  }
});

test("profile validation preserves explicit selection and user-provided history without a review flag", () => {
  const result = validateProfile({ ...profileContent,
    evidence: [{ id: "e-1", claim: "Built evaluation tooling.", sources: [], confirmed: true },
      { id: "e-2", claim: "Wrote a project guide.", sources: [], confirmed: false }],
    employers: [{ ...employer, status: "last", userProvided: true, sources: [] },
      { ...employer, company: "Earlier employer", status: "earlier", userProvided: "true", sources: [] },
      { ...employer, company: "Uncertain employer", status: "uncertain", userProvided: true, sources: [] }]
  });
  assert.deepEqual(result.employers.map(item => item.status), ["current", "earlier", "uncertain"]);
  assert.deepEqual(result.employers.map(item => item.userProvided), [true, false, true]);
  assert.deepEqual(result.evidence.map(item => item.confirmed), [true, false], "Selection means inclusion, not a factual-verification gate");
  assert.throws(() => validateProfile({ ...result, evidence: result.evidence.map(item => ({ ...item, confirmed: false })) }),
    (error: unknown) => error instanceof Error && error.message === "Select at least one experience detail to use.");
});

test("edited source-free claims keep user-provided provenance through profile validation", () => {
  const result = validateProfile({ ...profileContent,
    evidence: [
      { id: "e-1", claim: "Built my team's evaluation tooling.", sources: [], sourceExcerpts: [], confidence: "user-provided", confirmed: true },
      { id: "e-2", claim: "Published a project guide.", sources: selectedIdentity.sources, confidence: "medium", confirmed: true },
      { id: "e-3", claim: "Documented a work example.", sources: [], confidence: "verified", confirmed: true }
    ]
  });
  assert.equal(result.evidence[0].confidence, "user-provided");
  assert.deepEqual(result.evidence[0].sources, []);
  assert.deepEqual(result.evidence[0].sourceExcerpts, []);
  assert.equal(result.evidence[1].confidence, "medium");
  assert.deepEqual(result.evidence[1].sources, selectedIdentity.sources);
  assert.equal(result.evidence[2].confidence, undefined, "Unknown confidence labels cannot claim verification");
});

test("a Deep-resolved identity continues through career and role research while preserving partial failures and receipt order", async () => {
  const employers = [employer, { company: "Otherco", role: "Scientist", period: "2018–2022", status: "earlier" }];
  const claim = "Alex Example built evaluation methods while working at Acme.";
  await withResponses([
    resolvedIdentityResponse,
    { content: { ...profileContent, employers }, grounding: profileGrounding },
    { content: { findings: [{ employerIndex: 0, claim }], coverage: [{ employerIndex: 0, outcome: "evidence_found", note: "Found a documented project." }] },
      grounding: [{ field: "findings[0].claim", citations: [{ url: "https://example.com/acme-project", title: "Acme project" }] }] },
    { content: {}, status: 503 },
  ], async requests => {
    const result = await researchCandidate({ input: "Alex Example, Research Engineer at Acme" });
    assert.ok(!("kind" in result), "A grounded resolved identity should continue without a selection click");
    assert.equal(requests.length, 4);
    assert.ok(requests.every(request => request.type === "deep"));
    assert.ok("resolution" in (requests[0].outputSchema as { properties: Record<string, unknown> }).properties);
    assert.ok("employers" in (requests[1].outputSchema as { properties: Record<string, unknown> }).properties);
    assert.ok(String(requests[1].query).includes(selectedIdentity.profileUrl));
    assert.ok(String(requests[2].query).includes(selectedIdentity.profileUrl));
    assert.ok(String(requests[3].query).includes('"employerIndex":1'));
    assert.deepEqual(result.evidence.map(item => item.claim), [profileContent.evidence[0].claim, claim]);
    assert.ok(result.evidence.every(item => !item.confirmed), "The frontend applies default selection after raw research returns");
    assert.equal(result.evidence[1].sources[0].url, "https://example.com/acme-project");
    assert.deepEqual(result.workCoverage?.map(item => item.outcome), ["evidence_found", "failed"]);
    assert.match(result.researchWarnings?.[0] ?? "", /Otherco.*temporarily unavailable/);
    assert.deepEqual(result.researchReceipts?.map(item => item.requestId), ["request-1", "request-2", "request-3"]);
    assert.equal(result.receipt.requestId, "request-2", "The main profile receipt remains the career research request");
  });
});

test("an identity provider failure cannot continue into career research", async () => {
  await withResponses([{ content: {}, status: 503 }], async requests => {
    await assert.rejects(researchCandidate({ input: "Alex Example, Acme" }), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "EXA_UNAVAILABLE");
    assert.equal(requests.length, 1);
  });
});

test("a career provider failure after identity resolution cannot return a profile or start employer research", async () => {
  await withResponses([resolvedIdentityResponse, { content: {}, status: 503 }], async requests => {
    await assert.rejects(researchCandidate({ input: "Alex Example, Acme" }), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "EXA_UNAVAILABLE");
    assert.equal(requests.length, 2);
  });
});

test("new ambiguity discovered during automatic career research returns a question before any role research", async () => {
  await withResponses([
    resolvedIdentityResponse,
    { content: { ...profileContent, clarification: "Which Acme office did you work at?" }, grounding: profileGrounding },
  ], async requests => {
    const input = "Alex Example, Acme";
    const result = await researchCandidate({ input });
    assert.ok("kind" in result && result.kind === "identity");
    assert.equal(result.query, input);
    assert.equal(result.question, "Which Acme office did you work at?");
    assert.deepEqual(result.candidates, []);
    assert.equal("evidence" in result, false);
    assert.equal("employers" in result, false);
    assert.equal(requests.length, 2);
    assert.equal(result.receipt?.requestId, "request-2");
  });
});

test("sparse role history triggers one focused Deep request and preserves grounded work details", async () => {
  const findings = [
    { employerIndex: 0, claim: "Alex Example designed a clinical research workflow at Acme." },
    { employerIndex: 0, claim: "Alex Example published reproducible evaluation methods at Acme." },
  ];
  await withResponses([
    { content: profileContent, grounding: profileGrounding },
    { content: { findings, coverage: [{ employerIndex: 0, outcome: "evidence_found", note: "Found two work examples." }] }, grounding: findings.map((_, i) => ({ field: `findings[${i}].claim`, citations: [{ url: `https://example.com/work-${i}`, title: `Work ${i}` }] })) },
  ], async requests => {
    const activities: Activity[] = [];
    const result = await researchConfirmedCandidate({ input: "Alex Example, research" }, { emit: item => activities.push(item) });
    assert.equal(requests.length, 2);
    assert.ok(requests.every(request => request.type === "deep"));
    assert.equal((requests[1].additionalQueries as string[]).length, 4);
    assert.match(String((requests[1].additionalQueries as string[])[0]), /Alex Example.*Acme.*Research Engineer/);
    assert.match(String(requests[1].query), /https:\/\/example.com\/alex/);
    assert.equal(result.evidence.length, 3);
    assert.ok(result.evidence.every(item => !item.confirmed));
    assert.equal(result.workCoverage?.[0].status, "covered");
    assert.equal(result.workCoverage?.[0].evidenceCount, 2);
    assert.equal(result.workCoverage?.[0].researched, true);
    assert.equal(result.workCoverage?.[0].outcome, "evidence_found");
    assert.ok(requests.every(request => JSON.stringify(request.contents).includes('"maxCharacters":12000')));
    assert.deepEqual(result.researchReceipts?.map(receipt => receipt.requestId), ["request-1", "request-2"]);
    assert.equal(result.receipt.requestId, "request-1");
    assert.equal(result.grounding.find(field => field.field === "evidence[2].claim")?.citations[0].url, "https://example.com/work-1");
    assert.ok(activities.some(item => item.id === "work:0:grounding" && item.origin === "exa" && item.scope?.includes("Acme")));
    assert.ok(activities.some(item => item.id === "work-coverage" && item.state === "complete"));
  });
});

test("ambiguous identity is clarified before any employer enrichment", async () => {
  await withResponses([{ content: { ...profileContent, clarification: "Which Acme office?" }, grounding: profileGrounding }], async requests => {
    const input = "Alex Example, Acme";
    const result = await researchCandidate({ input, selectionToken: createIdentityConfirmationToken(input, selectedIdentity) });
    assert.equal(requests.length, 1);
    assert.ok("kind" in result && result.kind === "identity");
    assert.equal(result.question, "Which Acme office?");
    assert.deepEqual(result.candidates, []);
    assert.equal("evidence" in result, false);
    assert.equal("employers" in result, false);
  });
});

test("every role receives focused research even when two sourced work details already exist", async () => {
  const claims = ["Alex Example designed evaluation methods at Acme.", "Alex Example led research workshops while working at Acme."];
  await withResponses([{ content: { ...profileContent, evidence: claims.map(claim => ({ claim })) }, grounding: [
    ...profileGrounding, { field: "evidence[1].claim", citations: [{ url: "https://example.com/work", title: "Work" }] },
  ] }, { content: { findings: [], coverage: [{ employerIndex: 0, outcome: "no_public_detail", note: "No additional public detail found." }] } }], async requests => {
    const result = await researchConfirmedCandidate({ input: "Alex Example, Acme" });
    assert.equal(requests.length, 2);
    assert.equal(result.workCoverage?.[0].status, "covered");
    assert.equal(result.researchReceipts?.length, 2);
    assert.equal(result.workCoverage?.[0].researched, true);
    assert.equal(result.workCoverage?.[0].outcome, "no_public_detail");
  });
});

test("uncited, wrong-person, wrong-employer and biography findings cannot fill work gaps", async () => {
  const findings = [
    { employerIndex: 0, claim: "Alex Example designed evaluation methods at Acme." }, // no citation
    { employerIndex: 0, claim: "Another Person led research workshops at Acme." },
    { employerIndex: 0, claim: "Alex Example led research workshops at Otherco." },
    { employerIndex: 0, claim: "Alex Example is currently a Research Engineer at Acme." },
    { employerIndex: 0, claim: "Alex Example published a benchmark using Acme APIs." },
  ];
  await withResponses([
    { content: profileContent, grounding: profileGrounding },
    { content: { findings, coverage: [{ employerIndex: 0, outcome: "no_public_detail", note: "No specific role descriptions were available." }] }, grounding: findings.slice(1).map((_, i) => ({ field: `findings[${i + 1}].claim`, citations: [{ url: "https://example.com/unrelated", title: "Unrelated" }] })) },
  ], async () => {
    const result = await researchConfirmedCandidate({ input: "Alex Example, Acme" });
    assert.equal(result.evidence.length, 1);
    assert.equal(result.workCoverage?.[0].status, "missing");
    assert.match(result.workCoverage?.[0].note ?? "", /No specific role descriptions/);
  });
});

test("a failed work-detail request keeps initial findings and reports incomplete research", async () => {
  await withResponses([
    { content: profileContent, grounding: profileGrounding },
    { content: {}, status: 503 },
  ], async requests => {
    const result = await researchConfirmedCandidate({ input: "Alex Example, Acme" });
    assert.equal(requests.length, 2);
    assert.equal(result.evidence.length, 1);
    assert.equal(result.workCoverage?.[0].status, "missing");
    assert.equal(result.researchReceipts?.length, 1);
    assert.match(result.researchWarnings?.[0] ?? "", /Acme.*temporarily unavailable/);
    assert.equal(result.workCoverage?.[0].researched, false);
    assert.equal(result.workCoverage?.[0].outcome, "failed");
  });
});

test("grounded employers can be enriched even when the first pass found no work claims", async () => {
  await withResponses([
    { content: { ...profileContent, evidence: [] }, grounding: profileGrounding },
    { content: { findings: [], coverage: [{ employerIndex: 0, outcome: "source_unavailable", note: "Profile role details were not accessible." }] } },
  ], async requests => {
    const result = await researchConfirmedCandidate({ input: "Alex Example, Acme" });
    assert.equal(requests.length, 2);
    assert.equal(result.clarification, "");
    assert.equal(result.employers.length, 1);
    assert.equal(result.workCoverage?.[0].status, "missing");
  });
});

test("every employment entry is researched independently and a failed entry preserves other findings", async () => {
  const employers = [employer, { company: "Otherco", role: "Scientist", period: "2018–2022", status: "earlier" },
    { company: "Thirdco", role: "Analyst", period: "2015–2018", status: "earlier" }];
  const finding = (index: number, claim: string) => ({ content: { findings: [{ employerIndex: index, claim }], coverage: [{ employerIndex: index, outcome: "evidence_found", note: "Work documented." }] },
    grounding: [{ field: "findings[0].claim", citations: [{ url: `https://example.com/employer-${index}`, title: "Work detail" }] }] });
  await withResponses([
    { content: { ...profileContent, employers }, grounding: profileGrounding },
    finding(0, "Alex Example built evaluation methods at Acme."),
    { content: {}, status: 503 },
    finding(2, "Alex Example developed data quality checks at Thirdco."),
  ], async requests => {
    const result = await researchConfirmedCandidate({ input: "Alex Example, researcher" });
    assert.equal(requests.length, 4);
    assert.ok(String(requests[1].query).includes('"employerIndex":0'));
    assert.ok(String(requests[2].query).includes('"employerIndex":1'));
    assert.ok(String(requests[3].query).includes('"employerIndex":2'));
    assert.deepEqual(result.workCoverage?.map(item => item.outcome), ["evidence_found", "failed", "evidence_found"]);
    assert.deepEqual(result.researchReceipts?.map(item => item.requestId), ["request-1", "request-2", "request-4"]);
    assert.deepEqual(result.evidence.map(item => item.id), ["e-1", "e-2", "e-3"]);
    assert.match(result.evidence[2].claim, /Thirdco/);
  });
});

test("separate roles at the same company retain only role-specific supported findings", async () => {
  const employers = [employer, { ...employer, role: "Data Analyst", period: "2018–2022", status: "earlier" }];
  const first = "Alex Example designed evaluation methods while working as Research Engineer at Acme.";
  const second = "Alex Example built reporting tools while working as Data Analyst at Acme.";
  const response = (employerIndex: number, claim: string) => ({ content: { findings: [{ employerIndex, claim }], coverage: [{ employerIndex, outcome: "evidence_found", note: "Found work." }] },
    grounding: [{ field: "findings[0].claim", citations: [{ url: `https://example.com/work-${employerIndex}`, title: "Work" }] }] });
  await withResponses([
    { content: { ...profileContent, employers, evidence: [] }, grounding: profileGrounding }, response(0, first), response(1, second),
  ], async requests => {
    const result = await researchConfirmedCandidate({ input: "Alex Example, Acme" });
    assert.equal(requests.length, 3);
    assert.deepEqual(result.evidence.map(item => item.claim), [first, second]);
    assert.deepEqual(result.workCoverage?.map(item => item.evidenceCount), [1, 1]);
    assert.ok(result.workCoverage?.every(item => item.researched));
  });
});

test("uncited generated claims are omitted and excerpt context comes only from cited result pages", async () => {
  const claims = ["Alex Example built a public dataset.", "Alex Example supposedly owned company strategy."];
  await withResponses([{ content: { ...profileContent, employers: [], evidence: claims.map(claim => ({ claim })) }, grounding: [
    profileGrounding[0],
    { field: "evidence[0].claim", citations: [{ url: "https://example.com/dataset#details", title: "Dataset" }] },
  ], results: [
    { url: "https://example.com/dataset", title: "Dataset", text: "Alex Example built a public dataset with documented methods.", highlights: ["Dataset methods by Alex Example."] },
    { url: "https://example.com/unrelated", title: "Unrelated", text: "Do not attach this text to an unrelated citation." },
  ] }], async requests => {
    const result = await researchConfirmedCandidate({ input: "Alex Example" });
    assert.equal(requests.length, 1);
    assert.equal(result.evidence.length, 1);
    assert.deepEqual(result.evidence[0].sources.map(item => item.url), ["https://example.com/dataset#details"]);
    assert.equal(result.evidence[0].sourceExcerpts?.length, 1);
    assert.match(result.evidence[0].sourceExcerpts?.[0].text ?? "", /Dataset methods/);
    assert.ok(!JSON.stringify(result.evidence).includes("unrelated citation"));
    assert.equal(result.evidence[0].confirmed, false);
  });
});

test("retained page excerpts have an aggregate budget without dropping candidate claims", async () => {
  const evidence = Array.from({ length: 30 }, (_, i) => ({ claim: `Alex Example documented independent project ${i}.` }));
  await withResponses([{ content: { ...profileContent, employers: [], evidence },
    grounding: [profileGrounding[0], ...evidence.map((_, i) => ({ field: `evidence[${i}].claim`, citations: [{ url: "https://example.com/projects", title: "Projects" }] }))],
    results: [{ url: "https://example.com/projects", title: "Projects", text: "a".repeat(12_000) }],
  }], async () => {
    const result = await researchConfirmedCandidate({ input: "Alex Example" });
    assert.equal(result.evidence.length, 30);
    const excerptSizes = result.evidence.map(item => (item.sourceExcerpts ?? []).reduce((total, excerpt) => total + excerpt.text.length, 0));
    assert.ok(excerptSizes.every(size => size > 0));
    assert.ok(excerptSizes.reduce((total, size) => total + size, 0) <= 40_000);
  });
});

test("cancellation after automatic identity resolution aborts in-flight role research and does not start queued employers", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.EXA_API_KEY;
  const controller = new AbortController();
  let calls = 0;
  let active = 0;
  let maximumActive = 0;
  process.env.EXA_API_KEY = "test-placeholder";
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (calls === 1) return Response.json({ output: { content: resolvedIdentityResponse.content, grounding: resolvedIdentityResponse.grounding } });
    if (calls === 2) return Response.json({ output: { content: { ...profileContent, employers: [employer,
      { ...employer, company: "Second" }, { ...employer, company: "Third" }, { ...employer, company: "Fourth" }] }, grounding: profileGrounding } });
    active++;
    maximumActive = Math.max(maximumActive, active);
    if (calls === 4) queueMicrotask(() => controller.abort());
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => { active--; reject(new Error("Canceled")); }, { once: true }));
  };
  try {
    await assert.rejects(researchCandidate({ input: "Alex Example, Acme" }, { signal: controller.signal }), (error: unknown) => error instanceof Error && "code" in error && error.code === "CANCELED");
    assert.equal(calls, 4);
    assert.equal(maximumActive, 2);
    assert.equal(active, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = previousKey;
  }
});
