import test from "node:test";
import assert from "node:assert/strict";
import { researchCandidate } from "../../../src/backend/workflows/01-research-person.ts";
import { identitySchema } from "../../../src/backend/features/candidate/schemas.ts";
import { createIdentityConfirmationToken, sameProfileUrl, verifyIdentityConfirmation, type ConfirmedIdentity } from "../../../src/backend/features/candidate/resolve-identity.ts";
import type { Activity, CandidateResearchResult, IdentityResolution } from "../../../src/shared/types.ts";

const chosen: ConfirmedIdentity = {
  id: "person-alex", name: "Alex Example", headline: "Engineer", employer: "Acme",
  profileUrl: "https://example.com/people/alex", sources: [{ url: "https://example.com/people/alex", title: "Alex at Acme" }]
};
const identityRow = { name: chosen.name, headline: chosen.headline, employer: chosen.employer, profileUrl: chosen.profileUrl,
  matchEvidence: "The Acme team profile identifies Alex Example as its engineer, matching the supplied name and employer." };
const lookupGrounding = [
  { field: "candidates[0].name", citations: chosen.sources },
  { field: "candidates[0].matchEvidence", citations: chosen.sources }
];
const nameGrounding = { field: "name", citations: chosen.sources };
const profileContent = {
  name: chosen.name, summary: "Research engineer.", clarification: "",
  employers: [{ company: "Acme", role: "Engineer", period: "2020–Present", status: "current" }], evidence: []
};
const profileGrounding = [nameGrounding, { field: "employers[0].company", citations: chosen.sources }];
type MockResult = { content: unknown; grounding?: unknown[] };

// Every fetch is intercepted. Unexpected extra research fails the test, rather
// than quietly paying for calls or allowing an enrichment loop to go unnoticed.
async function withResponses(results: MockResult[], work: (requests: Record<string, unknown>[]) => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.EXA_API_KEY;
  const requests: Record<string, unknown>[] = [];
  process.env.EXA_API_KEY = "test-placeholder";
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.exa.ai/search");
    requests.push(JSON.parse(String(init?.body)));
    const result = results[requests.length - 1];
    assert.ok(result, "An unresolved identity must never start career research");
    return Response.json({ requestId: `identity-test-${requests.length}`, results: [], costDollars: { total: 0.012 }, output: { content: result.content, grounding: result.grounding ?? [] } });
  };
  try { await work(requests); }
  finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = previousKey;
  }
}

function expectIdentity(result: CandidateResearchResult): IdentityResolution {
  assert.ok("kind" in result && result.kind === "identity", "The unresolved workflow must remain at identity clarification");
  assert.ok(!("employers" in result) && !("evidence" in result), "Career facts for an unresolved person cannot leak into the profile screen");
  return result;
}

test("identity schema stays within Deep's total property budget", () => {
  function count(value: unknown): number {
    if (!value || typeof value !== "object") return 0;
    return Object.entries(value).reduce((total, [key, child]) => total + (key === "properties" && child && typeof child === "object" ? Object.keys(child).length : 0) + count(child), 0);
  }
  assert.equal(count(identitySchema), 8);
});

test("Deep investigates bare and repeated names once per request and unresolved results never start career research", async () => {
  const inputs = ["Aditi", "Aditi Aditi", "Aditi\nAdditional information provided by user: Aditi", "Aditi\nyes", "I am Aditi"];
  await withResponses(inputs.map(() => ({ content: { resolution: "insufficient", question: "Which employer or professional profile identifies you?", candidates: [] } })), async requests => {
    for (const [index, input] of inputs.entries()) {
      const result = expectIdentity(await researchCandidate({ input }));
      assert.equal(result.query, input);
      assert.equal(result.candidates.length, 0);
      assert.equal(result.receipt?.requestId, `identity-test-${index + 1}`);
      assert.match(result.question, /employer|profile/);
      assert.equal(requests.length, index + 1, "A submitted answer is one Deep resolution task, not an app refinement loop");
      assert.ok(String(requests[index].query).includes(JSON.stringify(input)));
    }
    assert.ok(requests.every(request => request.type === "deep"));
  });
});

