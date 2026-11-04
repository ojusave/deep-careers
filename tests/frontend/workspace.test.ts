/** Browser refresh starts a new workspace; legacy persisted data is only removed. */
import test from "node:test";
import assert from "node:assert/strict";
import { clearLegacyWorkspace, initialWorkspace } from "../../src/frontend/browser/workspace.ts";
const STORAGE_KEY = "next-move.workspace.v1";

test("every new workspace starts empty with independent preferences", () => {
  const current = initialWorkspace();
  current.input = "Aditi Rao";
  current.preferences.roles = "Engineering";
  current.preferences.excludedEmployers.push("Example Tools");
  current.contact = "aditi@example.com";
  current.identityPending = true;
  current.resumeReviewed = true;

  const fresh = initialWorkspace();
  assert.deepEqual(fresh, {
    version: 1, input: "", profile: null,
    preferences: { roles: "Open to suitable roles", location: "Any location", excludedEmployers: [] },
    opportunities: null, selectedJobId: null, role: null, contact: "",
    resumeReviewed: false, identity: null, identityPending: false
  });
});

test("legacy cleanup removes only this app's workspace and migration backup", () => {
  const values = new Map([
    [STORAGE_KEY, "old workspace"],
    [`${STORAGE_KEY}.before-fit-review`, "old backup"],
    ["another-app.preferences", "keep this"]
  ]);
  const removed: string[] = [];
  clearLegacyWorkspace({ removeItem(key) {
    removed.push(key);
    values.delete(key);
  } });
  assert.deepEqual(removed.sort(), [STORAGE_KEY, `${STORAGE_KEY}.before-fit-review`].sort());
  assert.deepEqual([...values], [["another-app.preferences", "keep this"]]);
});
