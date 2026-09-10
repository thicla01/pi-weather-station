import * as React from "react";
/** One 2×2 metric tile: icon · value · unit / uppercase label (· tier-coloured qualifier). */
export interface MetricCellProps {
  /** Inline SVG (16 px, currentColor = --c-accent). */
  icon: React.ReactNode;
  /** Primary stat, tabular Geist Mono 22 px. */
  value: string | number;
  /** Unit suffix: "km/h", "%", "hPa", "km". */
  unit?: string;
  /** Caption: "Vent", "Rafales", "UV", "Humidité". */
  label: string;
  /** Tier wording riding inline after the label ("modéré"). */
  qualifier?: string | null;
  /** App category tier → --mx-cat-{good,mod,bad,vhigh}: low · moderate · high · veryHigh (extreme aliases veryHigh). */
  qualifierTier?: "low" | "moderate" | "high" | "veryHigh" | "extreme" | null;
  /** Adds the chevron affordance and role="button"; the tile opens a DetailsPopover (pass it as children). */
  interactive?: boolean;
  children?: React.ReactNode;
}
export function MetricCell(props: MetricCellProps): JSX.Element;
