# Display-Scale Override (UI) — Low-Level Design

**Status:** Design **approved 2026-06-24** (§10 decisions settled). Phase 1 cleared to build.
**Date:** 2026-06-24
**Branch:** standalone small PR off `master` (orthogonal to v3.2/v3.3 rail work).
**Scope:** Expose the existing kiosk `DISPLAY_SCALE` override in the advanced Settings UI, so a screen whose EDID misreports its physical size (and therefore gets the wrong — usually `1.0` — auto-scale) can be corrected without SSH. Touches: server (new controller + route), client (Settings control + state), docs. **No launcher change** (`start-server`/`detect-display-scale.sh` already honour the override).

---

## 1. Overview & the decision that shaped this

`detect-display-scale.sh` derives the kiosk device-scale from the panel's **physical** PPI (EDID size ÷ resolution), snapped to clean quarters. It works for honest panels but is blind when the EDID lies. Confirmed live on **RPi5-PWS5** (2026-06-24): a 13.3″ 1920×1080 monitor (`ED-MONITOR-133C`) reports its physical size as **350×190 mm** — a 15.6″-class value — so the detector computes **141 PPP → raw 1.081 → snaps to 1.0 → no scaling**, when the intended factor is **1.25**.

The override variable `DISPLAY_SCALE` already exists end-to-end (`browser.conf` → `start-server` sources it → exports it → `detect-display-scale.sh` honours `auto`/`off`/number). Today it can only be set by editing `browser.conf` over SSH. **This feature is the UI for that variable — nothing more.**

### Options considered (settled)

| Option | Mechanism | Verdict |
|---|---|---|
| **A — expose `DISPLAY_SCALE`** (this LLD) | Chromium `--force-device-scale-factor` / Firefox `layout.css.devicePixelRatio`, set at kiosk launch | **Chosen.** Same crisp DPR mechanism as auto-scale; one mental model; override variable already wired. |
| B — runtime CSS `zoom` | Client-only, like the font-size preference | Rejected for this knob — adds a 3rd zoom axis (double-scale trap, see [`reference_font_scale_zoom_architecture`]); not a true DPR. |
| C — monitor-model picker | Pick brand/model → curated factor | Rejected — EDID is a generic clone (`EDA / RPi_FHD / 000000000001`) so the model can't even be auto-detected; the open user base makes the list rot. |

### Behaviour contract (the key semantics)

- **Default = `Auto`**, never a hardcoded `1`. `Auto` resolves to whatever the detector computes from the EDID (truth *or* lie). The fleet's current behaviour is 100% preserved with the control untouched.
- `Auto` **never goes below 1 and never shrinks** — no detection / baseline density / a downward-lying EDID all resolve to an effective **1.0** (safe no-op).
- The override is **bidirectional insurance**: it fixes "Auto stayed at 1.0 but I need 1.25" (the 133C case) *and* the pathological "Auto wrongly enlarged because the EDID under-reported its size" (→ pick `Off`).
- This is a **kiosk (physical-screen) setting, in the brightness category — NOT a per-viewer preference.** Read is open; write is `localhostOnly`. A remote LAN/VPN client (real IP) cannot change it (same as every settings write and as `POST /api/brightness`); only localhost / SSH-tunnel / RPi-Connect can, and it tunes **the Pi's screen**. `--force-device-scale-factor` is a launch flag on the Pi's Chromium — never served over HTTP — so a remote viewer's own browser is unaffected (renders at its own DPR). (Exception: RPi-Connect *screen-sharing* mirrors the Pi framebuffer, so it shows the scaled kiosk — because it literally is the Pi's screen.)
- **Applies on the next kiosk relaunch** (device-scale-factor is a launch flag; it cannot be changed on a running page). Phase 1 surfaces this clearly; an in-UI "relaunch kiosk" action is deferred to Phase 2 (§7).

---

## 2. Server — `server/displayScaleCtrl.js` (new)

Modelled on `server/brightnessCtrl.js` (detect → read → write, GET returns `available`, write is `localhostOnly`, pure helpers under `__test`).

### 2.1 Constants

