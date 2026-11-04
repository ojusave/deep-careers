import test from "node:test";
import assert from "node:assert/strict";
import { clarifyTargetRole, matchesTargetRole } from "../../src/shared/jobs/role-intent.ts";

test("ambiguous product requests ask for a function without silently choosing the candidate's past role", () => {
  for (const input of ["product", "PM", "Product roles", "Looking for a product role"]) {
    const clarification = clarifyTargetRole(input);
    assert.ok(clarification, input);
    assert.deepEqual(clarification.options, ["Product management", "Product marketing", "Product design", "Product engineering", "All product roles"]);
  }
  for (const input of ["Product management", "Product design", "All product roles", "Developer relations", "Any role"]) assert.equal(clarifyTargetRole(input), null, input);
});

test("product searches reject DevRel even when the title mentions product", () => {
  for (const title of ["Senior Developer Advocate", "Developer Advocate — Product Platform", "Developer Advocate, Product Management", "Head of Developer Relations"]) {
    assert.equal(matchesTargetRole(title, "product"), false, title);
    assert.equal(matchesTargetRole(title, "Product management"), false, title);
    assert.equal(matchesTargetRole(title, "Product manager"), false, title);
  }
});

test("product function aliases accept real managers/leads while keeping other product functions separate", () => {
  for (const title of ["Senior Product Manager", "Group Product Manager", "Technical Product Lead", "Head of Product", "Senior Manager, Product", "Senior Manager, Product Management", "Director, Product Management", "Director of Product Management", "Chief Product Officer"]) assert.equal(matchesTargetRole(title, "Product management"), true, title);
  for (const title of ["Product Marketing Manager", "Lead Product Designer", "Head of Product Engineering"]) assert.equal(matchesTargetRole(title, "Product management"), false, title);
  assert.equal(matchesTargetRole("Senior Product Marketing Manager", "Product marketing"), true);
  assert.equal(matchesTargetRole("Senior Product Marketing Manager", "Head of Product Marketing"), true);
  assert.equal(matchesTargetRole("Product Manager", "Head of Product Marketing"), false);
  assert.equal(matchesTargetRole("Staff Product Designer", "Product design"), true);
  assert.equal(matchesTargetRole("Product Engineer", "Product engineering"), true);
});

test("explicitly broad product scope covers product functions but not unrelated work", () => {
  for (const title of ["Product Manager", "Product Designer", "Product Marketing Manager", "Product Engineer", "Product Operations Analyst"]) assert.equal(matchesTargetRole(title, "All product roles"), true, title);
  assert.equal(matchesTargetRole("Developer Advocate", "All product roles"), false);
  assert.equal(matchesTargetRole("Sales Engineer", "All product roles"), false);
});

test("other common functions use synonyms and preserve explicit specializations", () => {
  assert.equal(matchesTargetRole("Developer Advocate", "Developer relations"), true);
  assert.equal(matchesTargetRole("Head of Developer Relations", "DevRel"), true);
  assert.equal(matchesTargetRole("Senior Data Scientist", "Data science"), true);
  assert.equal(matchesTargetRole("Data Analyst", "Data analysis"), true);
  assert.equal(matchesTargetRole("Enterprise Account Executive", "Sales"), true);
  assert.equal(matchesTargetRole("Senior Backend Engineer", "Backend engineering"), true);
  assert.equal(matchesTargetRole("Frontend Engineer", "Backend engineering"), false);
  assert.equal(matchesTargetRole("Data Scientist", "Data analysis"), false);
  assert.equal(matchesTargetRole("Developer Advocate", "Software engineering"), false);
});

test("multiple explicit alternatives are matched independently", () => {
  assert.equal(matchesTargetRole("Developer Advocate", "Product management or developer relations"), true);
  assert.equal(matchesTargetRole("Product Manager", "Product management, Developer relations"), true);
  assert.equal(matchesTargetRole("Software Engineer", "Product management / Software engineering"), true);
  assert.equal(matchesTargetRole("Sales Manager", "Product management or developer relations"), false);
});

test("unknown specific functions use meaningful words after removing seniority", () => {
  assert.equal(matchesTargetRole("Director of Strategic Partnerships", "Head of partnerships"), true);
  assert.equal(matchesTargetRole("Director of Strategic Partnerships", "Partnerships manager"), true);
  assert.equal(matchesTargetRole("Senior Regulatory Affairs Specialist", "Regulatory affairs"), true);
  assert.equal(matchesTargetRole("Developer Advocate", "Regulatory affairs"), false);
  assert.equal(matchesTargetRole("Sales Manager", "Senior"), false);
});

test("explicit open preferences allow all functions but specific open-to text keeps its constraint", () => {
  for (const request of ["Open to suitable roles", "Any role", "Open to roles that fit my confirmed experience", "No preference"]) assert.equal(matchesTargetRole("Marine Biologist", request), true, request);
  assert.equal(matchesTargetRole("Developer Advocate", "Open to product management"), false);
  assert.equal(matchesTargetRole("Product Manager", "Open to product management"), true);
  assert.equal(matchesTargetRole("", "Any role"), false);
  assert.equal(matchesTargetRole("Product Manager", ""), false);
});
