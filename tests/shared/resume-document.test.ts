import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { buildResumeDocument, inferEmployerIndex, isEmploymentOnlyClaim, resumePlainText } from "../../src/shared/resume/document.ts";
import type { ResumeDocument } from "../../src/shared/resume/document.ts";
import type { Profile, RoleResult } from "../../src/shared/types.ts";

const receipt = { stage: "role" as const, type: "deep" as const, requestId: "test", elapsedMs: 1, sourceCount: 0, retrievedAt: "2026-11-03" };
const profile: Profile = {
  name: "Example Candidate", summary: "", clarification: "", receipt, grounding: [],
  employers: [
    { company: "Render", role: "Developer Relations", period: "2025–Present", status: "current", sources: [], userProvided: true },
    { company: "Zoom", role: "Developer Advocate", period: "2019–2025", status: "earlier", sources: [], userProvided: true },
  ],
  evidence: [
    { id: "bio", claim: "Example Candidate is currently a Developer Relations specialist at Render, starting December 2025.", confirmed: true, sources: [] },
    { id: "work", claim: "While working at Zoom, designed and hosted technical workshops on APIs and SDKs.", confirmed: true, sources: [] },
    { id: "independent", claim: "Published an independent guide to API authentication.", confirmed: true, sources: [] },
  ],
};
const role: RoleResult = {
  summary: "Developer advocate with experience delivering technical workshops and publishing API guides.",
  bullets: profile.evidence.map(item => ({ evidenceId: item.id, text: item.claim })),
  priorities: [], gaps: [], changes: [], sources: [], grounding: [], receipt,
};

test("a saved draft groups work under its evidenced employer without treating biography as an achievement", () => {
  const document = buildResumeDocument(profile, role, "candidate@example.com · https://www.linkedin.com/in/example-candidate");
  assert.equal(document.experience[0].bullets.length, 0);
  assert.equal(document.experience[1].bullets[0].evidenceId, "work");
  assert.equal(document.selectedWork.length, 1);
  assert.equal(document.selectedWork[0].evidenceId, "independent");
  assert.deepEqual(document.issues, []);
});

test("copy text includes actual summary and achievements, no placeholder labels or empty bullets", () => {
  const document = buildResumeDocument(profile, role, "candidate@example.com");
  const copy = resumePlainText(document);
  assert.ok(copy.includes(role.summary));
  assert.match(copy, /Zoom \| 2019–2025\nDeveloper Advocate\n• While working at Zoom, designed and hosted technical workshops/);
  assert.match(copy, /SELECTED PROJECTS & CONTRIBUTIONS\n• Published an independent guide/);
  const detailed = copy.split("PROFESSIONAL EXPERIENCE\n")[1].split("SELECTED PROJECTS")[0];
  assert.doesNotMatch(detailed, /Render/);
  assert.match(copy, /ADDITIONAL EXPERIENCE\nRender \| Developer Relations \| 2025–Present/);
  assert.doesNotMatch(copy, /is currently|Contact details for your resume/);
  assert.doesNotMatch(copy, /^\s*[•-]\s*$/m);
});

test("email, LinkedIn and sufficient work are required; an unsupported summary can be omitted", () => {
  const document = buildResumeDocument(profile, { ...role, summary: "", bullets: [{ evidenceId: "bio", text: profile.evidence[0].claim }, { evidenceId: "work", text: "  " }] });
  assert.equal(document.issues.length, 3);
  assert.equal(document.issues.some(issue => /summary/.test(issue)), false);
  assert.ok(document.issues.some(issue => /contact email/.test(issue)));
  assert.ok(document.issues.some(issue => /LinkedIn/.test(issue)));
  assert.ok(document.issues.some(issue => /two concrete/.test(issue)));
  const copy = resumePlainText(document);
  assert.doesNotMatch(copy, /PROFESSIONAL SUMMARY|PROFESSIONAL EXPERIENCE|SELECTED PROJECTS/);
  const withoutSummary = buildResumeDocument(profile, { ...role, summary: "" }, "candidate@example.com · https://www.linkedin.com/in/example-candidate");
  assert.deepEqual(withoutSummary.issues, []);
});

test("company mentions alone or ambiguous multi-company facts do not fabricate employment attribution", () => {
  assert.equal(inferEmployerIndex("Created a demo using Zoom APIs.", profile.employers), undefined);
  assert.equal(inferEmployerIndex("Created an independent guide using Zoom's APIs.", profile.employers), undefined);
  assert.equal(inferEmployerIndex("Created a demo with Zoom APIs.", profile.employers), undefined);
  assert.equal(inferEmployerIndex("Wrote an independent guide for Zoom APIs.", profile.employers), undefined);
  assert.equal(inferEmployerIndex("Built a workshop at Zoom with Render.", profile.employers), undefined);
  assert.equal(inferEmployerIndex("While working at Zoom, hosted workshops.", profile.employers), 1);
  assert.equal(inferEmployerIndex("Hosted workshops for Zoom using Zoom APIs.", profile.employers), 1);
  assert.equal(isEmploymentOnlyClaim(profile.evidence[0].claim, profile.name), true);
  assert.equal(isEmploymentOnlyClaim("Example Candidate was an advocate at Zoom, where they created API workshops.", profile.name), false);
});