test("an invented confirmation flag or client-supplied person cannot bypass the gate", async () => {
  const unresolved = { content: { resolution: "ambiguous", question: "Which employer?", candidates: [] } };
  await withResponses([unresolved, unresolved], async requests => {
    for (const extra of [{ confirmed: true }, { selectedIdentity: chosen }, { selectionToken: "invented" }, { selectionToken: null }]) {
      expectIdentity(await researchCandidate({ input: "Aditi", ...extra }));
    }
    assert.equal(requests.length, 2, "Invented flags still use Deep; invalid signed selections stop without a call");
  });
});

test("no word-count or name-format heuristic rejects valid input before Deep research", async () => {
  const inputs = ["Aditi, Acme", "https://example.com/people/aditi", "李明", "Aditi, please find me"];
  await withResponses(inputs.map(() => ({ content: { resolution: "insufficient", question: "Which professional profile?", candidates: [] } })), async requests => {
    for (const input of inputs) expectIdentity(await researchCandidate({ input }));
    assert.equal(requests.length, inputs.length);
  });
});

test("one grounded but explicitly ambiguous result remains a confirmation choice", async () => {
  const input = "Alex Example, Acme";
  await withResponses([{ content: { resolution: "ambiguous", question: "Which profile is yours?", candidates: [identityRow] }, grounding: lookupGrounding }], async requests => {
    const activity: Activity[] = [];
    const result = expectIdentity(await researchCandidate({ input }, { emit: item => activity.push(item) }));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].type, "deep");
    assert.equal(result.candidates.length, 1);
    assert.equal(result.question, "Which profile is yours?");
    assert.equal(result.query, input);
    assert.equal(result.receipt?.requestId, "identity-test-1");
    assert.equal(verifyIdentityConfirmation(input, result.candidates[0].confirmationToken)?.profileUrl, chosen.profileUrl);
    assert.ok(activity.some(item => item.id === "identity:grounding" && item.origin === "exa"));
    assert.ok(activity.some(item => item.id === "identity:request" && item.scope === "Identity"));
    assert.ok(!activity.some(item => item.id.startsWith("work:")));
  });
});

test("namesakes remain separate source-backed choices", async () => {
  const candidates = [identityRow, { ...identityRow, employer: "Otherco", profileUrl: "https://example.org/team/alex" }];
  await withResponses([{ content: { resolution: "ambiguous", question: "Which employer did you work for?", candidates }, grounding: candidates.map((item, index) => ({ field: `/candidates/${index}/name`, citations: [{ title: item.employer, url: item.profileUrl }] })) }], async requests => {
    const result = expectIdentity(await researchCandidate({ input: "Alex Example" }));
    assert.equal(requests.length, 1);
    assert.equal(result.candidates.length, 2);
    assert.notEqual(result.candidates[0].id, result.candidates[1].id);
    assert.notEqual(result.candidates[0].confirmationToken, result.candidates[1].confirmationToken);
  });
});

test("uncited names, unrelated citations and company pages are not selectable identities", async () => {
  for (const variant of [
    { row: identityRow, grounding: [] },
    { row: identityRow, grounding: [{ field: "candidates[0].headline", citations: chosen.sources }] },
    { row: identityRow, grounding: [{ field: "candidates[0].name", citations: [{ title: "Different person", url: "https://example.com/people/other" }] }] },
    { row: { ...identityRow, profileUrl: "https://linkedin.com/company/acme" }, grounding: [{ field: "candidates[0].name", citations: [{ title: "Company", url: "https://linkedin.com/company/acme" }] }] },
    { row: { ...identityRow, profileUrl: "https://example.com/" }, grounding: [{ field: "candidates[0].name", citations: [{ title: "Company", url: "https://example.com/" }] }] }
  ]) {
    await withResponses([{ content: { resolution: "resolved", question: "", candidates: [variant.row] }, grounding: variant.grounding }], async requests => {
      const result = expectIdentity(await researchCandidate({ input: "Alex Example, Acme" }));
      assert.equal(result.candidates.length, 0);
      assert.equal(requests.length, 1);
    });
  }
});

