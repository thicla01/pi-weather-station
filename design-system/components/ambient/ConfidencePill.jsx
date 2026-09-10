import React from "react";

/**
 * 0–100 % confidence pill, bucket-tinted: ≥ 70 accent-soft (calm — there is
 * no `success` token by design), 40–69 warn at 35 %, < 40 danger at 35 %.
 * Same geometry as SourceBadge so the two cluster as one chip row.
 * Port of client/src/components/ambient/ConfidencePill.
 */
export function bucket(c) {
  if (c >= 70) return "high";
  if (c >= 40) return "mid";
  return "low";
}

export function ConfidencePill({ confidence }) {
  const clamped = Math.max(0, Math.min(100, Math.round(confidence)));
  const b = bucket(clamped);
  const bg = b === "high"
    ? "var(--c-accent-soft)"
    : b === "mid"
      ? "color-mix(in srgb, var(--c-warn) 35%, transparent)"
      : "color-mix(in srgb, var(--c-danger) 35%, transparent)";
  return (
    <span style={{ display: "inline-block", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500, letterSpacing: "0.4px", padding: "2px 7px", borderRadius: 3, verticalAlign: 1, color: "var(--c-text)", backgroundColor: bg }}>
      {clamped}%
    </span>
  );
}
