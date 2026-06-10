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
| `docs:` | Documentation only |
| `chore:` | Build, dependencies, tooling |
| `refactor:` | Code change with no behaviour change |

Please include a short body explaining the *why*, not just the *what*. See the git log for examples.

---

## Code style

- **CSS**: CSS Modules with kebab-case class names in `.css` files, camelCase in JSX
- **JSDoc**: all React components must have a JSDoc block with `@param` and `@returns`
- **PropTypes**: all component props must be declared with `PropTypes`
- **ESLint**: run `cd client && npx eslint src/` before submitting — the build will fail on errors

Key ESLint rules to watch:
- `prefer-destructuring` — use `const { x } = obj` instead of `const x = obj.x`
- `react-hooks/exhaustive-deps` — stable `setState` functions can be excluded with `// eslint-disable-line`
- `no-empty-function` — use a named no-op (`const noop = () => {}`) instead of an inline empty arrow

---

## Server conventions

- All outbound `axios.get()` calls must include `{ timeout: 10_000 }`
- New endpoints must be added to [`docs/api.md`](docs/api.md)
- Security-relevant changes must be reflected in [`SECURITY.md`](SECURITY.md)

---

## Pull requests

1. Fork the repository and create a branch from `master`
2. Make your changes and rebuild the client if needed (`cd client && npm run prod`)
3. Run the ESLint check
4. Open a pull request against `master` with a clear description of what changed and why

There are no automated tests at this time — manual testing on the target hardware (Raspberry Pi + 7" touchscreen) is appreciated when possible.

---

## Reporting issues

Please include:
- Raspberry Pi OS version (`cat /etc/os-release`)
- Node.js version (`node --version`)
- Browser / Chromium version
- Relevant lines from the server log (`tail -50 ~/.local/state/pi-weather-station/server.log`; `/tmp/weather-server.log` on pre-2026-06 installs)
- Steps to reproduce