test("deduplication never turns multiple original rows into an automatic identity match", async () => {
  const rows = [identityRow, { ...identityRow, profileUrl: `${chosen.profileUrl}/?utm_source=duplicate#bio` }];
  await withResponses([{ content: { resolution: "resolved", question: "", candidates: rows }, grounding: [...lookupGrounding, { field: "candidates[1].name", citations: chosen.sources }] }], async requests => {
    const result = expectIdentity(await researchCandidate({ input: "Alex Example, Acme" }));
    assert.equal(result.candidates.length, 1);
    assert.equal(requests.length, 1);
    assert.equal(sameProfileUrl("https://example.com/profile?id=1", "https://example.com/profile?id=2"), false);
  });
});

test("a grounded resolved identity continues into career research without a confirmation round trip", async () => {
  const input = "Alex Example, Acme";
  await withResponses([
    { content: { resolution: "resolved", question: "", candidates: [identityRow] }, grounding: lookupGrounding },
    { content: { ...profileContent, evidence: [{ claim: "Alex Example built evaluation tools while working at Acme." }] },
      grounding: [...profileGrounding, { field: "evidence[0].claim", citations: chosen.sources }] },
    { content: { findings: [], coverage: [{ employerIndex: 0, outcome: "no_public_detail", note: "No further public work descriptions." }] } }
  ], async requests => {
    const events: Activity[] = [];
    const result = await researchCandidate({ input }, { emit: event => events.push(event) });
    assert.ok(!("kind" in result), "A grounded resolved match should return the profile in the initial request");
    assert.equal(requests.length, 3);
    assert.equal(result.name, chosen.name);
    assert.equal(result.workCoverage?.[0].researched, true);
    assert.equal(result.evidence.length, 1);
    assert.ok(result.evidence.every(evidence => !evidence.confirmed), "Default inclusion belongs to the frontend; identity resolution is not factual verification");
    assert.ok(String(requests[1].query).includes(identityRow.matchEvidence));
    assert.match(String(requests[1].query), /"matchSources"/);
    assert.ok(!String(requests[1].query).includes("USER-CONFIRMED"));
    assert.deepEqual(result.researchReceipts?.map(receipt => receipt.requestId), ["identity-test-1", "identity-test-2", "identity-test-3"]);
    assert.ok(events.some(event => event.id === "identity:resolution" && event.origin === "app" && event.label === "Identity resolved"));
    assert.ok(events.some(event => event.id === "identity:grounding" && event.origin === "exa"));
  });
});

test("resolution is never inferred from one result, missing evidence or a malformed decision", async () => {
  const base = { resolution: "resolved", question: "", candidates: [identityRow] };
  const { resolution: _resolution, ...missingResolution } = base;
  const { question: _question, ...missingQuestion } = base;
  const { matchEvidence: _matchEvidence, ...missingMatchEvidence } = identityRow;
  const cases: MockResult[] = [
    { content: { ...base, resolution: "ambiguous" }, grounding: lookupGrounding },
    { content: { ...base, resolution: "insufficient" }, grounding: lookupGrounding },
    { content: missingResolution, grounding: lookupGrounding },
    { content: { ...base, resolution: "probably" }, grounding: lookupGrounding },
    { content: { ...base, resolution: true }, grounding: lookupGrounding },
    { content: missingQuestion, grounding: lookupGrounding },
    { content: { ...base, question: null }, grounding: lookupGrounding },
    { content: { ...base, question: "The employers conflict. Which company did you mean?" }, grounding: lookupGrounding },
    { content: { ...base, candidates: [missingMatchEvidence] }, grounding: lookupGrounding },
    { content: { ...base, candidates: [{ ...identityRow, matchEvidence: "  " }] }, grounding: lookupGrounding },
    { content: base, grounding: [lookupGrounding[0]] },
    { content: base, grounding: [lookupGrounding[0], { field: "candidates[0].matchEvidence", citations: [{ title: "Unrelated profile", url: "https://example.com/people/somebody-else" }] }] },
    { content: { ...base, candidates: [{ ...identityRow, employer: null }] }, grounding: lookupGrounding },
    { content: { ...base, candidates: [identityRow, { name: "Unsupported namesake" }] }, grounding: lookupGrounding },
    { content: { ...base, candidates: [identityRow, null, null, null] }, grounding: lookupGrounding },
    { content: { ...base, candidates: identityRow }, grounding: lookupGrounding }
  ];
  for (const response of cases) {
    await withResponses([response], async requests => {
      const result = expectIdentity(await researchCandidate({ input: "Alex Example, Acme" }));
      assert.equal(requests.length, 1, "An unsupported decision cannot initiate career research");
      assert.ok(result.question);
      assert.equal(result.receipt?.requestId, "identity-test-1");
      if (String((response.content as typeof base).question).includes("employers conflict")) assert.match(result.question, /employers conflict/);
    });
  }
});

