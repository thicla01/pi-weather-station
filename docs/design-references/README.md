# Design references

Standalone HTML mockups produced via [Claude Design](https://claude.ai/design) and kept here as visual references for ROADMAP items that haven't been integrated into the React codebase yet.

These are **prototypes**, not production code. Each file is a self-contained HTML page (React + Babel via CDN) you can open directly in a browser to see the intended visual + interactive design. When the corresponding roadmap item gets picked up, the prototype is the source of truth for layout, colours, animation timing, and typography — but the actual implementation should be a proper React port that follows project conventions (CSS Modules, JSDoc + PropTypes, i18n EN/FR/ES).

## Files

- **`solstices-equinoxes.html`** — companion astronomy visualisation. Earth + Sun + tilt + day length, with continuous orbital animation and a "Today" mode showing real-time orbital angle / countdown to the next event. Designed in French; full i18n is part of the integration work. See ROADMAP → "Astronomy companion view".

## Adding new references

1. Save the standalone HTML version (self-contained, no external assets) as `<feature-name>.html`.
2. Add a one-line entry above with a link to the matching ROADMAP item.
3. Don't commit minified or obfuscated builds — these files exist to be read.
