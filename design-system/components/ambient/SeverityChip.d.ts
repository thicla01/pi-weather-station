import * as React from "react";
/**
 * Triangle + uppercase word, coloured by CAP severity tier (--sev-{low,med,high}-*).
 * In the codebase the word is derived from the alert's event name + i18n; here you pass it.
 */
export interface SeverityChipProps {
  /** CAP severity: minor → low (yellow) · moderate → med (orange) · severe | extreme → high (red). */
  severity: "minor" | "moderate" | "severe" | "extreme";
  /** The localized product-type word: "Warning" / "Watch" / "Advisory" / "Avertissement" / "Veille" / "Avis". */
  label: string;
  /** Icon only — no app surface uses it since the FloatingMiniBanner moved to `abbreviated`; a title beside it keeps its product word (the French prefix, the English trailing word). */
  compact?: boolean;
  /** Short word ("Avert.") with tighter spacing — the Pi compact alert card and the FloatingMiniBanner. */
  abbreviated?: boolean;
}
export function SeverityChip(props: SeverityChipProps): JSX.Element;
