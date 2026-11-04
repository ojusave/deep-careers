import test from "node:test";
import assert from "node:assert/strict";
import { qualificationSchema } from "../../../src/backend/features/jobs/schemas.ts";
import { qualifyOpportunities } from "../../../src/backend/features/jobs/qualify.ts";
import { AppError } from "../../../src/backend/errors.ts";
import type { Activity, Grounding, Opportunity, Preferences, Profile } from "../../../src/shared/types.ts";

const profile: Profile = {
  name: "Example Candidate", summary: "Unselected expert product strategist", clarification: "", employers: [],
  evidence: [
    { id: "e-1", claim: "Led customer discovery interviews to prioritize the team's web application roadmap.", confirmed: true, sources: [{ title: "Interview process", url: "https://example.com/discovery" }] },
    { id: "e-2", claim: "Owned delivery of the customer-facing web application from requirements to launch.", confirmed: true, sources: [{ title: "Launch", url: "https://example.com/launch" }] },
    { id: "e-3", claim: "Hosted API workshops and collaborated with product managers.", confirmed: true, sources: [] },
    { id: "e-4", claim: "Unselected degree", confirmed: false, sources: [] },
  ], receipt: { stage: "candidate", type: "deep", requestId: "candidate", elapsedMs: 1, sourceCount: 2, retrievedAt: "2026-11-03" }, grounding: [],
};
const preferences: Preferences = { roles: "Product management", location: "Remote", excludedEmployers: [] };
const job: Opportunity = { id: "job-1", company: "Example New", title: "Product Manager", location: "Remote", url: "https://careers.example.com/jobs/123", whyMatch: "Overconfident initial prose", evidenceIds: ["e-3"], requirements: [], gaps: [], status: "uncertain", sources: [] };
const core = [
  { requirement: "Lead customer discovery and prioritize the roadmap", importance: "core", evidenceIds: ["e-1"], support: "direct", reason: "Selected interviews inform roadmap prioritization." },
  { requirement: "Own delivery of customer-facing web applications", importance: "core", evidenceIds: ["e-2"], support: "direct", reason: "Selected ownership from requirements to launch." },
];
type Assessment = { jobId: string; postingUrl: string; postingStatus: string; criteria: Array<{ requirement: string; importance: string; evidenceIds: string[]; support: string; reason: string }> };
const qualified = (id = job.id, url = job.url): Assessment => ({ jobId: id, postingUrl: url, postingStatus: "open", criteria: core.map(item => ({ ...item })) });

// Test cases are grouped for readability; the provider response uses flat rows.
function flatCriteria(assessments: Assessment[]) {
  return assessments.flatMap(({ jobId, postingUrl, postingStatus, criteria }) => criteria.map(criterion => ({ jobId, postingUrl, postingStatus, requestMatch: "match", ...criterion })));
}
function rowGrounding(criteria: ReturnType<typeof flatCriteria>): Grounding[] {
  return criteria.flatMap((criterion, index) => [
    { field: `criteria[${index}].postingStatus`, citations: [{ url: criterion.postingUrl, title: "Primary job posting" }] },
    { field: `criteria[${index}].requirement`, citations: [{ url: criterion.postingUrl, title: "Primary job posting" }] },
  ]);
}
function grounding(assessments: Assessment[]): Grounding[] {
  return rowGrounding(flatCriteria(assessments));
}

async function mockDeep(assessments: Assessment[], work: (requests: Record<string, unknown>[]) => Promise<void>, fields: Grounding[] = grounding(assessments), providerRows = flatCriteria(assessments)) {
  const original = globalThis.fetch;
  const oldKey = process.env.EXA_API_KEY;
  const requests: Record<string, unknown>[] = [];
  process.env.EXA_API_KEY = "local-test-placeholder";
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.exa.ai/search");
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ requestId: "qualification-provider", results: [], costDollars: { total: 0.012 }, output: { content: { criteria: providerRows }, grounding: fields } });
  };
  try { await work(requests); }
  finally { globalThis.fetch = original; if (oldKey === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = oldKey; }
}

function properties(schema: unknown): number {
  if (schema === null || typeof schema !== "object") return 0;
  return Object.entries(schema).reduce((n, [key, value]) => n + (key === "properties" && value && typeof value === "object" ? Object.keys(value).length : 0) + properties(value), 0);
}