```js
const os = require("os");
const path = require("path");
const BROWSER_CONF = path.join(os.homedir(), ".config", "pi-weather-station", "browser.conf");
const DETECT_SCRIPT_CANDIDATES = [
  path.join(os.homedir(), ".local", "bin", "detect-display-scale.sh"), // installed (prod)
  path.join(__dirname, "..", "deploy", "detect-display-scale.sh"),       // repo (dev)
];
const SNAP_STEP = 0.25;
const MAX_SCALE = 3.0;                                  // mirror detect-display-scale.sh
const DETECT_TIMEOUT_MS = 3_000;                        // wlr-randr is ~50 ms; 3 s is generous
// UI choices, in browser.conf terms. "auto" = remove the line; "off" = force 1.0.
const SCALE_CHOICES = ["auto", "off", "1.25", "1.5", "1.75", "2"];
```

### 2.2 Read side

- **`readOverride()`** → parse the current `DISPLAY_SCALE=` line from `browser.conf` (last assignment wins, shell-quote-tolerant). Returns `"auto"` when the file or line is absent. *(pure-ish, file read — see `__test` for the parser)*
- **`detectAuto()`** → `execSync(detectScript, { env: { ...process.env, DISPLAY_SCALE: "auto" }, timeout: DETECT_TIMEOUT_MS, stdio: ["ignore","pipe","pipe"] })`.
  - stdout trimmed → the snapped value (e.g. `"1.25"`) or `""` (→ effective 1.0). Map `""`→`null`.
  - stderr → parse the diagnostic line `PPI=NNN raw=N.NNN` for the UI hint. Helper `parseDetectDiag(stderr)` → `{ ppi, raw }|null`. *(`__test`)*
  - Any throw (script missing, no Wayland session, headless) → `{ value: null, ppi: null, raw: null }`. Never throws to the caller.
- **`available`** = `fs.existsSync(BROWSER_CONF)`. This is the file we'd write; absent ⇒ not a kiosk install (macOS launchd dev box, headless) ⇒ control hidden, exactly like `brightnessAvailable`.

### 2.3 `GET /api/display-scale`

```jsonc
{
  "available": true,
  "override": "auto",        // current browser.conf value: "auto" | "off" | "1.25" | ...
  "autoDetected": null,      // what Auto resolves to right now: "1.25" | null (null ⇒ 1.0)
  "ppi": 141,                // diagnostics for the "Auto (détecté : 100 %)" hint
  "raw": 1.081,
  "choices": ["auto","off","1.25","1.5","1.75","2"],
  "appliesOnRestart": true
}
```
`available:false` ⇒ `{ "available": false }` only (mirror `getBrightness`).

### 2.4 `POST /api/display-scale` — `localhostOnly`

