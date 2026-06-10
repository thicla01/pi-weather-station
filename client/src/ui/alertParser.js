/**
 * Gov-alert description parser — turns the free-form text in
 * `description_en` / `description_fr` into a list of structured
 * sections so the v3.1 Phase 4b alert body can render scannable
 * blocks instead of a wall of paragraphs.
 *
 * Returns a list of `{ type, lead, detail }` objects:
 *
 *   - `type`  — canonical section slug, one of:
 *               "intro" | "hazard" | "impact" | "where" | "when" |
 *               "action" | "observation" | "source" | "section"
 *               (drives the icon + i18n label in the UI)
 *   - `lead`  — short headline-y string (the section's label as
 *               it appeared in the source, e.g. "Hazards" /
 *               "Dangers" / "WHAT" — kept verbatim so the user
 *               sees the exact upstream wording)
 *   - `detail` — the body text under the heading, with the
 *                heading line stripped
 *
 * Strategy:
 *
 *   1. **NWS** — split on `/\n\s*\*\s+/m` (asterisks at the start
 *      of lines). NWS structures alerts with `* WHAT...`,
 *      `* WHERE...`, `* WHEN...`, `* IMPACTS...`,
 *      `* PRECAUTIONARY/PREPAREDNESS ACTIONS...`. The first
 *      "section" (before the first `*`) is the intro paragraph.
 *
 *   2. **ECCC** — split on heading lines that match
 *      `/^([\w' àâéèêçîïôûùÀÂÉÈÊÇÎÏÔÛÙ]+)\s*:\s*$/m`. ECCC EN uses
 *      "Hazards:" / "Timing:"; ECCC FR uses "Dangers :" /
 *      "Période :" with a French-typography space before the
 *      colon. The detail for a heading is everything until the
 *      next heading or end of text.
 *
 *   3. **Fallback** — if neither structure is detected, the whole
 *      text is returned as a single "intro" section. The caller
 *      can render that as plain paragraphs.
 *
 * Source identification is heuristic-by-content, not by source
 * slug — that way an ECCC alert that happens to use NWS-style
 * asterisks still gets the asterisk path, and an NWS alert
 * formatted with headings still gets the heading path.
 *
 * @param {string} text - The raw `description_en` / `description_fr`
 * @param {string} [lang] - "en" | "fr" | "es" — used to map source
 *   heading words ("Hazards" / "Dangers") to canonical types.
 *   Defaults to "en".
 * @returns {Array<{type: string, lead: string, detail: string}>}
 *   sections list. Always at least one entry. Never null.
 */
