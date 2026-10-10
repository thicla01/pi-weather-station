import * as React from "react";
/**
 * Pill identifying the data authority (RADAR · ECCC · NWS · AIR · AQHI …).
 * Rendered verbatim, uppercased by CSS. New sources are NOT whitelisted.
 */
export interface SourceBadgeProps {
  /** Short authority key, rendered as-is: "RADAR", "ECCC", "NWS", "AIR", "AQHI", "IQA", "AQI".
   *  The AQHI badge reads "CAS" in French (ECCC's own name, from the `metrics.aqScale.*` locale
   *  keys via `ui/airQualityDisplay.js`) — the only source badge whose text follows the UI language. */
  source: string;
  /** "test" renders the neutral OUTLINED qualifier pill (never coloured). Omit for the standard fill. */
  variant?: "test" | null;
}
export function SourceBadge(props: SourceBadgeProps): JSX.Element;
