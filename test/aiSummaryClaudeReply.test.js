// Regression tests for the Claude request / reply handling of the AI
// summary (Haiku 5.5 migration, 2026-10).
//
// Haiku 5.5 changed what a reply looks like and which requests it accepts:
//   - adaptive thinking is on by default, so a reply can OPEN with
//     `thinking` blocks (empty text + signature): `content[0].text` is no
//     longer the answer;
//   - thinking counts toward max_tokens, so a reply can stop at
//     `max_tokens` after a thinking block with no text at all;
//   - a safety classifier can decline with HTTP 200 +
//     `stop_reason: "refusal"`, sometimes after partial text;
//   - a non-default `temperature` / `top_p`, any `top_k`, a trailing
//     assistant prefill and a `fallbacks` model list each return a 400.
//
// What we lock down here, with no network and no SDK mock:
//   1. classifyClaudeReply: reads text blocks by type, never throws, and
//      maps every reply shape to ok / truncated / empty / refusal. The
//      handler only caches "ok" (full TTL) and "truncated" (short TTL).
//   2. buildClaudeRequest: the request shape stays 400-safe on Haiku 5.5.
//   3. The radar label contract: every server label and calm template
//      matches the RADAR_PREFIX regex AiView uses to split the reply. The
//      regex is read from the client source (ESM, can't be required), so a
//      client edit can't drift silently.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { __test: ai } = require("../server/aiSummaryCtrl");
const {
  buildClaudeRequest,
  classifyClaudeReply,
  formatUsage,
  describeClaudeError,
  CLAUDE_MODEL,
  CLAUDE_EFFORT,
  MAX_TOKENS_RADAR,
  MAX_TOKENS_NO_RADAR,
  TRUNCATED_SUMMARY_TTL,
  SUMMARY_CACHE_TTL,
  RADAR_PARAGRAPH_LABEL_BY_LANG,
  CALM_RADAR_BY_LANG,
} = ai;

const THINK = { type: "thinking", thinking: "", signature: "sig" };
const REDACTED = { type: "redacted_thinking", data: "opaque" };
const T = (text) => ({ type: "text", text });
const reply = (content, stop_reason = "end_turn", extra = {}) => ({ content, stop_reason, ...extra });

// ── 1. classifyClaudeReply ────────────────────────────────────────────────

test("plain text reply → ok, trimmed", () => {
  const r = classifyClaudeReply(reply([T("  P1\n\nP2  ")]));
  assert.deepEqual(r, { outcome: "ok", text: "P1\n\nP2", stopReason: "end_turn", category: null });
});

test("thinking block first → text still found (the content[0].text crash)", () => {
  const r = classifyClaudeReply(reply([THINK, T("P1\n\nP2")]));
  assert.equal(r.outcome, "ok");
  assert.equal(r.text, "P1\n\nP2");
});

test("redacted_thinking blocks are skipped", () => {
  const r = classifyClaudeReply(reply([REDACTED, THINK, T("Hello")]));
  assert.equal(r.text, "Hello");
});

test("several text blocks are joined in order with no separator", () => {
  const r = classifyClaudeReply(reply([T("Sunny. "), THINK, T("Mild.")]));
  assert.equal(r.text, "Sunny. Mild.");
});

test("max_tokens hit during thinking (no text block) → empty, not cacheable", () => {
  const r = classifyClaudeReply(reply([THINK], "max_tokens"));
  assert.equal(r.outcome, "empty");
  assert.equal(r.text, "");
  assert.equal(r.stopReason, "max_tokens");
});

test("max_tokens with partial text → truncated, text kept", () => {
  const r = classifyClaudeReply(reply([THINK, T("Analyse radar : averses attendue dans les 1")], "max_tokens"));
  assert.equal(r.outcome, "truncated");
  assert.match(r.text, /dans les 1$/);
});

test("model_context_window_exceeded with text → truncated", () => {
  assert.equal(classifyClaudeReply(reply([T("x")], "model_context_window_exceeded")).outcome, "truncated");
});

test("whitespace-only text → empty", () => {
  assert.equal(classifyClaudeReply(reply([T(" \n\n ")])).outcome, "empty");
});

test("refusal before any output (empty content) → refusal with category", () => {
  const r = classifyClaudeReply(reply([], "refusal", {
    stop_details: { type: "refusal", category: "general_harms", explanation: null },
  }));
  assert.deepEqual(r, { outcome: "refusal", text: "", stopReason: "refusal", category: "general_harms" });
});

test("refusal after partial text → refusal, partial text discarded", () => {
  const r = classifyClaudeReply(reply([T("Current conditions are")], "refusal", {
    stop_details: { type: "refusal", category: "cyber", explanation: null },
  }));
  assert.equal(r.outcome, "refusal");
  assert.equal(r.text, "", "partial output of a declined request must never be served");
});

test("refusal with null stop_details / null or unlisted category → still a refusal", () => {
  assert.equal(classifyClaudeReply(reply([], "refusal", { stop_details: null })).category, null);
  assert.equal(classifyClaudeReply(reply([], "refusal", { stop_details: { category: null } })).category, null);
  assert.equal(
    classifyClaudeReply(reply([], "refusal", { stop_details: { category: "reasoning_extraction" } })).category,
    "reasoning_extraction"
  );
});

