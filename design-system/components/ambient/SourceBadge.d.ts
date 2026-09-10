import * as React from "react";
/**
 * Pill identifying the data authority (RADAR · ECCC · NWS · AIR · AQHI …).
 * Rendered verbatim, uppercased by CSS. New sources are NOT whitelisted.
 */
export interface SourceBadgeProps {
  /** Short authority key, rendered as-is: "RADAR", "ECCC", "NWS", "AIR", "AQHI", "IQA", "AQI". */
  source: string;
  /** "test" renders the neutral OUTLINED qualifier pill (never coloured). Omit for the standard fill. */
  variant?: "test" | null;
}
export function SourceBadge(props: SourceBadgeProps): JSX.Element;
