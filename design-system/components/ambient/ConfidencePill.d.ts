import * as React from "react";
/** Bucket-tinted confidence percentage (high ≥ 70 · mid 40–69 · low < 40). */
export interface ConfidencePillProps {
  /** 0–100; out-of-range values are clamped for display. */
  confidence: number;
}
export function ConfidencePill(props: ConfidencePillProps): JSX.Element;
/** Bucket resolver shared with the NowcastLine confidence dot. */
export function bucket(confidence: number): "high" | "mid" | "low";
