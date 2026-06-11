// Regression tests for the update-checker's commit-type vocabulary
// (server/updateChecker.js → parseCommitLine / USER_FACING_COMMIT_RE).
//
// The property under test: `updateAvailable = shasDiffer && commits.length > 0`,
// where `commits` only keeps lines parseCommitLine accepts. A commit type
// missing from the regex therefore makes every kiosk in the 8-Pi fleet report
// "up to date" while the SHAs differ — a SILENT failure that has happened
// FIVE times (perf:, chore(deps):, release:, style:, polish/ux). These tests
// lock the accepted vocabulary, the rejection of internal-only types, and the
// exact shapes of the five historical regressions so the next edit to the
// regex can't quietly re-open one of them.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test } = require("../server/updateChecker");
const { parseCommitLine } = __test;

// --- Accepted vocabulary: every user-facing type, with and without scope ---

// Types whose token passes through unchanged (everything except chore(deps)).
const PLAIN_TYPES = ["feat", "fix", "perf", "style", "polish", "ux", "release"];

for (const type of PLAIN_TYPES) {
  test(`accepts \`${type}:\` without scope`, () => {
    const parsed = parseCommitLine(`${type}: do the thing`);
    assert.deepEqual(parsed, { type, message: "do the thing" });
  });

  test(`accepts \`${type}(scope):\` with scope`, () => {
    const parsed = parseCommitLine(`${type}(radar): do the thing`);
    assert.deepEqual(parsed, { type, message: "do the thing" });
  });
}

test("accepts `chore(deps):` and normalises the type to `deps`", () => {
  const parsed = parseCommitLine("chore(deps): bump axios from 1.7.0 to 1.8.0");
  assert.deepEqual(parsed, { type: "deps", message: "bump axios from 1.7.0 to 1.8.0" });
});

test("accepts `chore(deps)(scope):` — the grammar's scoped form of chore(deps)", () => {
  // The optional scope group sits AFTER the literal `chore(deps)` token, so
  // this is the (unusual) scoped shape the current grammar accepts. Locked
  // so a regex rewrite that changes the shape is a conscious decision.
  const parsed = parseCommitLine("chore(deps)(server): bump express");
  assert.deepEqual(parsed, { type: "deps", message: "bump express" });
});

test("leading whitespace after the colon is stripped from the message", () => {
  const parsed = parseCommitLine("feat:    spaced out message");
  assert.deepEqual(parsed, { type: "feat", message: "spaced out message" });
});

// --- Rejected vocabulary: internal-only conventional types ---

const INTERNAL_LINES = [
  "docs: update api.md for the new endpoint",
  "docs(readme): refresh screenshots",
  "chore: clean up dead code", // plain chore — only chore(deps) is user-facing
  "chore(ci): tweak workflow triggers", // scoped chore that is NOT (deps)
  "chore(deps-dev): bump eslint", // Dependabot dev-deps prefix ≠ chore(deps)
  "refactor: extract helper",
  "refactor(server): split controller",
  "test: add radar trend cases",
  "ci: pin node version",
];

for (const line of INTERNAL_LINES) {
  test(`rejects internal type: \`${line}\``, () => {
    assert.equal(parseCommitLine(line), null);
  });
}

// --- The five historical silent failures, as their real-world shapes ---
// Each of these once made the kiosk say "up to date" while SHAs differed.

test("regression 1 — `perf:` (radar prompt token compression)", () => {
  const parsed = parseCommitLine("perf(ai): compress radar prompt tokens");
  assert.deepEqual(parsed, { type: "perf", message: "compress radar prompt tokens" });
});

test("regression 2 — `chore(deps):` (2026-05-07 Dependabot batch, express 4 → 5)", () => {
  const parsed = parseCommitLine("chore(deps): bump express from 4.21.2 to 5.1.0");
  assert.equal(parsed.type, "deps");
  assert.equal(parsed.message, "bump express from 4.21.2 to 5.1.0");
});

test("regression 3 — `release:` (v2.14.0 promotion commit, 2026-05-13)", () => {
  const parsed = parseCommitLine(
    "release: v2.14.0 — promote v3 Ambient UI to default"
  );
  assert.equal(parsed.type, "release");
  assert.equal(parsed.message, "v2.14.0 — promote v3 Ambient UI to default");
});

test("regression 4 — `style:` (v2.15.7 → v2.15.9 layout pass, 2026-05-17)", () => {
  const parsed = parseCommitLine("style: right-align TimeBlock, left-pack tempRow");
  assert.equal(parsed.type, "style");
});

test("regression 5 — `polish(...)` / `ux(...)` (v2.16.x toast + debug commits)", () => {
  const polish = parseCommitLine("polish(toast): soften dock toast entrance");
  assert.deepEqual(polish, { type: "polish", message: "soften dock toast entrance" });
  const ux = parseCommitLine("ux(debug): group export buttons");
  assert.deepEqual(ux, { type: "ux", message: "group export buttons" });
});

// --- Merge commits and non-conventional lines ---

const NON_CONVENTIONAL_LINES = [
  "Merge pull request #216 from thicla01/dependabot/npm_and_yarn/axios-1.8.0",
  "Merge branch 'master' of github.com:thicla01/pi-weather-station",
  "Initial commit",
  "update readme",
  "v2.14.0", // bare version bump without a conventional prefix
];

for (const line of NON_CONVENTIONAL_LINES) {
  test(`rejects non-conventional line: \`${line}\``, () => {
    assert.equal(parseCommitLine(line), null);
  });
}

// --- Shape guards on the grammar itself ---

test("type match is case-sensitive (`Fix:` is rejected)", () => {
  assert.equal(parseCommitLine("Fix: capitalised type"), null);
});

test("type match is anchored — `feature:` and `fixup!` do not ride on feat/fix", () => {
  assert.equal(parseCommitLine("feature: prefix collision"), null);
  assert.equal(parseCommitLine("fixup! fix: squashme"), null);
});

test("a colon is required right after the type/scope (`feat something` is rejected)", () => {
  assert.equal(parseCommitLine("feat add thing without colon"), null);
  assert.equal(parseCommitLine("feat (scope): space before scope"), null);
});

test("an empty message after the colon is rejected", () => {
  assert.equal(parseCommitLine("feat:"), null);
});
