SeverityChip — leads the alert head row; the colour says how bad (CAP severity), the word says what (product type).

<SeverityChip severity="minor" label="Advisory" />
<SeverityChip severity="moderate" label="Veille" />
<SeverityChip severity="severe" label="Warning" />
<SeverityChip severity="extreme" label="Avert." abbreviated />
<SeverityChip severity="moderate" label="Watch" compact />

Rules: tier colour = severity, never the alert type (a Heat Advisory at Moderate is orange and reads "Advisory"). Extreme collapses to the red high tier; the wall-of-red banner carries the extra urgency. Never add a fourth colour.
