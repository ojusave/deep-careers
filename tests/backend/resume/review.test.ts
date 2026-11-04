import test from "node:test";
import assert from "node:assert/strict";
import { draftReviewSchema } from "../../../src/backend/features/resume/schemas.ts";
import { reviewResumeDraft } from "../../../src/backend/features/resume/review.ts";
import type { DraftReviewInput } from "../../../src/backend/features/resume/review.ts";
import type { Activity } from "../../../src/shared/types.ts";

const input: DraftReviewInput = {
  profile: {
    name: "Example Candidate", summary: "Unselected biography", clarification: "",
    employers: [{ company: "Example Labs", role: "Developer Advocate", period: "2023–2025", status: "earlier", sources: [{ title: "Employment", url: "https://example.com/profile" }] }],
    evidence: [
      { id: "e-1", claim: "Hosted developer workshops on APIs at Example Labs.", confirmed: true, sources: [{ title: "Workshops", url: "https://example.com/workshops" }] },
      { id: "e-2", claim: "Unselected ownership of the product roadmap.", confirmed: false, sources: [] },
    ],
    receipt: { stage: "candidate", type: "deep", requestId: "candidate", elapsedMs: 1, sourceCount: 1, retrievedAt: "2026-11-03" }, grounding: [],
  },
  job: { id: "job-1", company: "Next Labs", title: "Developer Advocate", location: "Remote", url: "https://example.com/jobs/1", whyMatch: "Teaching experience", evidenceIds: ["e-1"], requirements: ["Teach API workshops"], gaps: [], status: "open", sources: [] },
  summary: "Developer educator with experience teaching API workshops.",
  bullets: [{ evidenceId: "e-1", text: "Hosted developer workshops on APIs.", employerIndex: 0, requirementIds: ["r-1"] }],
  skills: ["APIs"],
  requirements: [{ id: "r-1", text: "Teach API workshops", importance: "core", support: "direct", evidenceIds: ["e-1"] }],
};

const accepted = (target: string) => ({ target, supported: true, relevant: true, employerSupported: true, reason: "Selected API teaching supports this requirement." });

async function mockDeep(content: unknown, work: (requests: Record<string, unknown>[]) => Promise<void>) {
  const original = globalThis.fetch;
  const oldKey = process.env.EXA_API_KEY;
  const requests: Record<string, unknown>[] = [];
  process.env.EXA_API_KEY = "local-test-placeholder";
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.exa.ai/search");
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ requestId: "draft-review-provider", results: [], costDollars: { total: 0.012 }, output: { content,
      grounding: [{ field: "checks[1].reason", citations: [{ title: "Workshops", url: "https://example.com/workshops" }] }] } });
  };
  try { await work(requests); }
  finally { globalThis.fetch = original; if (oldKey === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = oldKey; }
}

function properties(schema: unknown): number {
  if (schema === null || typeof schema !== "object") return 0;
  return Object.entries(schema).reduce((n, [key, value]) => n + (key === "properties" && value && typeof value === "object" ? Object.keys(value).length : 0) + properties(value), 0);
}

test("review uses Deep with a bounded schema, only selected evidence, real receipt and distinct activities", async () => {
  assert.equal(properties(draftReviewSchema), 6);
  await mockDeep({ checks: [accepted("summary"), accepted("bullet:0"), accepted("skill:0")] }, async requests => {
    const activities: Activity[] = [];
    const result = await reviewResumeDraft(input, { emit: item => activities.push(item) });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].type, "deep");
    assert.equal(requests[0].stream, true);
    assert.match(String(requests[0].systemPrompt), /collaboration inflated to ownership/);
    assert.match(String(requests[0].systemPrompt), /newly discovered candidate facts outside the selected evidence MUST NOT justify/);
    assert.match(String(requests[0].systemPrompt), /Selection controls inclusion, not factual verification/);
    assert.doesNotMatch(String(requests[0].query), /"confirmed"/);
    assert.doesNotMatch(String(requests[0].query), /Unselected/);
    assert.match(String(requests[0].query), /Teach API workshops/);
    assert.ok(result.checks.every(check => check.supported && check.relevant && check.employerSupported));
    assert.equal(result.receipt.requestId, "draft-review-provider");
    assert.equal(result.grounding[0].citations[0].url, "https://example.com/workshops");
    assert.ok(activities.length > 0 && activities.every(item => item.id.startsWith("draft-review:")));
  });
});

