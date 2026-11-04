import test from "node:test";
import assert from "node:assert/strict";
import { buildDeepRequest, runDeep } from "../../../src/backend/providers/exa/deep.ts";
import type { DeepTask } from "../../../src/backend/providers/exa/deep.ts";
import type { Activity } from "../../../src/shared/types.ts";

const task: DeepTask = { stage: "candidate", query: "Research an established professional identity", systemPrompt: "Use public professional sources.", outputSchema: { type: "object", properties: { findings: { type: "string" } } } };

async function withResponse(response: () => Response, work: () => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.EXA_API_KEY;
  process.env.EXA_API_KEY = "test-placeholder";
  globalThis.fetch = async () => response();
  try { await work(); }
  finally { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY = previousKey; }
}

test("full-text context is opt-in while Deep and highlights remain enabled", () => {
  assert.deepEqual(buildDeepRequest(task).contents, { highlights: true });
  const request = buildDeepRequest({ ...task, fullText: true });
  assert.equal(request.type, "deep");
  assert.deepEqual(request.contents, { highlights: true, text: { maxCharacters: 12_000 } });
});

test("source context retains bounded safe page data without treating it as claim grounding", async () => {
  await withResponse(() => Response.json({ output: { content: { findings: "A finding" }, grounding: [] }, results: [
    { url: "https://example.com/work", title: "Work\u0000", text: `Text\u0000${"x".repeat(15_000)}`, highlights: ["First\u0007 context", 5, "y".repeat(3000)] },
    { url: "https://example.com/work", title: "Duplicate", text: "Duplicate should not replace the first page." },
    { url: "http://127.0.0.1/private", title: "Unsafe", text: "Not retained" },
    { url: "javascript:alert(1)", title: "Unsafe", text: "Not retained" },
  ] }), async () => {
    const activities: Activity[] = [];
    const result = await runDeep({ ...task, fullText: true }, { emit: activity => activities.push(activity) });
    assert.equal(result.sourcePages?.length, 1);
    assert.equal(result.sourcePages?.[0].text.length, 12_000);
    assert.equal(result.sourcePages?.[0].title, "Work");
    assert.equal(result.sourcePages?.[0].highlights[0], "First context");
    assert.equal(result.sourcePages?.[0].highlights[1].length, 2000);
    assert.equal(result.grounding.length, 0);
    assert.ok(activities.some(item => item.id === "request" && item.origin === "app"));
    assert.ok(activities.some(item => item.id === "synthesis" && item.origin === "exa" && item.eventType === "response"));
    assert.ok(activities.every(item => typeof item.at === "number"));
  });
});

test("streamed result pages survive until done with honest provider event metadata", async () => {
  const events = [
    { type: "results", results: [{ url: "https://example.com/work", title: "Work", text: "Actual returned page text", highlights: ["A returned highlight"] }] },
    { type: "text-delta", delta: "partial synthesized response" },
    { type: "grounding", grounding: [{ field: "findings", citations: [{ url: "https://example.com/work", title: "Work" }] }] },
    { type: "done", output: { content: { findings: "Finished" }, grounding: [] } },
  ];
  await withResponse(() => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } }), async () => {
    const activities: Activity[] = [];
    const result = await runDeep({ ...task, fullText: true }, { emit: activity => activities.push(activity) });
    assert.equal(result.sourcePages?.[0].text, "Actual returned page text");
    assert.deepEqual(result.grounding, []); // Final grounding remains authoritative.
    for (const type of ["results", "text-delta", "grounding", "done"]) assert.ok(activities.some(item => item.origin === "exa" && item.eventType === type));
    assert.ok(!activities.some(item => /thinking|planning|inspecting/i.test(item.label)));
  });
});
