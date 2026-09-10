import React from "react";

/**
 * Severity chip — triangle icon + uppercase mono word. Colour tier comes
 * from the CAP severity (minor → low, moderate → med, severe / extreme →
 * high); the WORD is the parsed product type (Watch / Warning / Advisory,
 * localized). Three signals at once — shape, colour, word — so the chip
 * survives nightRed (every tier is red there) and colour blindness.
 * Port of client/src/components/ambient/SeverityChip.
 */
const TIER = { minor: "low", moderate: "med", severe: "high", extreme: "high" };

export function SeverityChip({ severity, label, compact = false, abbreviated = false }) {
  const tier = TIER[severity] || "low";
  const style = {
    display: "inline-flex",
    alignItems: "center",
    gap: abbreviated ? 4 : 6,
    fontFamily: "var(--font-mono)",
    fontSize: 9.5,
    fontWeight: 500,
    letterSpacing: abbreviated ? "0.04em" : "0.12em",
    textTransform: "uppercase",
    padding: abbreviated ? "4px 7px 4px 6px" : compact ? "4px 7px" : "4px 9px 4px 7px",
    borderRadius: 999,
    border: "1px solid",
    whiteSpace: "nowrap",
    flexShrink: 0,
    color: `var(--sev-${tier}-ink)`,
    background: `var(--sev-${tier}-bg)`,
    borderColor: `var(--sev-${tier}-border)`,
  };
  const icon = abbreviated ? 10 : 11;
  return (
    <span style={style} data-severity={tier} title={label}>
      <svg viewBox="0 0 24 24" width={icon} height={icon} fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
        <path d="M12 2 L 22 20 L 2 20 Z" strokeLinejoin="round" />
        <line x1="12" y1="9" x2="12" y2="14" strokeLinecap="round" />
        <circle cx="12" cy="17.5" r="0.5" fill="currentColor" />
      </svg>
      {!compact && <span>{label}</span>}
    </span>
  );
}
