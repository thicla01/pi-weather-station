# Design references

Standalone HTML mockups produced via [Claude Design](https://claude.ai/design) and kept here as visual references for ROADMAP items that haven't been integrated into the React codebase yet.

These are **prototypes**, not production code. Each file is a self-contained HTML page (React + Babel via CDN) you can open directly in a browser to see the intended visual + interactive design. When the corresponding roadmap item gets picked up, the prototype is the source of truth for layout, colours, animation timing, and typography — but the actual implementation should be a proper React port that follows project conventions (CSS Modules, JSDoc + PropTypes, i18n EN/FR/ES).

## Design system bundle (code → Claude Design)

The reverse direction lives in [`design-system/`](../../design-system/readme.md) at the repository
root: the four palettes as `[data-theme]` themes, the token and rule contract, guideline and specimen
cards, React ports of the primitives and screen anatomies — pushed to the maintainer's "Design System"
project on claude.ai/design with Claude Code's DesignSync tool. Mockups produced against it still
land here, as prototypes, when they are not yet ported.

## Files

- **`solstices-equinoxes.html`** — companion astronomy visualisation. Earth + Sun + tilt + day length, with continuous orbital animation and a "Today" mode showing real-time orbital angle / countdown to the next event. Designed in French; full i18n is part of the integration work. See ROADMAP → "Astronomy companion view".
- **`sleep-mode.html`** — sleep-mode / screensaver visual reference, design A "Loom Sand". Three colour variants (day / night-cream / night-red) and stage-2 anti-burn-in dot. Demo includes corner switchers for variant + locale (FR/EN/ES) — both stripped from the React port. Ported in v2.12.0; see ROADMAP → "Sleep mode / screensaver". The React port lives at `client/src/components/ScreenSaver/`.

## Adding new references

1. Save the standalone HTML version (self-contained, no external assets) as `<feature-name>.html`.
2. Add a one-line entry above with a link to the matching ROADMAP item.
3. Don't commit minified or obfuscated builds — these files exist to be read.