test("multiple roles at one company require an explicit unique role or tenure anchor", () => {
  const employers: Profile["employers"] = [
    { company: "Acme", role: "Research Engineer", period: "2022–2025", status: "current", sources: [] },
    { company: "Acme", role: "Data Analyst", period: "2018–2022", status: "earlier", sources: [] },
  ];
  assert.equal(inferEmployerIndex("Designed evaluation methods at Acme.", employers), undefined);
  assert.equal(inferEmployerIndex("Designed evaluation methods while working as Research Engineer at Acme.", employers), 0);
  assert.equal(inferEmployerIndex("Ran workshops while working as Data Analyst at Acme.", employers), 1);
  assert.equal(inferEmployerIndex("Built reporting tools at Acme during 2018–2022.", employers), 1);
  assert.equal(inferEmployerIndex("Built reporting tools as Research Engineer at Acme during 2018–2022.", employers), undefined);
  assert.equal(inferEmployerIndex("Taught a Research Engineer workshop at Acme.", employers), undefined);
  assert.equal(inferEmployerIndex("Supported the Data Analyst team at Acme.", employers), undefined);
});

test("conference names and event venues cannot establish employment", () => {
  for (const claim of [
    "Led a workshop at RenderATL about workflows.",
    "Led a workshop at Render ATL about workflows.",
    "Spoke at Render during a community event.",
    "Hosted workshops at Zoom.",
    "Presented at Zoom's developer conference.",
    "Attended an event at Render.",
    "Wrote a guide for Render ATL.",
  ]) assert.equal(inferEmployerIndex(claim, profile.employers), undefined, claim);
  assert.equal(inferEmployerIndex("While working at Render, led a workshop at RenderATL.", profile.employers), 0);
  assert.equal(inferEmployerIndex("Developed onboarding tools at Render.", profile.employers), 0);
  const employers = [{ ...profile.employers[0], company: "Bright Labs" }];
  assert.equal(inferEmployerIndex("Built a demo at Bright Labs Summit.", employers), undefined);
  assert.equal(inferEmployerIndex("Built a demo for Bright Labs.", employers), 0);
  assert.equal(inferEmployerIndex("Built a demo for Bright & Labs, Inc.", [{ ...employers[0], company: "Bright & Labs, Inc." }]), 0);
});

test("uncertain, unsourced or content-free employment is not presented as compact history", () => {
  const document = buildResumeDocument({ ...profile, employers: [
    ...profile.employers,
    { company: "Unverified employer", role: "Engineer", period: "", status: "uncertain", sources: [] },
    { company: "Empty employer", role: "", period: "", status: "earlier", sources: [] },
    { company: "Unsourced employer", role: "Engineer", period: "2010–2012", status: "earlier", sources: [] },
  ] }, role, "candidate@example.com");
  assert.doesNotMatch(resumePlainText(document), /Unverified employer|Empty employer|Unsourced employer/);
  assert.ok(document.issues.some(issue => /employment marked uncertain/.test(issue)));
});

test("explicit editor grouping overrides legacy inference, while invalid indices stay unattached", () => {
  const grouped = buildResumeDocument(profile, { ...role, bullets: [{ ...role.bullets[2], employerIndex: 0 }] }, "candidate@example.com");
  assert.equal(grouped.experience[0].bullets[0].evidenceId, "independent");
  for (const employerIndex of [-1, 999, 0.5]) {
    const document = buildResumeDocument(profile, { ...role, bullets: [{ ...role.bullets[1], employerIndex }] }, "candidate@example.com");
    assert.equal(document.selectedWork.length, 1);
  }
});

test("deselecting evidence removes dependent content and flags the draft", () => {
  const document = buildResumeDocument({ ...profile, evidence: profile.evidence.map(item => ({ ...item, confirmed: false })) }, role, "candidate@example.com");
  assert.equal(document.selectedWork.length, 0);
  assert.ok(document.issues.some(issue => /selected evidence/.test(issue)));
});

test("resume preview contains selectable document text rather than form-only values", () => {
  // Compile the actual TSX component using the project's existing compiler.
  const source = readFileSync(new URL("../../src/frontend/features/resume/resume-preview.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} as { ResumeDocumentView: ComponentType<{ document: ResumeDocument }> } };
  new Function("require", "module", "exports", compiled)(createRequire(import.meta.url), module, module.exports);
  const document = buildResumeDocument(profile, role, "candidate@example.com");
  const html = renderToStaticMarkup(createElement(module.exports.ResumeDocumentView, { document }));
  assert.ok(html.includes(role.summary));
  assert.ok(html.includes(profile.evidence[1].claim));
  assert.ok(html.includes(profile.evidence[2].claim));
  assert.doesNotMatch(html, /<textarea|<input|print-only|Add email|<li[^>]*>\s*<\/li>/);
  const detailed = html.split("<h3>Professional experience</h3>")[1].split("</section>")[0];
  assert.ok(detailed.includes("Zoom"));
  assert.doesNotMatch(detailed, /Render/);
  assert.match(html, /<h3>Additional experience<\/h3><p><strong>Render<\/strong>/);
  const emptyWork = renderToStaticMarkup(createElement(module.exports.ResumeDocumentView, { document: buildResumeDocument(profile, { ...role, bullets: [] }) }));
  assert.doesNotMatch(emptyWork, /Professional experience|resume-employer-heading/);
  const missingSummary = renderToStaticMarkup(createElement(module.exports.ResumeDocumentView, { document: { ...document, summary: "" } }));
  assert.doesNotMatch(missingSummary, /Professional summary/);
});
