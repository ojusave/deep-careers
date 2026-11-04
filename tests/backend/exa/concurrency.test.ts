import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { acquireDeepSlot, recordDeepAttempt } from "../../../src/backend/providers/exa/limits.ts";
import { retryDelayMs, waitForRetry } from "../../../src/backend/providers/exa/retry.ts";
import { runDeep } from "../../../src/backend/providers/exa/deep.ts";
import { researchCandidate } from "../../../src/backend/workflows/01-research-person.ts";
import type { Activity } from "../../../src/shared/types.ts";

const shared = globalThis as typeof globalThis & { __deepCareersLimits?: { active: number; calls: number[] } };
const task = { stage: "candidate" as const, query: "Test research", systemPrompt: "Return evidence", outputSchema: { type: "object" as const, properties: { answer: { type: "string" as const } } } };
const success = () => Response.json({ output: { content: { answer: "ok" }, grounding: [] } });

async function isolated(work: () => Promise<void> | void) {
  const fetch = globalThis.fetch, limits = shared.__deepCareersLimits, random = Math.random;
  const keys = ["EXA_API_KEY", "EXA_MAX_CONCURRENT_REQUESTS", "EXA_MAX_REQUESTS_PER_HOUR"];
  const environment = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  shared.__deepCareersLimits = { active: 0, calls: [] };
  process.env.EXA_API_KEY = "test-placeholder";
  Math.random = () => 0;
  delete process.env.EXA_MAX_CONCURRENT_REQUESTS;
  delete process.env.EXA_MAX_REQUESTS_PER_HOUR;
  try { await work(); }
  finally {
    globalThis.fetch = fetch; shared.__deepCareersLimits = limits; Math.random = random;
    for (const key of keys) { if (environment[key] === undefined) delete process.env[key]; else process.env[key] = environment[key]; }
  }
}

test("24 operations enter immediately; the 25th fails without a queue and release is idempotent", () => isolated(() => {
  const releases = Array.from({ length: 24 }, () => acquireDeepSlot());
  assert.equal(shared.__deepCareersLimits?.active, 24);
  assert.throws(acquireDeepSlot, { code: "RESEARCH_BUSY", status: 429 });
  assert.equal(shared.__deepCareersLimits?.calls.length, 0);
  releases[0](); releases[0]();
  assert.equal(shared.__deepCareersLimits?.active, 23);
  const next = acquireDeepSlot();
  for (const release of releases) release(); next();
  assert.equal(shared.__deepCareersLimits?.active, 0);
}));

test("limits are configurable, budget counts attempts, and old attempts expire", () => isolated(() => {
  process.env.EXA_MAX_CONCURRENT_REQUESTS = "2";
  process.env.EXA_MAX_REQUESTS_PER_HOUR = "3";
  const first = acquireDeepSlot(), second = acquireDeepSlot();
  assert.throws(acquireDeepSlot, { code: "RESEARCH_BUSY" });
  for (let i = 0; i < 3; i++) recordDeepAttempt();
  assert.throws(recordDeepAttempt, { code: "USAGE_LIMIT" });
  first(); second();
  shared.__deepCareersLimits!.calls = [Date.now() - 3_600_001];
  recordDeepAttempt();
  assert.equal(shared.__deepCareersLimits?.calls.length, 1);
  process.env.EXA_MAX_CONCURRENT_REQUESTS = "0";
  assert.throws(acquireDeepSlot, { code: "INVALID_EXA_LIMIT_CONFIGURATION" });
  assert.equal(shared.__deepCareersLimits?.active, 0);
}));

test("the default rolling budget permits 300 HTTP attempts and rejects the next", () => isolated(() => {
  for (let i = 0; i < 300; i++) recordDeepAttempt();
  assert.throws(recordDeepAttempt, { code: "USAGE_LIMIT" });
  assert.equal(shared.__deepCareersLimits?.calls.length, 300);
}));

test("Retry-After seconds/date are honored; absent or invalid headers use exponential jitter", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");
  assert.equal(retryDelayMs("3", 1, now, () => 0), 3001);
  assert.equal(retryDelayMs("3", 1, now, () => 0.5), 6001);
  assert.equal(retryDelayMs("Tue, 03 Nov 2026 12:00:04 GMT", 1, now, () => 0), 4001);
  assert.equal(retryDelayMs("Tue, 03 Nov 2026 12:00:04 GMT", 1, now, () => 0.5), 7001);
  assert.equal(retryDelayMs("Tue, 03 Nov 2026 11:00:00 GMT", 1, now, () => 0), 1);
  assert.equal(retryDelayMs(null, 1, now, () => 0), 2001);
  assert.equal(retryDelayMs("invalid", 1, now, () => 1), 8001);
  assert.equal(retryDelayMs("-1", 2, now, () => 0.5), 10001);
  assert.equal(retryDelayMs("2147483647", 2, now, () => 1), 2147483647);
});