test("qualifies all candidates in one Deep call using full page context and a flat ten-property schema", async () => {
  assert.equal(properties(qualificationSchema), 10);
  const second = { ...job, id: "job-2", url: "https://careers.example.com/jobs/456" };
  await mockDeep([qualified(), qualified(second.id, second.url)], async requests => {
    const activities: Activity[] = [];
    const result = await qualifyOpportunities(profile, preferences, [job, second], { emit: activity => activities.push(activity) });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].type, "deep");
    assert.deepEqual(requests[0].contents, { highlights: true, text: { maxCharacters: 12_000 } });
    assert.doesNotMatch(String(requests[0].query), /Unselected|Overconfident/);
    assert.doesNotMatch(String(requests[0].query), /"confirmed"/);
    assert.match(String(requests[0].systemPrompt), /Selection controls inclusion, not factual verification/);
    assert.equal(result.jobs.length, 2);
    assert.equal(result.filteredCount, 0);
    assert.equal(result.receipt?.requestId, "qualification-provider");
    assert.ok(result.grounding.length > 0);
    assert.ok(activities.length > 0 && activities.every(item => item.id.startsWith("qualification:")));
    const accepted = result.jobs[0];
    assert.deepEqual(accepted.evidenceIds, ["e-1", "e-2"]);
    assert.deepEqual(accepted.assessment?.map(item => item.id), ["job-1-r1", "job-1-r2"]);
    assert.equal(accepted.assessment?.[0].sources[0].url, job.url);
    assert.equal(accepted.fitVersion, 2);
    assert.match(accepted.whyMatch, /^Evidence for: Lead customer discovery/);
    assert.doesNotMatch(accepted.whyMatch, /Overconfident|%/);
  });
});

test("interleaved criteria preserve per-job IDs and exact source paths without needing repeated status citations", async () => {
  const second = { ...job, id: "job-2", url: "https://careers.example.com/jobs/456" };
  const grouped = flatCriteria([qualified(), qualified(second.id, second.url)]);
  const rows = [grouped[0], grouped[2], grouped[1], grouped[3]];
  const fields = rowGrounding(rows).filter(field => !["criteria[2].postingStatus", "criteria[3].postingStatus"].includes(field.field));
  await mockDeep([], async requests => {
    const result = await qualifyOpportunities(profile, preferences, [job, second]);
    assert.equal(requests.length, 1);
    assert.deepEqual(result.jobs.map(item => item.id), [job.id, second.id]);
    for (const item of result.jobs) {
      assert.deepEqual(item.assessment?.map(criterion => criterion.id), [`${item.id}-r1`, `${item.id}-r2`]);
      assert.ok(item.assessment?.every(criterion => criterion.sources.every(source => source.url === item.url)));
      assert.deepEqual(item.assessment?.map(criterion => criterion.evidenceIds), [["e-1"], ["e-2"]]);
    }
  }, fields, rows);
  const misplaced = fields.map(field => field.field === "criteria[2].requirement"
    ? { ...field, citations: [{ url: second.url, title: "Another posting" }] } : field);
  await mockDeep([], async () => {
    const result = await qualifyOpportunities(profile, preferences, [job, second]);
    assert.deepEqual(result.jobs.map(item => item.id), [second.id]);
  }, misplaced, rows);
  const lostIdentity = rows.map((row, index) => index === 3 ? { ...row, jobId: "unknown-job" } : row);
  await mockDeep([], async () => {
    assert.deepEqual((await qualifyOpportunities(profile, preferences, [job, second])).jobs.map(item => item.id), [job.id]);
  }, fields, lostIdentity);
});

test("conflicting posting URLs or statuses within a flat job group withhold the entire job", async () => {
  for (const change of [{ postingUrl: "https://careers.example.com/jobs/other" }, { postingStatus: "closed" }, { postingStatus: "unavailable" }]) {
    const rows = flatCriteria([qualified()]).map((row, index) => index === 1 ? { ...row, ...change } : row);
    await mockDeep([], async () => {
      assert.equal((await qualifyOpportunities(profile, preferences, [job])).jobs.length, 0);
    }, rowGrounding(rows), rows);
  }
});

test("flat qualification groups still require two to twenty distinct criteria per job", async () => {
  for (const count of [0, 1, 21]) {
    const rows = Array.from({ length: count }, (_, index) => ({ ...flatCriteria([qualified()])[index % 2], requirement: `Distinct requirement ${index}` }));
    await mockDeep([], async () => {
      assert.equal((await qualifyOpportunities(profile, preferences, [job])).jobs.length, 0);
    }, rowGrounding(rows), rows);
  }
});

