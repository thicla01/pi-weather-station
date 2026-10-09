# Contributing to Pi Weather Station

Thank you for your interest in contributing! This is a personal hobbyist project, but pull requests and issue reports are welcome.

---

## Getting started

```bash
git clone https://github.com/thicla01/pi-weather-station.git
cd pi-weather-station
npm install
cd client && npm install && cd ..
cp settings.example.json settings.json
# edit settings.json and add your API keys
npm start
```

The app will open at `https://localhost:8443`. Accept the self-signed certificate warning in your browser.

To rebuild the client after making frontend changes:

```bash
cd client && npm run prod
```

The compiled `dist/` files are committed to git so Raspberry Pis can update with a simple `git pull` without rebuilding.

---

## Project structure

See [`architecture.md`](architecture.md) for the system diagram and [`CLAUDE.md`](CLAUDE.md) for a detailed breakdown of every file.

---

## Commit conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Use for |
|---|---|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `perf:` | Performance or cost improvement |
| `style:` / `polish:` / `ux:` | Visible UI, styling or UX change |
| `release:` | Version promotion |
| `chore(deps):` | Dependency bumps (the prefix Dependabot uses) |
| `docs:` | Documentation only |
| `chore:` | Build, tooling, CI — anything that never runs on a Pi, even when it is a fix |
| `refactor:` | Code change with no behaviour change |

The commit type decides whether installed kiosks are told about an update: the in-app updater only announces `feat`, `fix`, `perf`, `style`, `polish`, `ux`, `release` and `chore(deps)` commits (`USER_FACING_COMMIT_RE` in `server/updateChecker.js`, locked by `test/updateChecker.test.js`). `docs`, plain `chore`, `refactor` and `test` commits are silent — they still reach the Pis with the next announced update, but a push made only of them is never offered. Give any change a kiosk owner should see a user-facing type.

Please include a short body explaining the *why*, not just the *what*. See the git log for examples.

---

## Code style

- **CSS**: CSS Modules with kebab-case class names in `.css` files, camelCase in JSX
- **JSDoc**: all React components must have a JSDoc block with `@param` and `@returns`
- **PropTypes**: all component props must be declared with `PropTypes`
- **ESLint**: run `cd client && npx eslint src/` before submitting — the build will fail on errors

Key ESLint rules to watch:
- `prefer-destructuring` — use `const { x } = obj` instead of `const x = obj.x`
- `react-hooks/exhaustive-deps` — avoid suppressions: `useState` setters declared in the same component are already treated as stable (setters received through context or props are not). If one is truly needed, name the rule and say why on the same line, e.g. `// eslint-disable-line react-hooks/exhaustive-deps -- initialization, runs once on mount`; a bare `// eslint-disable-line` fails the build (`no-unlimited-disable`)
- `no-empty-function` — an empty body is an error even in a named arrow (`const noop = () => {}` is flagged too); write a no-op as `() => undefined`, e.g. `.catch(() => undefined)`

---

## Server conventions

- All outbound `axios.get()` calls must include `{ timeout: 10_000 }`
- New endpoints must be added to [`docs/api.md`](docs/api.md)
- Security-relevant changes must be reflected in [`SECURITY.md`](SECURITY.md)

---

## Pull requests

1. Fork the repository and create a branch from `master`
2. Make your changes and rebuild the client if needed (`cd client && npm run prod`)
3. Run `npm test` and the ESLint check
4. Open a pull request against `master` with a clear description of what changed and why

`npm test` uses Node's built-in `node --test` runner (no extra dependencies). CI runs it, plus the client production build (which lints) and a check that the committed `client/dist` file set is reproducible, on every push and pull request to `master`. If you touched a locale file or an inline `lbl()` string, regenerate the glossary with `node tools/gen-localization-glossary.js` — `npm test` fails while it is stale. Manual testing on the target hardware (Raspberry Pi + 7" touchscreen) is still appreciated when possible.

---

## Reporting issues

Please include:
- Raspberry Pi OS version (`cat /etc/os-release`)
- Node.js version (`node --version`)
- Browser / Chromium version
- Relevant lines from the server log (`tail -50 ~/.local/state/pi-weather-station/server.log`; `/tmp/weather-server.log` on pre-2026-06 installs; `tail -50 <repo>/server.log` on macOS — see [`docs/logs.md`](docs/logs.md))
- Steps to reproduce