- Body `{ scale: "auto" | "off" | <one of SCALE_CHOICES> }`. Validate against `SCALE_CHOICES` (and accept a numeric snapped to a quarter in `(1, MAX_SCALE]` for forward-flex); else `400`.
- **Write = managed-line rewrite of `browser.conf`** (the Node mirror of `apply_firefox_scale`'s `grep -v … ; echo …` pattern in `start-server`):
  1. Read existing file (or start from the install.sh template header if somehow absent but `available`).
  2. Drop every existing `DISPLAY_SCALE=` line.
  3. If `scale !== "auto"`: append `DISPLAY_SCALE="<value>"   # set via Settings UI`. If `"auto"`: append nothing (fall back to auto-detect — the absence *is* "auto").
  4. Preserve all other lines (`BROWSER_CMD`, `BROWSER_FAMILY`, `KIOSK_REMOTE_DEBUG`, …) verbatim.
  5. Atomic write: tmp file + `fs.renameSync` (as `settingsCtrl` does). Preserve existing mode (no secrets in `browser.conf`; do **not** force 0600 — leave as-is).
- Response: the new state from §2.3 plus `applied:false, appliesOnRestart:true` so the client can show the "takes effect on relaunch" note. Errors: `503` no browser.conf, `400` bad value, `500` write-failed (shape mirrors `setBrightness`).

### 2.5 `module.exports`

`{ getDisplayScale, setDisplayScale, readOverride, detectAuto, __test: { parseOverrideLine, parseDetectDiag, validateScale, rewriteBrowserConf } }`

### 2.6 Route registration — `server/index.js`

Beside the brightness routes (`:1035-1036`):
```js
const { getDisplayScale, setDisplayScale } = require("./displayScaleCtrl");
app.get("/api/display-scale",  apiLimiter,    getDisplayScale);   // read open (client must know to render the control)
app.post("/api/display-scale", localhostOnly, setDisplayScale);   // write kiosk-only — like POST /api/brightness
```

---

## 3. Client — state hook

`DISPLAY_SCALE` is a display-hardware control, sibling to brightness. Two placements:

1. **Dedicated `client/src/hooks/useDisplayScale.js`** *(recommended)* — fetch `GET /api/display-scale` once on mount, expose `{ displayScaleAvailable, displayScaleOverride, displayScaleAuto, displayScalePpi, displayScaleChoices, saveDisplayScale }`. `saveDisplayScale(v)` optimistically sets local state then `POST`s (no debounce — it's a discrete dropdown, not a slider). Surfaced through `AppContext` exactly like the brightness triplet (`AppContext.js:366-376`). Keeps `AppContext` from growing and isolates the concern.
2. Fold into `useScreenSaver` (already owns brightness). Rejected: `useScreenSaver` is the *screen-saver + brightness* hook; scale is unrelated to sleep state.

Hook shape mirrors `useScreenSaver`'s brightness block (`:53-73`): mount fetch + a setter that POSTs.

---

## 4. Client — Settings UI

Add a control in the existing display area of the ambient `SettingsPanel`, next to the Brightness slider (`SettingsPanel/index.js:716`, gated by `brightnessAvailable`). Gate the new control on `displayScaleAvailable`.

- **Control:** a segmented/`<select>` "Échelle d'affichage" with options rendered as **percent** (humans read "125 %", not "1.25"):
  - `Auto (détecté : {N} %)` — `N` from `displayScaleAuto` (`null`→`100`). Default selection when `override==="auto"`.
  - `100 % (désactivé)` → `off`
  - `125 %` → `1.25`, `150 %` → `1.5`, `175 %` → `1.75`, `200 %` → `2`
- **Labels:** inline trilingual via `lbl(lang, en, fr, es)` — permitted in `SettingsPanel` per the CLAUDE.md exception (no locale-file keys needed). Same convention as the brightness label (`:718`).
- **"Applies on relaunch" note:** a one-line helper under the control, shown only when the selected value differs from what's currently *applied* to the running kiosk — e.g. *"Prend effet au redémarrage du kiosque."* (Phase 1 has no live signal of the *applied* flag, so show the note whenever `override` was just changed this session.)
- **Remote read-only:** when the client is not localhost, render the control **disabled** with a hint *"Réglable seulement depuis le kiosque."* Reuse the same client-side localhost check that gates the Debug-panel button (verify the exact helper during build — `client/src/…` debug-button gating). Belt-and-suspenders: the `POST` is `localhostOnly` server-side regardless.

---

## 5. Launcher — no change

Confirmed against `deploy/start-server` and `deploy/detect-display-scale.sh`:

- `start-server` sources `browser.conf` (`:43-46`), then `export DISPLAY_SCALE` (`:151`) before running the detector (`:152`), then applies the result as `--force-device-scale-factor` (Chromium `:169-171`) or the Firefox pref (`:203-205`).
- `detect-display-scale.sh` honours `DISPLAY_SCALE` first (`:47-60`): `auto`→detect, `off`/`≤1`→nothing, number>1→pin.

So writing `DISPLAY_SCALE="1.25"` into `browser.conf` is sufficient and takes effect on the next kiosk relaunch — **zero launcher edits**, which sidesteps the "launcher lives in `~/.local/bin`, outside git" redeploy trap.

---

## 6. Edge cases

| Case | Behaviour |
|---|---|
| macOS dev / headless (no `browser.conf`) | `available:false` → control hidden; `POST` → `503`. |
| Detector script missing / no Wayland session | `autoDetected:null`, `ppi:null` → UI shows "Auto (détecté : 100 %)". |
| `browser.conf` has a hand-added `DISPLAY_SCALE` | `readOverride()` surfaces it; the dropdown reflects it; a save replaces it. |
| Value not in the snap grid (legacy/hand-set, e.g. `1.3`) | Read: shown as a synthesized "Custom (130 %)" option so we don't silently misrepresent it; Write: only grid values offered. |
| Firefox kiosk | Identical — `start-server` applies the override via the profile pref; no controller difference. |
| Remote (non-local) client | Reads state (control visible, disabled); `POST` blocked `localhostOnly` (`403`). |

---

## 7. Phase 2 — In-UI "Relaunch kiosk" button (✅ shipped 2026-06-24)

**What "relaunch" means — and what it is NOT.** The server (`pi-weather-server.service`, a systemd *user* service) and the kiosk browser are **two distinct processes**. The `DISPLAY_SCALE` flag is applied by `start-server` at **browser launch**, not at server start. So `systemctl --user restart pi-weather-server` would be wrong (bounces the server, browser keeps its old flag); `sudo reboot` is heavy + needs a password this Pi lacks. The correct lever is a **user-level kiosk relaunch (no sudo)**.

**Implemented:**
- **`POST /api/relaunch-kiosk`** (`localhostOnly`, `displayScaleCtrl.relaunchKiosk`) — spawns `deploy/relaunch-kiosk.sh` via `spawn("bash", [script], { detached: true, stdio: "ignore" }).unref()` and returns `{ok:true}` at once. Detached so it outlives the browser it kills; never touches `node`/the server.
- **`deploy/relaunch-kiosk.sh`** (git-tracked → `git pull`-deployable; controller resolves it from the repo path, `~/.local/bin` fallback): `sleep 1` (flush the HTTP 200) → set `XDG_RUNTIME_DIR`, discover `WAYLAND_DISPLAY` from the socket glob → `pkill start-server` → kill the browser by its `--kiosk` flag (family-agnostic, TERM→KILL) → clear Chromium `Singleton{Lock,Cookie,Socket}` → `setsid nohup "$LAUNCHER" &`.
- **Smart enable:** `GET /api/display-scale` now returns `applied` (the scale on the **running** kiosk, read from the live Chromium `--force-device-scale-factor` via `ps`; `"1"` = no flag, `null` = undeterminable e.g. Firefox/headless). The UI shows the relaunch button **only when `effective(selected) ≠ applied`** — re-selecting the value already in effect shows nothing. `applied: null` → button shown (don't hide a possibly-useful action).
- **UI:** `RelaunchButton` in `SettingsPanel`, local-only, **two-tap confirm** (the screen blanks ~15 s on relaunch). Client `useDisplayScale.relaunchKiosk()` POSTs then refetches after ~9 s (refreshes `applied` for a surviving tunnel client; the on-Pi kiosk page is gone by then).

Verified on RPi5-PWS5: deployed → button appears after changing scale → two-tap → kiosk relaunches → `applied` updates → button disappears.

---

## 8. Tests (`test/displayScale.test.js`, `node --test`)

Via the `__test` export (pattern: `brightnessCtrl.__test`):

- `parseOverrideLine` — absent file → `"auto"`; `DISPLAY_SCALE=1.25`, `DISPLAY_SCALE="1.25"`, `DISPLAY_SCALE='off'`, trailing comment, multiple lines (last wins).
- `parseDetectDiag` — `"…PPI=141 raw=1.081 -> 1.0…"` → `{ppi:141, raw:1.081}`; no-scaling line; garbage → `null`.
- `validateScale` — accept `auto`/`off`/grid values; reject `0.5`, `4`, `"big"`, `1.3` (non-grid).
- `rewriteBrowserConf` — replaces an existing line; adds when absent; **removes** on `auto`; preserves `BROWSER_CMD`/`BROWSER_FAMILY`/other lines; idempotent.

---

## 9. Docs checklist (per CLAUDE.md "Before committing")

- [ ] `docs/api.md` — `GET`/`POST /api/display-scale` (shape, middleware, `available` semantics).
- [ ] `CLAUDE.md` — add `displayScaleCtrl.js` to the server architecture list; note that **the server now manages the `DISPLAY_SCALE=` line in `browser.conf`** (previously install.sh-only); cross-ref the `DISPLAY_SCALE` kiosk-scale section.
- [ ] `CHANGELOG.md` — under the next version (`feat(ui): set kiosk display scale from Settings`).
- [ ] `ROADMAP.md` — note Phase 2 "relaunch kiosk from UI" as a tracked follow-up.
- [ ] Build green: `cd client && npm run prod` (zero errors); `npm test`.
- [ ] JSDoc + PropTypes on the new component; complete JSDoc on the controller handlers.

---

## 10. Decisions (settled 2026-06-24)

1. **Hook placement** — ✅ dedicated `useDisplayScale` (§3).
2. **Choice ceiling** — ✅ stop the dropdown at `200 %`. Choices: `Auto / 100 % (off) / 125 / 150 / 175 / 200`.
3. **Relaunch** — ✅ Phase 2, deferred (§7). The apply mechanism is the **user-level kiosk relaunch (no sudo)**, NOT `systemctl --user restart pi-weather-server` (that bounces the server, not the browser) and not necessarily `sudo reboot`. Phase 1 ships the "takes effect on relaunch" note only.
4. **Version** — ✅ standalone small PR off `master` (orthogonal to the v3.2/v3.3 rail work).