test("a real 429 retries at most twice using one deadline and counts every HTTP attempt", () => isolated(async () => {
  let attempts = 0;
  const signals: AbortSignal[] = [], events: Activity[] = [];
  globalThis.fetch = async (_url, init) => {
    attempts++; signals.push(init!.signal!);
    return attempts < 3 ? new Response(null, { status: 429, headers: { "Retry-After": "0" } }) : success();
  };
  const result = await runDeep(task, { emit: event => events.push(event) });
  assert.equal(result.content.answer, "ok");
  assert.equal(attempts, 3);
  assert.equal(shared.__deepCareersLimits?.calls.length, 3);
  assert.equal(shared.__deepCareersLimits?.active, 0);
  assert.ok(signals.every(signal => signal === signals[0]), "Retries share the original timeout signal");
  const retries = events.filter(event => event.id === "rate-limit-retry" && event.origin === "app");
  assert.equal(retries.length, 2);
  assert.ok(retries.every(event => event.state === "complete" && event.label === "Exa rate limit received"));
  assert.ok(retries.every(event => /^Retrying in \d+s$/.test(event.detail ?? "")));
}));

test("a repeated 429 stops after three attempts and releases its slot", () => isolated(async () => {
  let attempts = 0;
  globalThis.fetch = async () => { attempts++; return new Response(null, { status: 429, headers: { "Retry-After": "0" } }); };
  await assert.rejects(runDeep(task), { code: "EXA_RATE_LIMIT" });
  assert.equal(attempts, 3);
  assert.equal(shared.__deepCareersLimits?.active, 0);
}));

test("the hourly budget can stop a retry without an extra fetch or leaked slot", () => isolated(async () => {
  process.env.EXA_MAX_REQUESTS_PER_HOUR = "1";
  let attempts = 0;
  globalThis.fetch = async () => { attempts++; return new Response(null, { status: 429, headers: { "Retry-After": "0" } }); };
  await assert.rejects(runDeep(task), { code: "USAGE_LIMIT" });
  assert.equal(attempts, 1);
  assert.equal(shared.__deepCareersLimits?.calls.length, 1);
  assert.equal(shared.__deepCareersLimits?.active, 0);
}));

test("an exhausted budget does not announce an Exa request or leak a slot", () => isolated(async () => {
  process.env.EXA_MAX_REQUESTS_PER_HOUR = "1"; recordDeepAttempt();
  const events: Activity[] = [];
  globalThis.fetch = async () => { throw Error("No HTTP request should start"); };
  await assert.rejects(runDeep(task, { emit: event => events.push(event) }), { code: "USAGE_LIMIT" });
  assert.ok(!events.some(event => event.id === "request" && event.state === "running"));
  assert.equal(shared.__deepCareersLimits?.active, 0);
}));

test("cancellation interrupts provider backoff and no retry starts", () => isolated(async () => {
  const controller = new AbortController(); let attempts = 0;
  globalThis.fetch = async () => { attempts++; return new Response(null, { status: 429, headers: { "Retry-After": "60" } }); };
  await assert.rejects(runDeep(task, { signal: controller.signal, emit: event => {
    if (event.id === "rate-limit-retry") setTimeout(() => controller.abort(), 5);
  } }), { code: "CANCELED" });
  assert.equal(attempts, 1);
  assert.equal(shared.__deepCareersLimits?.active, 0);
  const waitController = new AbortController();
  const wait = waitForRetry(60_000, waitController.signal);
  waitController.abort(); await assert.rejects(wait);
  assert.equal(getEventListeners(waitController.signal, "abort").length, 0);
  const completed = new AbortController(); await waitForRetry(0, completed.signal);
  assert.equal(getEventListeners(completed.signal, "abort").length, 0);
}));

test("the original 150-second deadline covers retry backoff and releases the slot", () => isolated(async () => {
  const timeout = AbortSignal.timeout;
  let attempts = 0, deadlines = 0;
  AbortSignal.timeout = milliseconds => { assert.equal(milliseconds, 150_000); deadlines++; return timeout(10); };
  globalThis.fetch = async () => { attempts++; return new Response(null, { status: 429, headers: { "Retry-After": "60" } }); };
  try {
    await assert.rejects(runDeep(task), { code: "EXA_TIMEOUT" });
    assert.equal(deadlines, 1); assert.equal(attempts, 1);
    assert.equal(shared.__deepCareersLimits?.active, 0);
  } finally { AbortSignal.timeout = timeout; }
}));

