import React from "react";

/**
 * One tile of the 2×2 MetricsGrid (Wind · Gust · UV · Humidity; Pressure and
 * Visibility in the extended Conditions view). Two rows — icon + value + unit,
 * then the uppercase label with an optional tier-coloured qualifier ("UV ·
 * modéré") — so all tiles share one height. Interactive tiles carry a dim
 * chevron and open a DetailsPopover; feedback is :active only (no hover on
 * kiosk surfaces). Port of `Cell` in client/src/components/ambient/MetricsGrid.
 */
const CAT = { low: "good", moderate: "mod", high: "bad", veryHigh: "vhigh", extreme: "vhigh" };

export function MetricCell({ icon, value, unit = "", label, qualifier = null, qualifierTier = null, interactive = false, children = null }) {
  const cat = qualifierTier ? CAT[qualifierTier] || qualifierTier : null;
  return (
    <div role={interactive ? "button" : undefined} tabIndex={interactive ? 0 : undefined} style={{ position: "relative", backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)", borderRadius: 8, padding: "10px 12px 8px", minHeight: 58, display: "flex", flexDirection: "column", color: "var(--c-text)", fontFamily: "var(--font-sans)", textAlign: "left", boxShadow: "inset 3px 0 0 var(--c-strip-color, transparent)", cursor: interactive ? "pointer" : undefined, WebkitTapHighlightColor: "transparent" }}>
      {interactive ? (
        <svg viewBox="0 0 24 24" width="15" height="15" style={{ position: "absolute", top: 8, right: 8, color: "var(--c-text-dim)" }} aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
        <span style={{ flex: "none", display: "inline-flex", width: 16, height: 16, fontSize: 16, color: "var(--c-accent)" }}>{icon}</span>
        <span style={{ display: "flex", alignItems: "baseline", gap: 3, minWidth: 0 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 500, letterSpacing: "-0.5px", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</span>
          {unit ? <span style={{ fontSize: 12, fontWeight: 500, color: "var(--c-text-dim)" }}>{unit}</span> : null}
        </span>
      </div>
      <div style={{ fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.6px", color: "var(--c-text-dim)", marginTop: "auto" }}>
        {label}
        {qualifier ? <span style={cat ? { color: `var(--mx-cat-${cat})` } : undefined}>{" · "}{qualifier}</span> : null}
      </div>
      {children}
    </div>
  );
}