test("semantic rejection is retained even when the evidence ID and numbers are valid", async () => {
  const draft = { ...input, bullets: [{ ...input.bullets[0], text: "Hosted developer workshops, directly improving adoption." }] };
  await mockDeep({ checks: [accepted("summary"), { ...accepted("bullet:0"), supported: false, reason: "The source confirms workshops but no measured or causal improvement in adoption." }, accepted("skill:0")] }, async () => {
    const result = await reviewResumeDraft(draft);
    assert.equal(result.checks[1].supported, false);
    assert.equal(result.checks[1].relevant, true);
    assert.match(result.checks[1].reason, /no measured or causal/);
  });
});

test("employer review remains independent of a contribution's factual support", async () => {
  await mockDeep({ checks: [accepted("summary"), { ...accepted("bullet:0"), employerSupported: false, reason: "The evidence describes a conference, not work for this employer." }, accepted("skill:0")] }, async () => {
    const result = await reviewResumeDraft(input);
    assert.equal(result.checks[1].supported, true);
    assert.equal(result.checks[1].employerSupported, false);
  });
});

test("missing, duplicate, malformed and unexpected checks cannot approve draft claims", async () => {
  await mockDeep({ checks: [accepted("summary"), accepted("summary"), { ...accepted("bullet:0"), supported: "true" }, accepted("unknown")] }, async () => {
    const result = await reviewResumeDraft(input);
    assert.deepEqual(result.checks.map(check => check.target), ["summary", "bullet:0", "skill:0"]);
    assert.ok(result.checks.every(check => !check.supported && !check.relevant && !check.employerSupported));
  });
  await mockDeep({ checks: "invalid" }, async () => {
    assert.ok((await reviewResumeDraft(input)).checks.every(check => !check.supported));
  });
});

test("structural requirement links and selected evidence are enforced despite favorable model verdicts", async () => {
  await mockDeep({ checks: [accepted("summary"), accepted("bullet:0"), accepted("skill:0")] }, async () => {
    for (const requirementIds of [undefined, [], ["made-up"], ["r-1", "made-up"]]) {
      const result = await reviewResumeDraft({ ...input, bullets: [{ ...input.bullets[0], requirementIds }] });
      assert.equal(result.checks[1].relevant, false);
    }
    const missing = await reviewResumeDraft({ ...input, requirements: [{ ...input.requirements![0], support: "missing" }] });
    assert.equal(missing.checks[1].relevant, false);
    const mismatch = await reviewResumeDraft({ ...input, requirements: [{ ...input.requirements![0], evidenceIds: ["e-other"] }] });
    assert.equal(mismatch.checks[1].relevant, false);
    const unselected = await reviewResumeDraft({ ...input, bullets: [{ ...input.bullets[0], evidenceId: "e-2" }] });
    assert.equal(unselected.checks[1].supported, false);
    const noRequirements = await reviewResumeDraft({ ...input, requirements: undefined });
    assert.ok(noRequirements.checks.every(check => !check.relevant));
  });
});

test("an invalid employer index cannot pass an otherwise favorable review", async () => {
  await mockDeep({ checks: [accepted("summary"), accepted("bullet:0"), accepted("skill:0")] }, async () => {
    const result = await reviewResumeDraft({ ...input, bullets: [{ ...input.bullets[0], employerIndex: 7 }] });
    assert.equal(result.checks[1].employerSupported, false);
  });
});

test("unsupported or uncertain employer rows cannot pass attribution while user-provided history keeps its provenance", async () => {
  await mockDeep({ checks: [accepted("summary"), accepted("bullet:0"), accepted("skill:0")] }, async requests => {
    for (const employer of [
      { ...input.profile.employers[0], sources: [] },
      { ...input.profile.employers[0], status: "uncertain" as const },
    ]) {
      const result = await reviewResumeDraft({ ...input, profile: { ...input.profile, employers: [employer] } });
      assert.equal(result.checks[1].employerSupported, false);
      const payload = JSON.parse(String(requests.at(-1)?.query).split("REVIEW DATA: ")[1]);
      assert.deepEqual(payload.employment, []);
    }
    const result = await reviewResumeDraft({ ...input, profile: { ...input.profile, employers: [
      { ...input.profile.employers[0], sources: [], userProvided: true },
    ] } });
    assert.equal(result.checks[1].employerSupported, true);
    const payload = JSON.parse(String(requests.at(-1)?.query).split("REVIEW DATA: ")[1]);
    assert.equal(payload.employment[0].provenance, "user-provided");
  });
});
