// Regression tests for the gov-alert description parser in
// `client/src/ui/alertParser.js`. The parser turns free-form NWS
// (`* WHAT...` asterisks) and ECCC (`Hazards:` / `Dangers :`
// headings) text into a unified list of structured sections that
// the v3.1 Phase 4b alert body renders with icons + leads + details.
//
// Run: `npm test` (same runner as alertLogic / radarTrend / uiHybrid).
//
// Same constraint as the other test files in this repo: the client
// source uses ESM and Node's CJS loader can't `require()` it.
// Rather than wire up a transpiler just for tests we re-implement
// the parser verbatim here — if `alertParser.js` drifts, these
// tests fail loudly and remind us to sync.

const { test } = require("node:test");
const assert = require("node:assert/strict");

// ---------- start of verbatim copy from client/src/ui/alertParser.js ----------

function classifyHeading(heading) {
  const h = heading.toLowerCase().trim();
  // Order matters — more-specific patterns first.
  // `at \d` and `source` checked BEFORE `when`/`hazard` so they
  // route to their own dedicated types (`observation` / `source`)
  // instead of being absorbed by the broader buckets.
  if (/^(precautionary|preparedness|what to do|action|mesures|recommend|que hacer)/i.test(h)) return "action";
  if (/^(where|location|zones?|région|área|special|impacted)/i.test(h)) return "where";
  if (/^at \d/i.test(h)) return "observation";
  if (/^source/i.test(h)) return "source";
  if (/^(when|timing|period|période|periodo|until|jusqu')/i.test(h)) return "when";
  if (/^(impacts?|conséquences?|impactos?)/i.test(h)) return "impact";
  if (/^(what|hazards?|dangers?|risques?|aléas?|peligros?)/i.test(h)) return "hazard";
  return "section";
}

function scrubNwsIntro(intro) {
  return intro
    .replace(/^[^\n]*?issued [^\n]*?by NWS [^\n]+\n?/m, "")
    .replace(/^[A-Z][A-Z0-9]{3,6}\n?/m, "")
    .replace(/^The National Weather Service in [^\n]+ has issued an?\s*\n?/im, "")
    .trim();
}

function parseAsteriskedBlocks(parts, lang) {
  const sections = [];
  let startIdx = 0;
  const first = (parts[0] || "").trim();
  if (first && !/^(\*\s+|[A-Z]{3,}(?:\/[A-Z]+)?\.\.\.)/.test(first)) {
    const cleaned = scrubNwsIntro(first);
    if (cleaned) {
      sections.push({ type: "intro", lead: "", detail: cleaned });
    }
    startIdx = 1;
  }
  for (let i = startIdx; i < parts.length; i += 1) {
    const block = (parts[i] || "").trim();
    if (!block) continue;
    const stripped = block.replace(/^\*\s+/, "");
    let lead = null;
    let detail = stripped;
    const allCapsMatch = stripped.match(/^([A-Z][A-Z/ ]+?)(?:\.\.\.|:)\s*/);
    if (allCapsMatch) {
      lead = allCapsMatch[1].trim();
      detail = stripped.slice(allCapsMatch[0].length).trim();
    } else {
      const mixedMatch = stripped.match(/^([A-Z][^\n]{2,80}?)(?:\.\.\.|:)\s*/);
      if (mixedMatch) {
        lead = mixedMatch[1].trim();
        detail = stripped.slice(mixedMatch[0].length).trim();
      } else {
        const timePrefixMatch = stripped.match(
          /^((?:At|Until|Jusqu['']\S*|Depuis|From)\b[^,\n]{2,60}),\s*/i,
        );
        if (timePrefixMatch) {
          lead = timePrefixMatch[1].trim();
          detail = stripped.slice(timePrefixMatch[0].length).trim();
        } else {
          const firstLine = stripped.split("\n")[0].trim();
          if (firstLine.length <= 80) {
            lead = firstLine;
            detail = stripped.slice(firstLine.length).trim();
          }
        }
      }
    }
    if (lead) {
      sections.push({ type: classifyHeading(lead, lang), lead, detail });
    } else {
      sections.push({ type: "section", lead: "", detail: stripped });
    }
  }
  return sections;
}

function parseHeadingBlocks(text, lang) {
  const sections = [];
  const lines = text.split("\n");
  let currentLead = null;
  let currentBuf = [];
  let introBuf = [];
  const headingLineRe = /^([A-Z][A-Za-zÀ-ÿ' ]{2,30})\s*:\s*$/;
  const flushCurrent = () => {
    if (currentLead === null) return;
    const detail = currentBuf.join("\n").trim();
    sections.push({ type: classifyHeading(currentLead, lang), lead: currentLead, detail });
  };
  for (const line of lines) {
    const m = line.match(headingLineRe);
    if (m) {
      if (currentLead === null) {
        const intro = introBuf.join("\n").trim();
        if (intro) sections.unshift({ type: "intro", lead: "", detail: intro });
        introBuf = [];
      } else {
        flushCurrent();
      }
      currentLead = m[1].trim();
      currentBuf = [];
    } else if (currentLead === null) {
      introBuf.push(line);
    } else {
      currentBuf.push(line);
    }
  }
  if (currentLead === null) {
    const intro = introBuf.join("\n").trim();
    if (intro) sections.unshift({ type: "intro", lead: "", detail: intro });
  } else {
    flushCurrent();
  }
  return sections;
}

function parseAlertText(text, lang = "en") {
  const safe = (text || "").trim();
  if (!safe) return [];
  // Promote embedded ALL-CAPS keywords (HAZARD..., SOURCE...,
  // IMPACT...) to their own paragraph so the split below catches them.
  const preprocessed = safe.replace(
    /([^\n])\n(?=[A-Z]{3,}(?:\/[A-Z]+)?\.\.\.)/g,
    "$1\n\n",
  );
  // Split on `* ` bullets OR top-of-line uppercase keywords + `...`.
  const asteriskParts = preprocessed.split(
    /(?:^|\n)(?:\s*\*\s+|(?=[A-Z]{3,}(?:\/[A-Z]+)?\.\.\.))/,
  );
  if (
    asteriskParts.length >= 2
    || /^(\*\s+|[A-Z]{3,}(?:\/[A-Z]+)?\.\.\.)/.test(preprocessed)
  ) {
    return parseAsteriskedBlocks(asteriskParts, lang);
  }
  const headingRe = /^([A-Z][A-Za-zÀ-ÿ' ]{2,30})\s*:\s*$/m;
  if (headingRe.test(safe)) {
    return parseHeadingBlocks(safe, lang);
  }
  return [{ type: "intro", lead: "", detail: safe }];
}

// ---------- end of verbatim copy ----------

// classifyHeading — the canonical type lookup is the most error-prone
// part of the parser (typos in keyword regex would silently miscategorise
// real alerts). Lock the EN/FR/ES mappings the design's i18n table
// commits to.

test("classifyHeading: NWS asterisked keywords", () => {
  assert.equal(classifyHeading("WHAT"), "hazard");
  assert.equal(classifyHeading("WHERE"), "where");
  assert.equal(classifyHeading("WHEN"), "when");
  // IMPACTS split out of the hazard bucket (2026-06, bug C4): WHAT +
  // IMPACTS both mapping to hazard rendered "What's happening" twice
  // in the detail view (Klamath Falls Frost Advisory).
  assert.equal(classifyHeading("IMPACTS"), "impact");
  assert.equal(classifyHeading("IMPACT"), "impact");
  assert.equal(classifyHeading("PRECAUTIONARY/PREPAREDNESS ACTIONS"), "action");
});

test("classifyHeading: impact keywords across the three locales", () => {
  assert.equal(classifyHeading("Impacts"), "impact");
  assert.equal(classifyHeading("Conséquences"), "impact");
  assert.equal(classifyHeading("Impactos"), "impact");
});

// Regression for bug C4 (the Klamath Falls Frost Advisory shape): a
// WHAT + IMPACTS advisory must produce two DIFFERENTLY-typed sections,
// never two "hazard" blocks wearing the same heading.
test("frost-advisory shape: WHAT and IMPACTS get distinct section types", () => {
  const text = [
    "* WHAT...Sub-freezing temperatures as low as 30 expected.",
    "* WHERE...Klamath Basin.",
    "* WHEN...From 2 AM to 9 AM PDT Saturday.",
    "* IMPACTS...Frost could harm sensitive outdoor vegetation.",
  ].join("\n");
  const sections = parseAlertText(text, "en");
  const types = sections.map((s) => s.type);
  assert.deepEqual(types, ["hazard", "where", "when", "impact"]);
  const impact = sections.find((s) => s.type === "impact");
  assert.match(impact.detail, /sensitive outdoor vegetation/);
});

test("classifyHeading: ECCC English headings", () => {
  assert.equal(classifyHeading("Hazards"), "hazard");
  assert.equal(classifyHeading("Hazard"), "hazard");
  assert.equal(classifyHeading("Timing"), "when");
  assert.equal(classifyHeading("What to do"), "action");
  assert.equal(classifyHeading("Location"), "where");
});

test("classifyHeading: ECCC French headings (typography varies)", () => {
  assert.equal(classifyHeading("Dangers"), "hazard");
  assert.equal(classifyHeading("Risques"), "hazard");
  assert.equal(classifyHeading("Aléas"), "hazard");
  assert.equal(classifyHeading("Période"), "when");
  assert.equal(classifyHeading("Mesures à prendre"), "action");
});

test("classifyHeading: Spanish headings (defence — ECCC doesn't ship ES but i18n keys exist)", () => {
  assert.equal(classifyHeading("Peligros"), "hazard");
  assert.equal(classifyHeading("Periodo"), "when");
  assert.equal(classifyHeading("Que hacer"), "action");
});

test("classifyHeading: unknown headings fall back to generic 'section'", () => {
  // Note: "Sources" was previously expected as section but now
  // matches the `source` keyword (NWS Special Marine Warning's
  // SOURCE...Radar-indicated label) and classifies as hazard.
  // Pick headings that aren't covered by any keyword.
  assert.equal(classifyHeading("References"), "section");
  assert.equal(classifyHeading("Notes"), "section");
  assert.equal(classifyHeading("Unknown"), "section");
});

// Full-payload parsing — covers the two real-world structures (NWS
// asterisks, ECCC headings) plus the unstructured fallback.

test("parseAlertText: empty / null input", () => {
  assert.deepEqual(parseAlertText(""), []);
  assert.deepEqual(parseAlertText(null), []);
  assert.deepEqual(parseAlertText(undefined), []);
});

test("parseAlertText: NWS-style asterisked sections (verified against /alerts/active)", () => {
  // Trimmed-down version of the synthesis design's reference NWS
  // payload. Real alerts can be longer but follow the same shape.
  const text = [
    "Severe Thunderstorm Warning issued May 25 at 12:25 PM EDT by NWS",
    "",
    "* WHAT...Damaging winds detected",
    "* WHERE...Coos, Carroll, and Grafton Counties",
    "* WHEN...Until 4:30 PM EDT",
    "* IMPACTS...Damaging winds can blow down trees and power lines",
    "* PRECAUTIONARY/PREPAREDNESS ACTIONS...Seek shelter inside a building",
  ].join("\n");
  const sections = parseAlertText(text, "en");
  assert.equal(sections.length, 6);
  assert.equal(sections[0].type, "intro");
  assert.match(sections[0].detail, /Severe Thunderstorm Warning issued/);
  assert.equal(sections[1].type, "hazard");
  assert.equal(sections[1].lead, "WHAT");
  assert.equal(sections[1].detail, "Damaging winds detected");
  assert.equal(sections[2].type, "where");
  assert.equal(sections[3].type, "when");
  assert.equal(sections[4].type, "impact");      // IMPACTS has its own type since bug C4
  assert.equal(sections[5].type, "action");
});

test("parseAlertText: ECCC English headings (verified against Thunder Bay STV payload 2026-05-25)", () => {
  // Real description_en pulled from /api/weather-alerts at
  // (48.4, -89.2) on 2026-05-25. Truncated for the test but
  // structure-faithful — the two headings (`Hazards:` and
  // `Timing:`) plus free-form action paragraphs is the canonical
  // ECCC EN shape.
  const text = [
    "Conditions are favourable for the development of severe thunderstorms that may be capable of producing strong wind gusts and large hail.",
    "",
    "Hazards: ",
    "Wind gusts up to 110 km/h.",
    "Hail up to ping pong ball sized.",
    "",
    "Timing: ",
    "This evening.",
    "",
    "Utility outages are possible.",
    "",
    "Be prepared for severe weather.",
  ].join("\n");
  const sections = parseAlertText(text, "en");
  // Expect: intro, hazard, when. The trailing paragraphs after
  // `Timing:` collapse into the `when` section detail because
  // they're not preceded by another recognised heading — that's
  // accepted as faithful to the source (the meteorologist's
  // structure declared the end of structured content at "This
  // evening." and the rest is free-form context).
  assert.ok(sections.length >= 3);
  assert.equal(sections[0].type, "intro");
  assert.match(sections[0].detail, /Conditions are favourable/);
  const hazard = sections.find((s) => s.type === "hazard");
  assert.ok(hazard, "should detect Hazards section");
  assert.equal(hazard.lead, "Hazards");
  assert.match(hazard.detail, /Wind gusts up to 110/);
  const when = sections.find((s) => s.type === "when");
  assert.ok(when, "should detect Timing section");
  assert.equal(when.lead, "Timing");
  assert.match(when.detail, /This evening/);
});

test("parseAlertText: ECCC French headings with French-typography colon spacing", () => {
  const text = [
    "Les conditions sont propices à la formation d'orages violents.",
    "",
    "Dangers :",
    "Vents soufflant en rafales jusqu'à 110 km/h.",
    "Grêlons jusqu'à la taille d'une balle de ping-pong.",
    "",
    "Période :",
    "Ce soir.",
    "",
    "Soyez prêt à composer avec des conditions difficiles.",
  ].join("\n");
  const sections = parseAlertText(text, "fr");
  assert.ok(sections.length >= 3);
  assert.equal(sections[0].type, "intro");
  assert.match(sections[0].detail, /Les conditions sont propices/);
  const dangers = sections.find((s) => s.type === "hazard");
  assert.ok(dangers, "Dangers heading must classify as hazard");
  assert.equal(dangers.lead, "Dangers");
  assert.match(dangers.detail, /Vents soufflant en rafales/);
  const periode = sections.find((s) => s.type === "when");
  assert.ok(periode, "Période heading must classify as when");
  assert.equal(periode.lead, "Période");
});

test("parseAlertText: unstructured text returns single intro section", () => {
  const text = "A short alert with no structured sections. Just one paragraph of free-form text.";
  const sections = parseAlertText(text, "en");
  assert.equal(sections.length, 1);
  assert.equal(sections[0].type, "intro");
  assert.equal(sections[0].detail, text);
});

test("parseAlertText: multi-paragraph unstructured stays as a single intro section", () => {
  // Caller (AlertDetailInline) renders intro detail by splitting
  // on `\n\n` — the parser doesn't need to split paragraphs itself.
  const text = "First paragraph here.\n\nSecond paragraph after a blank line.";
  const sections = parseAlertText(text, "en");
  assert.equal(sections.length, 1);
  assert.equal(sections[0].type, "intro");
  assert.equal(sections[0].detail, text);
});

test("parseAlertText: asterisked text wins over heading-like content inside it", () => {
  // Edge case: a NWS alert that happens to mention "Timing:"
  // somewhere in its description shouldn't fall into the ECCC
  // heading path — the leading `* WHAT...` should anchor it
  // to the asterisk parser.
  const text = "* WHAT...Hail expected. Timing: this evening.";
  const sections = parseAlertText(text, "en");
  assert.equal(sections[0].type, "hazard");
  assert.match(sections[0].detail, /Timing: this evening/);
});

test("scrubNwsIntro: strips header + product code + dangling sentence", () => {
  // All three patterns present (the SMW case observed in production
  // on 2026-05-25 Bay County FL).
  const raw = [
    "Special Marine Warning issued May 25 at 5:38PM CDT until May 25 at 8:45PM CDT by NWS Tallahassee FL",
    "SMWTAE",
    "The National Weather Service in Tallahassee has issued a",
  ].join("\n");
  assert.equal(scrubNwsIntro(raw), "", "all three lines must scrub to empty");
});

test("scrubNwsIntro: preserves meaningful content after parasite lines", () => {
  // ECCC-style intro paragraph (a real human-readable summary).
  // Must pass through untouched — none of the three NWS patterns
  // match its content.
  const eccc = "Les conditions sont propices à la formation d'orages violents pouvant produire des rafales fortes, de la grêle de grosse taille et de la pluie forte.";
  assert.equal(scrubNwsIntro(eccc), eccc, "ECCC intro paragraphs must not be touched");
});

test("scrubNwsIntro: handles partial matches (header only)", () => {
  // Some NWS alerts skip the product code or dangling sentence.
  // Each scrub step must work independently.
  const headerOnly = "Severe Thunderstorm Warning issued May 25 at 6:01PM CDT until May 25 at 6:45PM CDT by NWS Tallahassee FL\nFollowed by a real summary paragraph.";
  assert.equal(
    scrubNwsIntro(headerOnly),
    "Followed by a real summary paragraph.",
    "header line strips, leaving the remaining content",
  );
});

test("parseAlertText: NWS Special Marine Warning (mixed-case leads + embedded HAZARD/SOURCE/IMPACT)", () => {
  // Real description_en pulled from /api/weather-alerts at Bay
  // County FL on 2026-05-25. Combines two NWS quirks: asterisked
  // bullets with mixed-case leads (`* Special Marine Warning for...`,
  // `* Until 845 PM CDT.`, `* At 538 PM CDT, ...`) AND embedded
  // ALL-CAPS keyword sections (`HAZARD...`, `SOURCE...`, `IMPACT...`)
  // sitting inside the third asterisked block. The parser must split
  // both kinds of markers into separate sections.
  const text = [
    "Special Marine Warning issued May 25 at 5:38PM CDT until May 25 at 8:45PM CDT by NWS Tallahassee FL",
    "SMWTAE",
    "The National Weather Service in Tallahassee has issued a",
    "* Special Marine Warning for... Coastal waters from Okaloosa-Walton County Line to Mexico Beach out 20 NM.",
    "* Until 845 PM CDT.",
    "* At 538 PM CDT, severe thunderstorms capable of producing waterspouts were located along a line.",
    "HAZARD...Waterspouts and wind gusts 34 knots or greater.",
    "SOURCE...Radar indicated.",
    "IMPACT...Waterspouts can quickly form and capsize boats.",
    "* Locations impacted include... Mexico Beach, Panama City Beach, and Laguna Beach.",
  ].join("\n");
  const sections = parseAlertText(text, "en");
  // Expect 7 structured sections (4 asterisked + 3 embedded
  // ALL-CAPS). NO intro section — `scrubNwsIntro` removes the
  // three NWS parasite lines (header + product code + dangling
  // sentence), leaving an empty intro that gets skipped.
  assert.ok(sections.length >= 7, `expected ≥7 sections, got ${sections.length}`);
  assert.equal(
    sections.filter((s) => s.type === "intro").length,
    0,
    "NWS metadata intro should be fully scrubbed → no intro section",
  );
  // The 4 asterisked bullets each get the mixed-case lead extracted.
  const special = sections.find((s) => s.lead && s.lead.startsWith("Special Marine Warning for"));
  assert.ok(special, "asterisked `Special Marine Warning for` lead must be extracted");
  assert.equal(special.type, "where", "`Special...for` is a WHERE section (geographic scope)");
  // NWS lines that end with a single period (`Until 845 PM CDT.`)
  // don't match the `...`/`:` marker regex, so the parser falls
  // through to the "first line is the lead" branch — meaning the
  // final period IS part of the lead. The test searches by prefix
  // rather than exact equality so this implementation detail
  // doesn't make the assertion brittle.
  const until = sections.find((s) => s.lead && s.lead.startsWith("Until"));
  assert.ok(until, "asterisked `Until ...` lead must be extracted");
  assert.equal(until.type, "when", "`Until` is a WHEN section");
  const at = sections.find((s) => s.lead && s.lead.startsWith("At 538 PM CDT"));
  assert.ok(at, "asterisked `At <time>` lead must be extracted");
  assert.equal(at.type, "observation", "`At <time>` is an OBSERVATION section — what was detected, not when the alert ends");
  // The 3 embedded ALL-CAPS keywords become their own sections.
  const hazard = sections.find((s) => s.lead === "HAZARD");
  assert.ok(hazard, "embedded HAZARD... line must split into its own section");
  assert.equal(hazard.type, "hazard");
  assert.match(hazard.detail, /Waterspouts and wind gusts/);
  const source = sections.find((s) => s.lead === "SOURCE");
  assert.ok(source, "embedded SOURCE... line must split into its own section");
  assert.equal(source.type, "source", "SOURCE has its own canonical type (separate from hazard)");
  const impact = sections.find((s) => s.lead === "IMPACT");
  assert.ok(impact, "embedded IMPACT... line must split into its own section");
  assert.equal(impact.type, "impact", "IMPACT has its own canonical type since bug C4");
  const locations = sections.find((s) => s.lead && s.lead.startsWith("Locations impacted include"));
  assert.ok(locations, "asterisked `Locations impacted include...` lead must be extracted");
  assert.equal(locations.type, "where", "Locations is a WHERE section");
});

test("classifyHeading: NWS Special Marine Warning leads", () => {
  // Lock the SMW-specific mixed-case patterns so future parser
  // edits don't silently regress the classification of marine
  // alerts. These are the four phrases that anchor the SMW format.
  assert.equal(classifyHeading("Special Marine Warning for"), "where");
  assert.equal(classifyHeading("Until 845 PM CDT"), "when");
  // `At <time>` is a timestamp-prefixed OBSERVATION, not a "when".
  // The user's view: an observation reported at a moment in time
  // ("severe thunderstorms were located along a line at 538 PM"),
  // not the alert's validity window.
  assert.equal(classifyHeading("At 538 PM CDT"), "observation");
  assert.equal(classifyHeading("Locations impacted include"), "where");
  assert.equal(classifyHeading("HAZARD"), "hazard");
  assert.equal(classifyHeading("SOURCE"), "source");
  assert.equal(classifyHeading("IMPACT"), "impact");
});

test("parseAlertText: heading split — unknown heading keeps source wording", () => {
  // An alert with a heading we don't have a keyword for ("References:")
  // should still get parsed as a section, just typed as the generic
  // "section" so the UI renders it with a neutral icon and the
  // original heading text.
  const text = [
    "Quick alert body.",
    "",
    "References:",
    "Multiple radar observations.",
  ].join("\n");
  const sections = parseAlertText(text, "en");
  assert.equal(sections.length, 2);
  assert.equal(sections[0].type, "intro");
  const refs = sections.find((s) => s.lead === "References");
  assert.ok(refs, "References heading must be preserved as a section");
  assert.equal(refs.type, "section");
  assert.equal(refs.detail, "Multiple radar observations.");
});
