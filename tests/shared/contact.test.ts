import test from "node:test";
import assert from "node:assert/strict";
import { contactIssues, formatResumeContact, parseResumeContact } from "../../src/shared/resume/contact.ts";

test("resume contact requires both email and a personal LinkedIn profile", () => {
  assert.equal(contactIssues("").length, 2);
  assert.match(contactIssues("candidate@example.com")[0], /LinkedIn/);
  assert.match(contactIssues("https://www.linkedin.com/in/example")[0], /email/);
  assert.deepEqual(contactIssues("candidate@example.com · https://www.linkedin.com/in/example"), []);
  assert.ok(contactIssues("candidate@example.com · https://www.linkedin.com/company/example").length);
  assert.ok(contactIssues("candidate@example.com · https://linkedin.com.evil.example/in/example").length);
});

test("legacy contact text preserves existing email, LinkedIn and optional details", () => {
  const input = "candidate@example.com · linkedin.com/in/example · London";
  assert.deepEqual(parseResumeContact(input), { email: "candidate@example.com", linkedin: "linkedin.com/in/example", other: "London" });
  assert.equal(formatResumeContact(parseResumeContact(input)), input);
  assert.equal(formatResumeContact({ email: " candidate@example.com ", linkedin: "", other: "" }), "candidate@example.com");
});