test("collaboration and workshops do not qualify a candidate for unsupported product ownership", async () => {
  const assessment = qualified();
  assessment.criteria = assessment.criteria.map(item => ({ ...item, evidenceIds: ["e-3"], support: "transferable", reason: "Related collaboration does not demonstrate ownership of this responsibility." }));
  await mockDeep([assessment], async () => {
    const result = await qualifyOpportunities(profile, preferences, [job]);
    assert.deepEqual(result.jobs, []);
    assert.equal(result.filteredCount, 1);
    assert.deepEqual(result.missingEvidence, core.map(item => item.requirement));
  });
});

test("unknown or transferable required qualifications remain explicit gaps on potential matches", async () => {
  for (const support of ["missing", "transferable"]) {
    const assessment = qualified();
    assessment.criteria.push({ requirement: "Required experience managing regulated healthcare products", importance: "required", evidenceIds: support === "missing" ? [] : ["e-2"], support, reason: "Healthcare product experience is not established." });
    await mockDeep([assessment], async () => {
      const result = await qualifyOpportunities(profile, preferences, [job]);
      assert.equal(result.jobs.length, 1);
      const gap = result.jobs[0].assessment?.at(-1);
      assert.equal(gap?.support, support);
      assert.deepEqual(gap?.evidenceIds, support === "missing" ? [] : ["e-2"]);
      assert.match(result.jobs[0].gaps[0], /Healthcare product experience is not established/);
      assert.match(result.missingEvidence[0], /regulated healthcare/);
    });
  }
});

test("two directly supported responsibilities can surface a potential opportunity with every unknown core gap visible", async () => {
  for (const missingCount of [1, 2, 3]) {
    const assessment = qualified();
    assessment.criteria.push(...Array.from({ length: missingCount }, (_, index) => ({
      requirement: `Distinct unsupported core responsibility ${index + 1}`,
      importance: "core", evidenceIds: [], support: "missing", reason: "No selected work establishes this responsibility.",
    })));
    await mockDeep([assessment], async () => {
      const result = await qualifyOpportunities(profile, preferences, [job]);
      assert.equal(result.jobs.length, 1);
      {
        assert.equal(result.jobs[0].assessment?.filter(item => item.support === "missing").length, missingCount);
        assert.equal(result.jobs[0].gaps.length, missingCount);
        assert.deepEqual(result.jobs[0].evidenceIds, ["e-1", "e-2"]);
      }
    });
  }
});

test("missing verdicts with known considered evidence preserve the gap without fabricating support", async () => {
  const assessment = qualified();
  assessment.criteria.push({ requirement: "Required TypeScript expertise", importance: "required", evidenceIds: ["e-1"], support: "missing", reason: "Selected work does not establish TypeScript expertise." });
  await mockDeep([assessment], async () => {
    const result = await qualifyOpportunities(profile, preferences, [job]);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].assessment?.at(-1)?.support, "missing");
    assert.deepEqual(result.jobs[0].assessment?.at(-1)?.evidenceIds, []);
    assert.match(result.jobs[0].gaps[0], /does not establish TypeScript/);
  });
  assessment.criteria.at(-1)!.evidenceIds = ["invented-evidence"];
  await mockDeep([assessment], async () => {
    assert.equal((await qualifyOpportunities(profile, preferences, [job])).jobs.length, 0);
  });
});

test("one directly evidenced core responsibility is insufficient even with mostly transferable work", async () => {
  const assessment = qualified();
  assessment.criteria[1] = { ...assessment.criteria[1], support: "transferable", reason: "Related work does not establish complete ownership." };
  await mockDeep([assessment], async () => {
    assert.equal((await qualifyOpportunities(profile, preferences, [job])).jobs.length, 0);
  });
});

test("optional gaps remain visible without rejecting an otherwise demonstrated fit", async () => {
  const assessment = qualified();
  assessment.criteria.push({ requirement: "Healthcare domain experience is preferred", importance: "preferred", evidenceIds: [], support: "missing", reason: "No selected healthcare experience." });
  await mockDeep([assessment], async () => {
    const result = await qualifyOpportunities(profile, preferences, [job]);
    assert.equal(result.jobs.length, 1);
    assert.match(result.jobs[0].gaps[0], /No selected healthcare/);
  });
});