test("malformed replies never throw", () => {
  for (const m of [undefined, null, {}, { content: null }, { content: "x" }, { content: [null, 5, {}] },
    { content: [{ type: "text" }] }, { content: [{ type: "text", text: 42 }] }]) {
    assert.doesNotThrow(() => classifyClaudeReply(m));
    assert.equal(classifyClaudeReply(m).outcome, "empty");
  }
});

test("truncated replies get a TTL shorter than the client's poll window", () => {
  assert.ok(TRUNCATED_SUMMARY_TTL > 0);
  assert.ok(TRUNCATED_SUMMARY_TTL < SUMMARY_CACHE_TTL);
});

// ── formatUsage / describeClaudeError ─────────────────────────────────────

test("formatUsage splits out thinking tokens and tolerates missing fields", () => {
  assert.equal(
    formatUsage({ input_tokens: 1650, output_tokens: 310, output_tokens_details: { thinking_tokens: 120 } }),
    "in=1650 out=310 think=120"
  );
  assert.equal(formatUsage({ input_tokens: 10, output_tokens: 5, output_tokens_details: null }), "in=10 out=5 think=?");
  assert.equal(formatUsage(undefined), "in=? out=? think=?");
});

test("describeClaudeError prefers the nested API reason over the JSON-wrapped message", () => {
  const body = { type: "error", error: { type: "invalid_request_error", message: "temperature: only the default value 1 is supported for this model" } };
  const err = Object.assign(new Error(`400 ${JSON.stringify(body)}`), { status: 400, error: body });
  assert.equal(describeClaudeError(err), `400 ${body.error.message}`);
  assert.equal(describeClaudeError(new TypeError("boom")), "boom");
  assert.equal(describeClaudeError(undefined), "AI summary failed");
  assert.ok(describeClaudeError(Object.assign(new Error("x"), { status: 500, error: { error: { message: "y".repeat(500) } } })).length <= 160);
});

// ── 2. buildClaudeRequest: 400-safe on Haiku 5.5 ──────────────────────────

const VALID_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

for (const hasRadar of [true, false]) {
  test(`request shape stays 400-safe on Haiku 5.5 (hasRadar=${hasRadar})`, () => {
    const req = buildClaudeRequest("Write a weather summary.", hasRadar);
    assert.equal(req.model, "claude-haiku-5-5");
    assert.equal(req.model, CLAUDE_MODEL);
    for (const banned of ["temperature", "top_p", "top_k", "fallbacks", "stop_sequences"]) {
      assert.ok(!(banned in req), `${banned} must not be sent`);
    }
    // Thinking: adaptive (or omitted). Manual budgets are a 400.
    if (req.thinking) {
      assert.ok(["adaptive", "disabled"].includes(req.thinking.type), "no {type:'enabled', budget_tokens}");
      assert.ok(!("budget_tokens" in req.thinking));
    }
    const effort = req.output_config?.effort;
    assert.ok(VALID_EFFORTS.has(effort));
    assert.equal(effort, CLAUDE_EFFORT);
    if (req.thinking?.type === "disabled") {
      assert.ok(["low", "medium", "high"].includes(effort), "disabled thinking 400s at xhigh/max");
    }
    // No assistant prefill: the last turn is the user's.
    assert.equal(req.messages.at(-1).role, "user");
    assert.equal(req.max_tokens, hasRadar ? MAX_TOKENS_RADAR : MAX_TOKENS_NO_RADAR);
  });
}

test("token caps leave room for thinking and stay modest (dollar bound of the call ceiling)", () => {
  // 4.5-era caps were 400 / 150 for text alone; 5.5 counts ~30% more
  // tokens and thinking shares the budget.
  assert.ok(MAX_TOKENS_RADAR >= 1024 && MAX_TOKENS_RADAR <= 4096);
  assert.ok(MAX_TOKENS_NO_RADAR >= 512 && MAX_TOKENS_NO_RADAR <= MAX_TOKENS_RADAR);
});

test("controller never reads the reply by position", () => {
  const src = fs.readFileSync(path.join(__dirname, "../server/aiSummaryCtrl.js"), "utf8");
  assert.ok(!/\.content\[0\]/.test(src), "read content blocks by type (classifyClaudeReply)");
});

// ── 3. Radar label contract with the client parser ────────────────────────

const aiViewSrc = fs.readFileSync(
  path.join(__dirname, "../client/src/components/ambient/AiView/index.js"),
  "utf8"
);
const literal = aiViewSrc.match(/const RADAR_PREFIX = \/(.+)\/([a-z]*);/);

test("AiView still declares RADAR_PREFIX as a regex literal", () => {
  assert.ok(literal, "update this test if AiView changes how it detects the radar paragraph");
});

test("every server radar label and calm template matches AiView's RADAR_PREFIX", () => {
  const RADAR_PREFIX = new RegExp(literal[1], literal[2]);
  for (const lang of ["en", "fr", "es"]) {
    const label = RADAR_PARAGRAPH_LABEL_BY_LANG[lang];
    assert.ok(RADAR_PREFIX.test(`${label}Showers 40 km west.`), `label ${lang}: ${label}`);
    const calm = CALM_RADAR_BY_LANG[lang].replace("{distance}", "50 km");
    assert.ok(RADAR_PREFIX.test(calm), `calm template ${lang}`);
  }
});
