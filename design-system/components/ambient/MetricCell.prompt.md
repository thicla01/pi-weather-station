MetricCell — the stat tile of the glance grid; the grid is a STRICT 2×2 (no setting may break it), 8 px gap.

<MetricCell icon={<WindIcon />} value={21} unit="km/h" label="Vent" />
<MetricCell icon={<UvIcon />} value={6} label="UV" qualifier="modéré" qualifierTier="moderate" interactive />
<MetricCell icon={<DropIcon />} value={64} unit="%" label="Humidité" />

Rules: two rows per tile so all four share a height; the qualifier rides inline in the label, tier colour on the word only; hybrid strip is a 3 px inset shadow; feedback = :active accent-soft + scale .985, never hover. In nightRed the four category colours collapse to one red — the word carries it.
