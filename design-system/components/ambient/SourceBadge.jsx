import React from "react";

/**
 * Pill naming the authority behind a piece of data — RADAR for the local
 * pixel heuristic, ECCC / NWS / MELCC / AQHI for official feeds. Fill
 * --c-accent-soft, ink --c-text, uppercased via CSS. Port of
 * client/src/components/ambient/SourceBadge (CSS Modules) — inline styles
 * here so it renders standalone in Claude Design.
 */
export function SourceBadge({ source, variant = null }) {
  const base = {
    display: "inline-block",
    backgroundColor: "var(--c-accent-soft)",
    color: "var(--c-text)",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: "0.6px",
    textTransform: "uppercase",
    padding: "2px 7px",
    borderRadius: 3,
    verticalAlign: 1,
  };
  // "test" — the TEST qualifier appended beside the source badge for a
  // non-Actual NWS alert. Deliberately OUTLINED and dimmed, never amber:
  // --c-warn collapses to red in nightRed and would fake an emergency.
  const test = variant === "test"
    ? { backgroundColor: "transparent", color: "var(--c-text-dim)", border: "1px solid var(--c-text-dim)", padding: "1px 6px" }
    : null;
  return <span style={{ ...base, ...test }}>{source}</span>;
}
