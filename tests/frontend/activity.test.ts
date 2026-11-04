import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { safeHref } from "../../src/frontend/browser/research-stream.ts";
import type { Activity, Citation, Receipt } from "../../src/shared/types.ts";

type FeedProps = { events: Activity[]; busy: string | null; elapsed: number; onCancel: () => void };
type Components = {
  ActivityFeed: ComponentType<FeedProps>;
  Sources: ComponentType<{ sources: Citation[] }>;
  ResearchReceipt: ComponentType<{ receipt: Receipt }>;
};
const require = createRequire(import.meta.url);
// Render the actual components after the split; the test assertions stay the same.
const components: Partial<Components> = {};
for (const name of ["activity-feed", "sources", "research-receipt"]) {
  const source = readFileSync(new URL(`../../src/frontend/components/${name}.tsx`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)((id: string) => id === "@/frontend/browser/research-stream" ? { safeHref } : require(id), loaded, loaded.exports);
  Object.assign(components, loaded.exports);
}
const module = { exports: components as Components };

function render(events: Activity[], busy: string | null = "candidate") {
  return renderToStaticMarkup(createElement(module.exports.ActivityFeed, { events, busy, elapsed: 65, onCancel() {} }));
}
function summary(html: string) { return html.split("</summary>")[0]; }

test("activity distinguishes real provider events from application work and keeps technical details collapsed", () => {
  const html = render([
    { id: "coverage", label: "Checking work coverage", state: "running", origin: "app", scope: "candidate" },
    { id: "sources", label: "Source pages received", state: "complete", origin: "exa", eventType: "results", scope: "candidate", at: Date.UTC(2026, 10, 3, 12, 30, 5), detail: "Request req-123 returned 4 pages." },
  ]);
  assert.match(html, /title="Application workflow event">App</);
  assert.match(html, /title="Reported by Exa&#x27;s API">Exa</);
  assert.match(html, /<details class="activity-event-detail"><summary>Details<\/summary><p>Request req-123 returned 4 pages/);
  assert.match(html, /<dt>Event<\/dt><dd>results<\/dd>/);
  assert.match(html, /dateTime="2026-11-03T12:30:05.000Z">12:30:05 UTC/i);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:="")?/);
  assert.match(summary(html), /Checking work coverage/);
  assert.doesNotMatch(summary(html), /req-123|results|4 pages/);
});

test("the collapsed status shows at most two distinct live scopes and drops a finished provider request", () => {
  const html = render([
    { id: "old", label: "Old request", state: "running", origin: "exa", scope: "old" },
    { id: "old-done", label: "Old response received", state: "complete", origin: "exa", scope: "old", eventType: "done" },
    { id: "one", label: "Researching first employer", state: "running", origin: "app", scope: "first" },
    { id: "two", label: "Researching second employer", state: "running", origin: "app", scope: "second" },
    { id: "three", label: "Checking selected role", state: "running", origin: "app", scope: "role" },
  ]);
  assert.match(summary(html), /Checking selected role · Researching second employer/);
  assert.doesNotMatch(summary(html), /Old request|Researching first employer/);
  assert.match(html, /<button class="text-button">Stop<\/button>/);
});

test("a provider done event is not presented as completed application research", () => {
  const events: Activity[] = [{ id: "response", label: "Deep response received", state: "complete", origin: "exa", eventType: "done" }];
  assert.match(summary(render(events)), />Researching<\/span>/);
  assert.doesNotMatch(summary(render(events)), /Research complete|status-dot done/);
  assert.match(summary(render(events, null)), /Research interrupted/);
  const complete = render([...events, { id: "validation", label: "Findings checked", state: "complete", origin: "app" }], null);
  assert.match(summary(complete), /Research complete/);
  assert.match(summary(complete), /status-dot done/);
});

test("interrupted pending events retain an incomplete status", () => {
  const html = render([{ id: "pending", label: "Waiting for Exa", state: "running", origin: "app" }], null);
  assert.match(html, /aria-label="App: Waiting for Exa — Not completed"/);
  assert.match(html, /activity-symbol" aria-hidden="true">—<\/span>/);
  assert.doesNotMatch(html, /✓|>Stop<\/button>|Research complete/);
});

test("source links are safe, unique across the feed, and additional sources are collapsed", () => {
  const sources = Array.from({ length: 5 }, (_, index) => ({ url: `https://example.com/page-${index}`, title: `Source ${index}` }));
  const html = render([
    { id: "results", label: "Source pages received", state: "complete", origin: "exa", sources },
    { id: "grounding", label: "Field citations received", state: "complete", origin: "exa", sources: [...sources, { url: "javascript:alert(1)", title: "Unsafe" }] },
  ]);
  assert.equal((html.match(/href="https:\/\/example.com\/page-0"/g) || []).length, 1);
  assert.equal((html.match(/target="_blank"/g) || []).length, 5);
  assert.match(html, /<details class="activity-more-sources"><summary>\+2 sources<\/summary>/);
  assert.doesNotMatch(html, /javascript:|Unsafe/);
});

test("legacy events stay usable without invented origin or timestamps and existing research components still render", () => {
  const html = render([{ id: "legacy", label: "Legacy event", state: "running" }]);
  assert.match(html, /title="Event origin was not recorded">Activity</);
  assert.doesNotMatch(html, /<time|>Exa<\/span>|>App<\/span>/);
  assert.equal(render([], null), "");
  const citations = renderToStaticMarkup(createElement(module.exports.Sources, { sources: [{ url: "https://example.com/work", title: "Work" }] }));
  assert.match(citations, /1 source|href="https:\/\/example.com\/work"/);
  const receipt = renderToStaticMarkup(createElement(module.exports.ResearchReceipt, { receipt: { stage: "candidate", type: "deep", requestId: "req-123", elapsedMs: 1000, sourceCount: 2, retrievedAt: "2026-11-03" } }));
  assert.match(receipt, /Exa Deep/);
  assert.match(receipt, /req-123/);
});