export function parseAlertText(text, lang = "en") {
  const safe = (text || "").trim();
  if (!safe) return [];

  // Pre-process: some NWS alerts (Special Marine Warning, etc.)
  // embed ALL-CAPS keyword markers like `HAZARD...`, `SOURCE...`,
  // `IMPACT...` INSIDE asterisked blocks rather than as their own
  // top-level sections. Promote them to top-level by inserting a
  // newline before each one — that way the asterisk split below
  // also splits at these keyword markers.
  //
  // Guard the regex so we only match keywords on their own line
  // (preceded by a newline + optional whitespace), and only when
  // the keyword is at least 3 chars (avoids splitting on
  // mid-sentence acronyms like "US..."). The `(?=...)` lookahead
  // keeps the keyword in the inserted line — we're just adding
  // a paragraph break BEFORE it.
  const preprocessed = safe.replace(
    /([^\n])\n(?=[A-Z]{3,}(?:\/[A-Z]+)?\.\.\.)/g,
    "$1\n\n",
  );

  // Try NWS-style asterisk split first. The split delimiter
  // matches either:
  //   - a `*` at the start of a line (the canonical NWS bullet)
  //   - OR a top-of-line ALL-CAPS keyword followed by `...` —
  //     the synthetic delimiters we just inserted via the
  //     pre-processing step
  //
  // Lookahead on the second branch so the keyword is preserved
  // in the next split piece (the split is BEFORE the keyword,
  // not consuming it).
  //
  // `(?:^|\n)` rather than just `\n` so a text that starts
  // directly with `*` (no leading newline) still matches.
  const asteriskParts = preprocessed.split(
    /(?:^|\n)(?:\s*\*\s+|(?=[A-Z]{3,}(?:\/[A-Z]+)?\.\.\.))/,
  );
  // A successful asterisk split yields ≥2 parts. We also accept
  // the "single part starts with `*` or KEYWORD..." edge case as
  // structured (the original text had only one section and no
  // intro), which would otherwise collapse to the heading fallback
  // and lose the lead extraction.
  if (
    asteriskParts.length >= 2
    || /^(\*\s+|[A-Z]{3,}(?:\/[A-Z]+)?\.\.\.)/.test(preprocessed)
  ) {
    return parseAsteriskedBlocks(asteriskParts, lang);
  }

  // Try ECCC-style heading split. A "heading" is a line of just
  // a word or two followed by `:` (optionally with a space
  // before the colon in French). Includes accented chars + the
  // apostrophe so French/English headings both match.
  // The regex IS case-sensitive — ECCC capitalises headings
  // consistently and we don't want to false-positive on a
  // mid-sentence "hazards: " inside a paragraph.
  const headingRe = /^([A-Z][A-Za-zÀ-ÿ' ]{2,30})\s*:\s*$/m;
  if (headingRe.test(safe)) {
    return parseHeadingBlocks(safe, lang);
  }

  // No structure detected — single intro section, caller renders
  // as plain paragraphs.
  return [{ type: "intro", lead: "", detail: safe }];
}

/**
 * Strip NWS-specific parasite content from an intro paragraph.
 * Three patterns get scrubbed:
 *
 *   1. **Header line** — `<Alert Type> issued <date> at <time>
 *      [until <date> at <time>] by NWS <Office>`. Redundant with
 *      the meta chips (sender / sentAt / expiresAt are already
 *      rendered as their own pills under the title).
 *
 *   2. **Product code** — a 4-7 char ALL-CAPS identifier on its
 *      own line (e.g. `SMWTAE`, `TORWWS`, `SVRTAE`). NWS internal
 *      product-code routing; no value for the kiosk user.
 *
 *   3. **Dangling sentence** — `The National Weather Service in
 *      <City> has issued a`. NWS deliberately writes this as an
 *      incomplete sentence whose object lives in the first
 *      asterisked bullet ("...has issued a Special Marine
 *      Warning for..."). Once the bullets get split into their
 *      own structured sections, the dangling "a" becomes a
 *      truncated mess at the end of the intro. Drop the whole
 *      line.
 *
 * Patterns are matched line-by-line against the (trimmed) intro,
 * regardless of order — NWS sometimes inverts the product code
 * and the dangling sentence depending on alert type. Multiple
 * runs are possible if more than one match exists.
 *
 * ECCC intros aren't affected — none of the three patterns match
 * ECCC's structure. If an ECCC alert happened to start with
 * "issued by NWS..." (very unlikely), the scrubber would also
 * clean it, but that's the right behaviour: NWS-style headers
 * carry no information the meta chips don't already surface.
 *
 * @param {string} intro - The raw first split piece
 * @returns {string} cleaned intro (possibly empty)
 */
function scrubNwsIntro(intro) {
  return intro
    // Header line — `<Alert Type> issued <date> at <time>
    // [until <date> at <time>] by NWS <Office>`. The leading
    // alert-type wording is variable (3+ words) so we anchor on
    // `issued ... by NWS` to be robust against different alert
    // types. `[^\n]*` swallows everything to the next newline.
    .replace(/^[^\n]*?issued [^\n]*?by NWS [^\n]+\n?/m, "")
    // Product code — 4-7 ALL-CAPS letters/digits on their own
    // line. Constrained length to avoid false-positives on
    // legitimate ALL-CAPS short content (e.g. "ALERT").
    .replace(/^[A-Z][A-Z0-9]{3,6}\n?/m, "")
    // Dangling sentence. Matches both "has issued a" and
    // "has issued an" (the trailing article depends on whether
    // the alert type starts with a vowel sound).
    .replace(/^The National Weather Service in [^\n]+ has issued an?\s*\n?/im, "")
    .trim();
}

/**
 * Parse NWS-style asterisked blocks. `parts[0]` is the intro
 * (text before the first `*`). `parts[1..]` are the section
 * bodies, each starting with a keyword like "WHAT..." or
 * "PRECAUTIONARY/PREPAREDNESS ACTIONS...".
 *
 * @param {string[]} parts
 * @param {string} lang
 * @returns {Array<{type: string, lead: string, detail: string}>}
 */
function parseAsteriskedBlocks(parts, lang) {
  const sections = [];
  // The first split piece, if it doesn't start with `*` or an
  // uppercase-keyword `...`, is intro text. Once we've pushed
  // it, the remaining parts are all section bodies.
  let startIdx = 0;
  const first = (parts[0] || "").trim();
  if (first && !/^(\*\s+|[A-Z]{3,}(?:\/[A-Z]+)?\.\.\.)/.test(first)) {
    // Scrub well-known NWS intro noise — see `scrubNwsIntro` for the
    // three patterns. If the intro is empty after scrubbing, skip the
    // section entirely (otherwise we'd render an empty paragraph
    // before the first structured section).
    const cleaned = scrubNwsIntro(first);
    if (cleaned) {
      sections.push({ type: "intro", lead: "", detail: cleaned });
    }
    startIdx = 1;
  }

  for (let i = startIdx; i < parts.length; i += 1) {
    const block = (parts[i] || "").trim();
    if (!block) continue;
    // Strip a leading `* ` from canonical NWS bullets — the
    // pre-processed KEYWORD... lines don't have one and pass
    // through unchanged.
    const stripped = block.replace(/^\*\s+/, "");

    // Two header shapes to handle:
    //
    //   1. ALL-CAPS-keyword followed by `...` — the classic
    //      NWS Severe Thunderstorm Warning pattern (`WHAT...`,
    //      `WHERE...`, `HAZARD...`, `IMPACT...`, etc.). Also
    //      covers slash-separated compound keywords like
    //      `PRECAUTIONARY/PREPAREDNESS ACTIONS...`.
    //
    //   2. Mixed-case lead phrase followed by `...` — the NWS
    //      Special Marine Warning pattern (`Special Marine
    //      Warning for...`, `Until 845 PM CDT.`, `At 538 PM
    //      CDT, ...`, `Locations impacted include...`). The
    //      lead is shorter than the full sentence — we capture
    //      up to the first `...` or `,` or a verb-ish word.
    //
    // Try shape 1 first (more specific); fall through to 2.
    let lead = null;
    let detail = stripped;
    const allCapsMatch = stripped.match(/^([A-Z][A-Z/ ]+?)(?:\.\.\.|:)\s*/);
    if (allCapsMatch) {
      lead = allCapsMatch[1].trim();
      detail = stripped.slice(allCapsMatch[0].length).trim();
    } else {
      // Mixed-case lead — capture up to the first `...` or `:`.
      const mixedMatch = stripped.match(/^([A-Z][^\n]{2,80}?)(?:\.\.\.|:)\s*/);
      if (mixedMatch) {
        lead = mixedMatch[1].trim();
        detail = stripped.slice(mixedMatch[0].length).trim();
      } else {
        // Time-prefix lead — NWS observation blocks read like
        // "At 538 PM CDT, severe thunderstorms..." where the
        // "At <time>" prefix is the temporal anchor and the
        // comma separates the lead from the observation body.
        // Only matches when the block starts with a known
        // time-indicator word so regular prose with early commas
        // doesn't false-positive as a section heading.
        const timePrefixMatch = stripped.match(
          /^((?:At|Until|Jusqu['']\S*|Depuis|From)\b[^,\n]{2,60}),\s*/i,
        );
        if (timePrefixMatch) {
          lead = timePrefixMatch[1].trim();
          detail = stripped.slice(timePrefixMatch[0].length).trim();
        } else {
          // No `...`, `:`, or time-prefix marker — use the first
          // short line as the lead. Skips blocks where the first
          // line is a long paragraph (no clear separation
          // between lead and body).
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
      // Couldn't extract a lead — render the whole block as
      // a plain paragraph under a `section` type so the icon
      // is at least neutral instead of being silently lost.
      sections.push({ type: "section", lead: "", detail: stripped });
    }
  }
  return sections;
}

/**
 * Parse ECCC-style heading blocks. Scans for heading lines and
 * splits the text into intro + heading-led sections.
 *
 * @param {string} text
 * @param {string} lang
 * @returns {Array<{type: string, lead: string, detail: string}>}
 */
function parseHeadingBlocks(text, lang) {
  const sections = [];
  const lines = text.split("\n");
  let currentLead = null;
  let currentBuf = [];
  let introBuf = [];
  const headingLineRe = /^([A-Z][A-Za-zÀ-ÿ' ]{2,30})\s*:\s*$/;
  const flushCurrent = () => {
    if (currentLead === null) {
      // Lines belong to the intro
      return;
    }
    const detail = currentBuf.join("\n").trim();
    sections.push({ type: classifyHeading(currentLead, lang), lead: currentLead, detail });
  };
  for (const line of lines) {
    const m = line.match(headingLineRe);
    if (m) {
      // New heading — flush whatever we were collecting
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
  // Flush the last buffer
  if (currentLead === null) {
    const intro = introBuf.join("\n").trim();
    if (intro) sections.unshift({ type: "intro", lead: "", detail: intro });
  } else {
    flushCurrent();
  }
  return sections;
}

/**
 * Map a source-supplied heading keyword to a canonical section
 * type. Case-insensitive; matches the leading word of the
 * heading (so "WHAT" matches "WHAT" but also "What to do"
 * because the latter's leading word is "What").
 *
 * Adding a new section type:
 *   1. Add the keyword(s) below — both EN and FR.
 *   2. Add an icon mapping in `AlertDetailInline`.
 *   3. Add i18n keys (`alert.section{Type}`) in all three locales.
 *
 * @param {string} heading - The source-side heading text.
 * @param {string} lang - "en" | "fr" | "es" (currently unused but
 *   reserved for locale-specific patterns).
 * @returns {string} canonical section slug
 */
// eslint-disable-next-line no-unused-vars -- `lang` reserved for future locale-specific patterns
function classifyHeading(heading, lang) {
  const h = heading.toLowerCase().trim();
  // ORDER MATTERS — check the longer, more-specific patterns first.
  // For example "what to do" must beat the generic "what" hazard
  // match (otherwise an ECCC "What to do:" section gets misfiled
  // as a hazard). Same logic for "mesures à prendre" vs any other
  // FR section that happens to start with "mesures".
  //
  // Recommended action
  if (/^(precautionary|preparedness|what to do|action|mesures|recommend|que hacer)/i.test(h)) return "action";
  // Where/affected zones — includes the NWS Special Marine Warning's
  // verbose "Special X Warning for..." and "Locations impacted
  // include..." phrasings. `^special` matches the SMW lead;
  // `^locations` matches the trailing "Locations impacted" bullet.
  if (/^(where|location|zones?|région|área|special|impacted)/i.test(h)) return "where";
  // Observation — a timestamped report of what's actually happening
  // RIGHT NOW (the event itself). NWS encodes these as `At <time>,
  // <observation>...` leads. NOT "when" (the alert's validity
  // window — `Until <time>`) and NOT "source" (the SOURCE...
  // metadata line that names the instrument the observation came
  // from). Three closely-related types kept distinct because they
  // answer three different reader questions: "what was seen?"
  // (observation), "where did the data come from?" (source),
  // "what's the danger?" (hazard).
  if (/^at \d/i.test(h)) return "observation";
  // Source — meta about how the observation was made. The literal
  // NWS `SOURCE...Radar indicated.` line. Gets the radar icon
  // since "Radar indicated" is the canonical content; even when a
  // spotter report or trained-observer report is the source, the
  // radar icon still reads as "instrument-derived information".
  if (/^source/i.test(h)) return "source";
  // When/timing/period — alert validity window, not observations.
  // `^until` matches NWS "Until <time>" end-of-validity leads;
  // `^jusqu'` is the French equivalent ("Jusqu'à 22 h").
  if (/^(when|timing|period|période|periodo|until|jusqu')/i.test(h)) return "when";
  // Impacts / consequences — what the hazard DOES (to people,
  // vegetation, travel), as opposed to what the hazard IS. Split out
  // of the hazard bucket (2026-06, bug C4): NWS advisories carry both
  // `* WHAT...` and `* IMPACTS...` blocks, and folding them together
  // rendered "What's happening" twice in the detail view (observed on
  // the Klamath Falls Frost Advisory — the impacts block "Frost could
  // harm sensitive outdoor vegetation" wore the wrong heading).
  if (/^(impacts?|conséquences?|impactos?)/i.test(h)) return "impact";
  // Hazards — the danger the alert warns about. Now distinct from
  // `source` and `impact` (which used to fold here). WHAT, HAZARD,
  // Dangers, Risques, Aléas, Peligros all answer "what's the danger?".
  if (/^(what|hazards?|dangers?|risques?|aléas?|peligros?)/i.test(h)) return "hazard";
  // Unknown heading — keep as a generic "section" so the UI can
  // still render it with the upstream wording but a neutral icon.
  return "section";
}

/* Test exports — `classifyHeading` is the only piece worth
 * unit-testing internally; the parsers above are covered by
 * full-text end-to-end tests in `test/alertParser.test.js`. */
export const __test = { classifyHeading };