test("closed, unavailable, aggregator and incompletely grounded postings are withheld", async () => {
  for (const assessment of [
    { ...qualified(), postingStatus: "closed" }, { ...qualified(), postingStatus: "unavailable" },
    { ...qualified(), postingUrl: "https://heyremote.io/jobs/example-product-manager" },
  ]) {
    await mockDeep([assessment], async () => assert.equal((await qualifyOpportunities(profile, preferences, [job])).jobs.length, 0));
  }
  for (const fields of [[], grounding([qualified()]).filter(item => !item.field.endsWith("postingStatus")), grounding([qualified()]).slice(0, 2), grounding([qualified()]).map(item => ({ ...item, citations: [{ title: "Company home", url: "https://careers.example.com/" }] }))]) {
    await mockDeep([qualified()], async () => assert.equal((await qualifyOpportunities(profile, preferences, [job])).jobs.length, 0), fields);
  }
});

test("missing or duplicate assessments and unknown evidence fail closed", async () => {
  const unknown = qualified();
  unknown.criteria[0] = { ...unknown.criteria[0], evidenceIds: ["made-up"] };
  const unselected = qualified();
  unselected.criteria[0] = { ...unselected.criteria[0], evidenceIds: ["e-4"] };
  const partial = qualified();
  partial.criteria[0] = { ...partial.criteria[0], reason: "" };
  for (const assessments of [[], [qualified(), qualified()], [unknown], [unselected], [partial]]) {
    await mockDeep(assessments, async () => {
      const result = await qualifyOpportunities(profile, preferences, [job]);
      assert.equal(result.jobs.length, 0);
      assert.equal(result.filteredCount, 1);
    });
  }
});

test("work arrangement preference is not evidence of residence or authorization and never resume evidence", async () => {
  const eligible = qualified();
  eligible.criteria.push({ requirement: "Remote work", importance: "required", evidenceIds: ["preference-location"], support: "direct", reason: "The candidate requests remote work." });
  await mockDeep([eligible], async () => {
    const result = await qualifyOpportunities(profile, preferences, [job]);
    assert.equal(result.jobs.length, 1);
    assert.deepEqual(result.jobs[0].evidenceIds, ["e-1", "e-2"]);
  });
  for (const requirement of ["US work authorization", "Remote work while based in the United States", "Residence in Canada", "Remote work with Pacific time-zone overlap"]) {
    const ineligible = { ...eligible, criteria: [...core, { ...eligible.criteria[2], requirement }] };
    await mockDeep([ineligible], async () => {
      const result = await qualifyOpportunities(profile, preferences, [job]);
      assert.equal(result.jobs.length, 1);
      assert.equal(result.jobs[0].assessment?.at(-1)?.support, "missing");
      assert.deepEqual(result.jobs[0].assessment?.at(-1)?.evidenceIds, []);
      assert.ok(result.jobs[0].gaps.some(gap => gap.startsWith(requirement)));
      assert.ok(result.missingEvidence.includes(requirement));
    });
  }
});

test("included employment can support required chronology without becoming resume work evidence", async () => {
  const withHistory: Profile = { ...profile, employers: [
    { company: "IncludedCo", role: "Product Manager", period: "2017–2023", status: "earlier", sources: [{ title: "Employment", url: "https://example.com/profile" }] },
  ] };
  const assessment = qualified();
  assessment.criteria.push({ requirement: "At least 3 years of experience as a Product Manager", importance: "required", evidenceIds: ["employment-0"], support: "direct", reason: "The included 2017–2023 Product Manager role provides the relevant chronology." });
  await mockDeep([assessment], async requests => {
    const result = await qualifyOpportunities(withHistory, preferences, [job], { employmentIncluded: true });
    assert.equal(result.jobs.length, 1);
    assert.match(String(requests[0].query), /IncludedCo/);
    assert.match(String(requests[0].query), /employment-0/);
    assert.match(String(requests[0].systemPrompt), /do not double-count overlapping roles/);
    assert.deepEqual(result.jobs[0].evidenceIds, ["e-1", "e-2"]);
    assert.deepEqual(result.jobs[0].assessment?.[2].evidenceIds, ["employment-0"]);
  });
  await mockDeep([assessment], async requests => {
    const result = await qualifyOpportunities(withHistory, preferences, [job]);
    assert.equal(result.jobs.length, 0);
    assert.doesNotMatch(String(requests[0].query), /IncludedCo|2017–2023|employment-0/);
    assert.match(String(requests[0].query), /INCLUDED EMPLOYMENT HISTORY: \[\]/);
  });
});

