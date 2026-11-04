/** Selection controls should be useful immediately without implying a factual human review. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { initialWorkspace, type Workspace } from "../../src/frontend/browser/workspace.ts";
import type { Profile } from "../../src/shared/types.ts";

const require = createRequire(import.meta.url);
const sourceRoot = fileURLToPath(new URL("../../src", import.meta.url));
const modules = new Map<string, Record<string, unknown>>();
function loadSource(path: string): Record<string, unknown> {
  const absolute = resolve(sourceRoot, path);
  if (modules.has(absolute)) return modules.get(absolute)!;
  const compiled = ts.transpileModule(readFileSync(absolute, "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const loaded = { exports: {} as Record<string, unknown> };
  modules.set(absolute, loaded.exports);
  new Function("require", "module", "exports", compiled)((id: string) => {
    if (!id.startsWith("@/") && !id.startsWith(".")) return require(id);
    const base = id.startsWith("@/") ? resolve(sourceRoot, id.slice(2)) : resolve(dirname(absolute), id);
    const file = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
    if (!file) throw new Error(`Cannot load ${id}`);
    return loadSource(file);
  }, loaded, loaded.exports);
  return loaded.exports;
}
const sources = [{ url: "https://example.com/work", title: "Work" }];
const profile: Profile = {
  name: "Aditi Rao", summary: "Developer tools engineer", clarification: "", grounding: [],
  receipt: { stage: "candidate", type: "deep", requestId: "candidate", elapsedMs: 100, sourceCount: 1, retrievedAt: "2026-11-03" },
  employers: [{ company: "Example Tools", role: "Engineer", period: "2023–Present", status: "current", sources }],
  evidence: [{ id: "e-1", claim: "Built SDK tooling at Example Tools.", confirmed: true, sources, sourceExcerpts: [{ url: sources[0].url, text: "Original source text" }] }]
};
type Props = {
  workspace: Workspace; profile: Profile; busy: string | null; configured: boolean;
  heading: { current: null }; form: { clarification: string; excludedInput: string; editingEvidence: string | null };
  actions: Record<string, (...args: never[]) => void>;
};
const ProfileScreen = loadSource("frontend/features/candidate/profile-screen.tsx").ProfileScreen as (props: Props) => ReactElement;
function props(overrides: Partial<Props> = {}): Props {
  const noop = () => {};
  return {
    workspace: { ...initialWorkspace(), profile }, profile, busy: null, configured: true, heading: { current: null },
    form: { clarification: "", excludedInput: "", editingEvidence: null },
    actions: { research: noop, updateProfile: noop, updatePreferences: noop, updateEmployer: noop, findJobs: noop, setClarification: noop, setExcludedInput: noop, setEditingEvidence: noop },
    ...overrides
  };
}
function findElement(tree: unknown, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(tree)) return tree.map(child => findElement(child, predicate)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(tree)) return undefined;
  if (predicate(tree)) return tree;
  return findElement(tree.props.children, predicate);
}
function findButton(html: string) { return html.match(/<button class="primary-button full-width"[^>]*>/)?.[0] ?? ""; }

test("selected research and default preferences enable Find roles without a review checkbox", () => {
  const html = renderToStaticMarkup(createElement(ProfileScreen, props()));
  assert.match(html, /1 selected/);
  assert.match(html, /aria-label="Use contribution 1"[^>]*checked=""/);
  assert.match(html, /value="Open to suitable roles"/);
  assert.match(html, /value="Any location"/);
  assert.ok(findButton(html));
  assert.doesNotMatch(findButton(html), /disabled/);
  assert.doesNotMatch(html, /Profile reviewed|Review your profile to continue|Most recent former|value="last"/);
  assert.match(html, /Current \/ most recent/);
  assert.match(html, />Earlier<\/option>/);
});

test("empty selection, ambiguous roles, unresolved identity, and busy research still block Find roles", () => {
  const base = props();
  const cases: Partial<Props>[] = [
    { profile: { ...profile, evidence: profile.evidence.map(item => ({ ...item, confirmed: false })) } },
    { workspace: { ...base.workspace, preferences: { ...base.workspace.preferences, roles: "product" } } },
    { workspace: { ...base.workspace, identityPending: true } },
    { busy: "candidate" }
  ];
  for (const change of cases) assert.match(findButton(renderToStaticMarkup(createElement(ProfileScreen, props(change)))), /disabled/);
});

test("editing contribution text preserves its selection and removes outdated source attribution", () => {
  let changed: Partial<Profile> | undefined;
  const base = props();
  const tree = ProfileScreen(props({
    form: { ...base.form, editingEvidence: "e-1" },
    actions: { ...base.actions, updateProfile: (value: Partial<Profile>) => { changed = value; } }
  }));
  const textarea = findElement(tree, item => item.type === "textarea" && item.props["aria-label"] === "Contribution 1");
  assert.ok(textarea);
  (textarea.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "Built developer onboarding tooling." } });
  assert.equal(changed?.evidence?.[0].confirmed, true);
  assert.equal(changed?.evidence?.[0].claim, "Built developer onboarding tooling.");
  assert.equal(changed?.evidence?.[0].confidence, "user-provided");
  assert.deepEqual(changed?.evidence?.[0].sources, []);
  assert.deepEqual(changed?.evidence?.[0].sourceExcerpts, []);
});

test("deselection remains an immediate checkbox action", () => {
  let changed: Partial<Profile> | undefined;
  const base = props();
  const tree = ProfileScreen(props({ actions: { ...base.actions, updateProfile: (value: Partial<Profile>) => { changed = value; } } }));
  const checkbox = findElement(tree, item => item.type === "input" && item.props["aria-label"] === "Use contribution 1");
  assert.ok(checkbox);
  (checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: false } });
  assert.equal(changed?.evidence?.[0].confirmed, false);
  assert.equal(changed?.evidence?.[0].claim, profile.evidence[0].claim);
});