test("already canceled work and a throwing activity listener use no HTTP attempts or slots", () => isolated(async () => {
  let attempts = 0; globalThis.fetch = async () => { attempts++; return success(); };
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runDeep(task, { signal: controller.signal }), { code: "CANCELED" });
  await assert.rejects(runDeep(task, { emit: () => { throw new Error("Stream closed"); } }));
  assert.equal(attempts, 0);
  assert.equal(shared.__deepCareersLimits?.calls.length, 0);
  assert.equal(shared.__deepCareersLimits?.active, 0);
}));

test("other HTTP failures and incomplete streams are never retried", () => isolated(async () => {
  for (const status of [400, 401, 402, 403, 500, 503]) {
    let attempts = 0; globalThis.fetch = async () => { attempts++; return new Response(null, { status }); };
    await assert.rejects(runDeep(task)); assert.equal(attempts, 1);
  }
  let attempts = 0;
  globalThis.fetch = async () => { attempts++; return new Response('event: text-delta\ndata: {"text":"partial"}\n\n', { headers: { "Content-Type": "text/event-stream" } }); };
  await assert.rejects(runDeep(task, { emit: () => {} }));
  assert.equal(attempts, 1);
  assert.equal(shared.__deepCareersLimits?.active, 0);
}));

test("ten independent candidate workflows overlap twenty employment requests without mixing results", { timeout: 5000 }, () => isolated(async () => {
  let release = () => {}, allEntered = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { allEntered = resolve; });
  let active = 0, peak = 0, employmentCalls = 0, totalCalls = 0;
  globalThis.fetch = async (_url, init) => {
    totalCalls++;
    const body = JSON.parse(String(init?.body)), user = Number(/Person (\d+)/.exec(body.query)![1]);
    const name = `Person ${user}`, url = `https://example.com/person-${user}`;
    const sources = [{ title: name, url }], field = (key: string) => ({ field: key, citations: sources });
    const properties = body.outputSchema.properties;
    if (properties.resolution) return Response.json({ output: { content: { resolution: "resolved", question: "", candidates: [{ name, headline: "Engineer", employer: `Acme ${user}`, profileUrl: url, matchEvidence: `${name} is the requested engineer at Acme ${user}.` }] }, grounding: [field("candidates[0].name"), field("candidates[0].matchEvidence")] } });
    if (properties.employers) return Response.json({ output: { content: { name, summary: "Engineer", clarification: "", evidence: [], employers: [
      { company: `Acme ${user}`, role: "Engineer", period: "2024–Present", status: "current" },
      { company: `Otherco ${user}`, role: "Engineer", period: "2020–2024", status: "earlier" }
    ] }, grounding: [field("name"), field("employers[0].company"), field("employers[1].company")] } });
    const index = Number(/"employerIndex":(\d+)/.exec(body.query)![1]);
    const company = index ? `Otherco ${user}` : `Acme ${user}`;
    employmentCalls++; active++; peak = Math.max(peak, active);
    if (employmentCalls === 20) allEntered();
    await gate; active--;
    return Response.json({ requestId: `person-${user}-role-${index}`, output: { content: {
      findings: [{ employerIndex: index, claim: `${name} built data quality tooling at ${company}.` }],
      coverage: [{ employerIndex: index, outcome: "evidence_found", note: "Documented work" }]
    }, grounding: [field("findings[0].claim")] } });
  };
  const workflows = Array.from({ length: 10 }, (_, user) => researchCandidate({ input: `Person ${user}, Acme ${user}` }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([entered, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Twenty requests did not overlap")), 2000); })]);
    assert.equal(peak, 20); assert.equal(shared.__deepCareersLimits?.active, 20);
    release();
    const results = await Promise.all(workflows);
    results.forEach((profile, user) => {
      assert.ok(!("kind" in profile));
      assert.equal(profile.name, `Person ${user}`);
      assert.equal(profile.evidence.length, 2);
      assert.ok(profile.evidence.every(item => item.claim.startsWith(`Person ${user} `)));
      assert.ok(profile.workCoverage?.every(item => item.outcome === "evidence_found"));
      assert.equal(profile.researchWarnings?.length ?? 0, 0);
    });
    assert.equal(totalCalls, 40); assert.equal(employmentCalls, 20);
    assert.equal(shared.__deepCareersLimits?.calls.length, 40);
    assert.equal(shared.__deepCareersLimits?.active, 0);
  } finally { clearTimeout(timer); release(); await Promise.allSettled(workflows); }
}));