test("employment history never establishes a core ability or a mixed skill prerequisite", async () => {
  const withHistory: Profile = { ...profile, employers: [
    { company: "IncludedCo", role: "Senior Product Manager", period: "2017–2023", status: "earlier", sources: [{ title: "Employment", url: "https://example.com/profile" }] },
  ] };
  for (const evidenceIds of [["employment-0"], ["e-1", "employment-0"]]) {
    const assessment = qualified();
    assessment.criteria[0] = { ...assessment.criteria[0], evidenceIds };
    await mockDeep([assessment], async () => {
      const result = await qualifyOpportunities(withHistory, preferences, [job], { employmentIncluded: true });
      assert.equal(result.jobs.length, 0);
      assert.ok(result.missingEvidence.includes(core[0].requirement));
    });
  }
  for (const requirement of ["5 years building and shipping web applications", "Required API expertise", "Required healthcare certification"]) {
    const assessment = qualified();
    assessment.criteria.push({ requirement, importance: "required", evidenceIds: ["employment-0"], support: "direct", reason: "A title alone cannot establish this capability." });
    await mockDeep([assessment], async () => {
      const result = await qualifyOpportunities(withHistory, preferences, [job], { employmentIncluded: true });
      assert.equal(result.jobs.length, 1);
      assert.equal(result.jobs[0].assessment?.at(-1)?.support, "missing");
      assert.deepEqual(result.jobs[0].assessment?.at(-1)?.evidenceIds, []);
      assert.ok(result.jobs[0].gaps.some(gap => gap.startsWith(requirement)));
      assert.ok(result.missingEvidence.includes(requirement));
    });
  }
});

test("included title prerequisites are separate from skills and excluded history stays unavailable", async () => {
  const withHistory: Profile = { ...profile, employers: [
    { company: "IncludedCo", role: "Senior Product Manager", period: "2017–2023", status: "earlier", sources: [{ title: "Employment", url: "https://example.com/profile" }] },
  ] };
  const assessment = qualified();
  assessment.criteria.push({ requirement: "Previous role as a Senior Product Manager", importance: "required", evidenceIds: ["employment-0"], support: "direct", reason: "The supplied history includes this previous title." });
  await mockDeep([assessment], async () => {
    assert.equal((await qualifyOpportunities(withHistory, preferences, [job], { employmentIncluded: true })).jobs.length, 1);
  });
  await mockDeep([assessment], async () => {
    assert.equal((await qualifyOpportunities(withHistory, preferences, [job], { employmentIncluded: false })).jobs.length, 0);
  });
});

test("included history preserves original indices and provenance while excluding unsourced and uncertain rows", async () => {
  const source = { title: "Professional history", url: "https://example.com/person" };
  const withHistory: Profile = { ...profile, employers: [
    { company: "UnsupportedCo", role: "Product Manager", period: "2015–2017", status: "earlier", sources: [] },
    { company: "UncertainCo", role: "Product Manager", period: "2017–2019", status: "uncertain", sources: [source] },
    { company: "ResearchCo", role: "Product Manager", period: "2019–2023", status: "earlier", sources: [source] },
    { company: "UserCo", role: "Senior Product Manager", period: "2023–Present", status: "current", sources: [], userProvided: true },
  ] };
  const assessment = qualified();
  assessment.criteria.push({ requirement: "At least 3 years of experience as a Product Manager", importance: "required", evidenceIds: ["employment-2"], support: "direct", reason: "The included research supports this chronology." });
  await mockDeep([assessment], async requests => {
    const result = await qualifyOpportunities(withHistory, preferences, [job], { employmentIncluded: true });
    assert.equal(result.jobs.length, 1);
    const historyLine = String(requests[0].query).split("\n").find(line => line.startsWith("INCLUDED EMPLOYMENT HISTORY: "))!;
    const history = JSON.parse(historyLine.slice("INCLUDED EMPLOYMENT HISTORY: ".length));
    assert.deepEqual(history.map((item: { id: string }) => item.id), ["employment-2", "employment-3"]);
    assert.deepEqual(history.map((item: { provenance: string }) => item.provenance), ["public research", "user-provided"]);
    assert.deepEqual(history[0].sources, [source]);
    assert.deepEqual(result.jobs[0].assessment?.at(-1)?.evidenceIds, ["employment-2"]);
  });
  for (const evidenceId of ["employment-0", "employment-1"]) {
    const unsupported = { ...assessment, criteria: assessment.criteria.map((item, index) => index === 2 ? { ...item, evidenceIds: [evidenceId] } : item) };
    await mockDeep([unsupported], async () => {
      assert.equal((await qualifyOpportunities(withHistory, preferences, [job], { employmentIncluded: true })).jobs.length, 0);
    });
  }
});