test("cancellation after a resolved lookup prevents the next career request", async () => {
  const controller = new AbortController();
  await withResponses([{ content: { resolution: "resolved", question: "", candidates: [identityRow] }, grounding: lookupGrounding }], async requests => {
    await assert.rejects(researchCandidate({ input: "Alex Example, Acme" }, {
      signal: controller.signal,
      emit: event => { if (event.id === "identity:resolution") controller.abort(); }
    }), (error: unknown) => error instanceof Error && "code" in error && error.code === "CANCELED");
    assert.equal(requests.length, 1);
  });
});

test("confirmation tokens reject tampering, a changed query and expiration", async () => {
  const query = "Alex Example, Acme";
  const token = createIdentityConfirmationToken(query, chosen);
  const [encoded, signature] = token.split(".");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  payload.candidate.name = "Another Person";
  const changed = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
  const expired = createIdentityConfirmationToken(query, chosen, Date.now() - 16 * 60 * 1000);
  assert.equal(verifyIdentityConfirmation(query, changed), null);
  assert.equal(verifyIdentityConfirmation("Another Person", token), null);
  assert.equal(verifyIdentityConfirmation(query, expired), null);
  await withResponses([], async requests => {
    for (const body of [{ input: query, selectionToken: changed }, { input: "Another Person", selectionToken: token }, { input: query, selectionToken: expired }]) {
      expectIdentity(await researchCandidate(body));
    }
    assert.equal(requests.length, 0);
  });
});

test("the confirmed profile anchors career research and preserves every real receipt", async () => {
  const input = "Alex Example, Acme";
  await withResponses([
    { content: { resolution: "ambiguous", question: "Which profile is yours?", candidates: [identityRow] }, grounding: lookupGrounding },
    { content: profileContent, grounding: profileGrounding },
    { content: { findings: [], coverage: [{ employerIndex: 0, outcome: "no_public_detail", note: "No public work descriptions." }] } }
  ], async requests => {
    const lookup = expectIdentity(await researchCandidate({ input }));
    const result = await researchCandidate({ input, selectionToken: lookup.candidates[0].confirmationToken });
    assert.ok(!("kind" in result));
    assert.equal(result.name, chosen.name);
    assert.equal(result.employers.length, 1);
    assert.equal(result.workCoverage?.[0].researched, true);
    assert.equal(requests.length, 3);
    assert.match(String(requests[1].query), /RESOLVED IDENTITY ANCHOR/);
    assert.ok(String(requests[1].query).includes(chosen.profileUrl));
    assert.ok(String(requests[2].query).includes(chosen.profileUrl));
    assert.deepEqual(result.researchReceipts?.map(receipt => receipt.requestId), ["identity-test-1", "identity-test-2", "identity-test-3"]);
  });
});

test("a namesake substitution or missing selected-profile grounding stops employer research", async () => {
  for (const variant of [
    { content: { ...profileContent, name: "Another Person" }, grounding: profileGrounding },
    { content: profileContent, grounding: [{ field: "name", citations: [{ title: "Namesake", url: "https://example.com/people/other-alex" }] }, profileGrounding[1]] },
    { content: profileContent, grounding: [profileGrounding[1]] },
    { content: { ...profileContent, clarification: "Which employer profile is yours?" }, grounding: profileGrounding }
  ]) {
    await withResponses([variant], async requests => {
      const input = "Alex Example, Acme";
      const result = expectIdentity(await researchCandidate({ input, selectionToken: createIdentityConfirmationToken(input, chosen) }));
      assert.equal(result.candidates.length, 0);
      assert.equal(result.receipt?.requestId, "identity-test-1");
      assert.equal(requests.length, 1);
    });
  }
});
