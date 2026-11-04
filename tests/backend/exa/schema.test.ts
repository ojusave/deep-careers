import test from "node:test";
import assert from "node:assert/strict";
import { buildDeepRequest, runDeep, type DeepSchema, type DeepTask } from "../../../src/backend/providers/exa/deep.ts";
import { validateDeepOutputSchema } from "../../../src/backend/providers/exa/schema.ts";
import { AppError } from "../../../src/backend/errors.ts";
import { candidateSchema, identitySchema, workEvidenceSchema } from "../../../src/backend/features/candidate/schemas.ts";
import { opportunitiesSchema, qualificationSchema } from "../../../src/backend/features/jobs/schemas.ts";
import { draftReviewSchema, roleSchema } from "../../../src/backend/features/resume/schemas.ts";
import type { Activity } from "../../../src/shared/types.ts";

const string = { type: "string" };
const task = (outputSchema: DeepSchema): DeepTask => ({ stage: "candidate", query: "Example research", systemPrompt: "Use public sources.", outputSchema });
const companies = {
  type: "object", properties: {
    companies: { type: "array", items: { type: "object", properties: { name: string, round: string, amount: string } } }
  }
};

test("the documented funding example and text output are valid", () => {
  assert.doesNotThrow(() => validateDeepOutputSchema(companies));
  const text = { type: "text", description: "A grounded answer" };
  assert.equal(buildDeepRequest(task(text)).outputSchema, text);
});

test("property limits count fields inside array items and allow exactly ten", () => {
  const fields = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`field${index}`, string]));
  const ten = { type: "object", properties: { rows: { type: "array", items: { type: "object", properties: fields } } } };
  assert.doesNotThrow(() => validateDeepOutputSchema(ten));
  const eleven = { type: "object", properties: { ...ten.properties, extra: string } };
  assert.throws(() => buildDeepRequest(task(eleven)), (error: unknown) => error instanceof AppError
    && error.code === "INVALID_DEEP_SCHEMA" && /10 total properties/.test(error.message));
  // The docs also give three root fields + eight nested fields as an invalid 11.
  const nested = { type: "object", properties: { one: string, two: string, nested: { type: "object", properties: Object.fromEntries(Object.entries(fields).slice(0, 8)) } } };
  assert.throws(() => validateDeepOutputSchema(nested), /10 total properties/);
});

test("a second object level accepts primitive arrays but a third object level is rejected", () => {
  const valid = { type: "object", properties: { rows: { type: "array", items: { type: "object", properties: { tags: { type: "array", items: string } } } } } };
  assert.doesNotThrow(() => validateDeepOutputSchema(valid));
  for (const nested of [
    { type: "object", properties: { detail: string } },
    { type: "array", items: { type: "object", properties: { detail: string } } }
  ]) {
    const invalid = { type: "object", properties: { rows: { type: "array", items: { type: "object", properties: { nested } } } } };
    assert.throws(() => validateDeepOutputSchema(invalid), /exceeds 2 object levels/);
  }
});

test("every array requires items, including arrays inside item objects", () => {
  const invalid = { type: "object", properties: { rows: { type: "array", items: { type: "object", properties: { tags: { type: "array" } } } } } };
  assert.throws(() => validateDeepOutputSchema(invalid), /tags is an array without an items schema/);
  assert.throws(() => validateDeepOutputSchema({ type: "array", items: string }), /root type/);
});

test("all shipped Deep schemas satisfy the provider contract", () => {
  const schemas = { identitySchema, candidateSchema, workEvidenceSchema, opportunitiesSchema, qualificationSchema, roleSchema, draftReviewSchema };
  for (const [name, schema] of Object.entries(schemas)) {
    assert.doesNotThrow(() => buildDeepRequest(task(schema)), name);
  }
});

test("a local schema failure consumes no quota and emits no fictitious Exa request", async () => {
  const previousFetch = globalThis.fetch;
  const state = globalThis as typeof globalThis & { __deepCareersLimits?: { active: number; calls: number[] } };
  const previousLimits = state.__deepCareersLimits;
  const limits = { active: 3, calls: [Date.now()] };
  state.__deepCareersLimits = limits;
  let calls = 0;
  const events: Activity[] = [];
  globalThis.fetch = async () => { calls++; throw new Error("Invalid schema must not reach fetch"); };
  try {
    await assert.rejects(runDeep(task({ type: "object", properties: { rows: { type: "array" } } }), { emit: event => events.push(event) }),
      (error: unknown) => error instanceof AppError && error.code === "INVALID_DEEP_SCHEMA" && /No request was sent/.test(error.message));
    assert.equal(calls, 0);
    assert.deepEqual(events, []);
    assert.equal(state.__deepCareersLimits, limits);
    assert.equal(limits.active, 3);
    assert.equal(limits.calls.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    state.__deepCareersLimits = previousLimits;
  }
});