test("primary posting URLs deduplicate tracking variants but preserve job-identifying query parameters", async () => {
  const jobs = [job, { ...job, id: "job-2" }, { ...job, id: "job-3" }];
  const assessments = [qualified(job.id, "https://careers.example.com/opening/?jobId=123&utm_source=feed"), qualified("job-2", "https://careers.example.com/opening?jobId=123"), qualified("job-3", "https://careers.example.com/opening?jobId=456")];
  await mockDeep(assessments, async () => {
    const result = await qualifyOpportunities(profile, preferences, jobs);
    assert.deepEqual(result.jobs.map(item => item.id), [job.id, "job-3"]);
    assert.equal(result.filteredCount, 1);
  });
});

test("no opportunities means no paid call; upstream failures never return unvetted candidates", async () => {
  await mockDeep([], async requests => {
    const result = await qualifyOpportunities(profile, preferences, []);
    assert.deepEqual(result, { jobs: [], filteredCount: 0, missingEvidence: [], grounding: [] });
    assert.equal(requests.length, 0);
  });
  const original = globalThis.fetch;
  const oldKey = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "local-test-placeholder";
  globalThis.fetch = async () => new Response("Unavailable", { status: 503 });
  try {
    const activities: Activity[] = [];
    await assert.rejects(qualifyOpportunities(profile, preferences, [job], { emit: activity => activities.push(activity) }), (error: unknown) => error instanceof AppError && error.code === "EXA_UNAVAILABLE");
    assert.ok(activities.some(item => item.id === "qualification:request" && item.state === "failed" && item.origin === "app"));
    assert.ok(!activities.some(item => item.state === "failed" && /completed/.test(item.label)));
  } finally { globalThis.fetch = original; if (oldKey === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = oldKey; }
});

test("every requirement row must carry the same explicit request match verdict", async () => {
  for (const verdicts of [["mismatch", "mismatch"], ["uncertain", "uncertain"], ["match", "mismatch"], ["match", "uncertain"], ["match", undefined], ["match", "yes"]]) {
    const rows = flatCriteria([qualified()]).map((row, index) => ({ ...row, requestMatch: verdicts[index] as string }));
    await mockDeep([], async () => {
      const result = await qualifyOpportunities(profile, { ...preferences, roles: "Product management at Anthropic" }, [job]);
      assert.equal(result.jobs.length, 0, JSON.stringify(verdicts));
    }, rowGrounding(rows), rows);
  }
});

test("Deep evaluates company, location, work mode and specialization in the original request", async () => {
  // These mocked judgments test enforcement, not the real model's search accuracy.
  for (const roles of ["DevRel at Anthropic", "remote product management in healthcare", "backend engineering in SF at Exa", "Anthropic", "DevRel at Anthropic or OpenAI", "roles at Smith & Jones, Inc.", "roles at AC/DC", "engineering roles at a product marketing company", "not sales", "prefer remote", "open to roles at Product Manager Inc."]) {
    const requested = { ...preferences, roles, location: "Any location" };
    await mockDeep([qualified()], async requests => {
      const result = await qualifyOpportunities(profile, requested, [job]);
      assert.equal(result.jobs.length, 1, roles);
      assert.equal(result.jobs[0].requestContext?.roles, roles);
      assert.equal(result.jobs[0].requestContext?.location, "Any location");
      assert.ok(String(requests[0].query).includes(JSON.stringify(roles)));
      assert.match(String(requests[0].systemPrompt), /soft preference alone must not reject/);
      assert.match(String(requests[0].systemPrompt), /explicit hard constraints conflict, return uncertain/);
    });
    const rows = flatCriteria([qualified()]).map(row => ({ ...row, requestMatch: "mismatch" }));
    await mockDeep([], async () => assert.equal((await qualifyOpportunities(profile, requested, [job])).jobs.length, 0, roles), rowGrounding(rows), rows);
  }
});
