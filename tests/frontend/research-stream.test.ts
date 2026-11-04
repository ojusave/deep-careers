import assert from "node:assert/strict";
import test from "node:test";
import { createEventParser, researchRequest, safeHref } from "../../src/frontend/browser/research-stream.ts";

test("SSE parser preserves events split at every character, CRLF, comments, and multiline data", () => {
  const received: unknown[] = [];
  const parser = createEventParser(event => received.push(event));
  const wire = ': heartbeat\r\n\r\nevent: activity\r\ndata: {"label":\r\ndata: "Sources received"}\r\n\r\nevent: complete\ndata: {"ok":true}';
  for (const char of wire) parser.push(char);
  parser.finish();
  assert.deepEqual(received, [
    { event: "activity", data: '{"label":\n"Sources received"}' },
    { event: "complete", data: '{"ok":true}' },
  ]);
});

function streamResponse(text: string) {
  const encoded = new TextEncoder().encode(text);
  return new Response(new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < encoded.length; offset += 3) controller.enqueue(encoded.slice(offset, offset + 3));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}

test("request delivers real activity and only resolves with complete result", async context => {
  const activity: unknown[] = [];
  const signal = new AbortController().signal;
  context.mock.method(globalThis, "fetch", async (_path: unknown, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get("accept"), "text/event-stream");
    assert.equal(init.signal, signal);
    return streamResponse('event: activity\ndata: {"id":"sources","label":"Sources received","state":"complete"}\n\nevent: complete\ndata: {"name":"Zoë"}\n\n');
  });
  const result = await researchRequest("/api/research", { input: "Zoë" }, signal, item => activity.push(item));
  assert.deepEqual(result, { name: "Zoë" });
  assert.equal(activity.length, 1);
});

test("a terminated stream or provider error never masquerades as a completed result", async context => {
  const fetch = context.mock.method(globalThis, "fetch", async () => streamResponse('event: activity\ndata: {"label":"Started"}\n\ndata: [DONE]\n\n'));
  await assert.rejects(researchRequest("/api/research", {}, new AbortController().signal, () => {}), /before a complete result/);
  fetch.mock.mockImplementation(async () => streamResponse('event: error\ndata: {"error":"Exa needs credits"}\n\n'));
  await assert.rejects(researchRequest("/api/research", {}, new AbortController().signal, () => {}), /Exa needs credits/);
});

test("JSON fallback and useful HTTP errors are supported", async context => {
  const fetch = context.mock.method(globalThis, "fetch", async () => Response.json({ name: "Candidate" }));
  assert.deepEqual(await researchRequest("/api/research", {}, new AbortController().signal, () => {}), { name: "Candidate" });
  fetch.mock.mockImplementation(async () => Response.json({ error: "Add identifying context" }, { status: 400 }));
  await assert.rejects(researchRequest("/api/research", {}, new AbortController().signal, () => {}), /Add identifying context/);
});

test("source links cannot execute scripts or load local files", () => {
  assert.equal(safeHref("javascript:alert(1)"), undefined);
  assert.equal(safeHref("file:///etc/passwd"), undefined);
  assert.equal(safeHref("data:text/html,test"), undefined);
  assert.equal(safeHref("https://example.com/work"), "https://example.com/work");
});
