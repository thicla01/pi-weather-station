# Logs — where they live, how to read them

Single source of truth for log locations across platforms and process
managers. Skim this before assuming anything about `journalctl` — the
service intentionally redirects stdout/stderr away from the systemd
journal on Linux, which has caught more than one debugger off-guard.

## Pi Weather Station server (`pi-weather-server`)

The Node.js server's `console.log` / `console.error` output is the
primary application log. Where it lands depends on how the service is
managed:

| Platform | Process manager | Log file | How to tail |
|---|---|---|---|
| Linux (Pi, Debian, openSUSE) — installs from 2026-06 on | systemd user unit | `~/.local/state/pi-weather-station/server.log` | `tail -f ~/.local/state/pi-weather-station/server.log` |
| Linux — older installs (until `install.sh` is re-run) | systemd user unit | `/tmp/weather-server.log` | `tail -f /tmp/weather-server.log` |
| macOS | launchd user agent | `<repo>/server.log` (e.g. `~/pi-weather-station/server.log`) | `tail -f ~/pi-weather-station/server.log` |
| Manual `npm start` (any) | foreground shell | terminal stdout | nothing extra needed |

### Why the redirect on Linux

The base unit at `deploy/pi-weather-server.service` does **not** set
`StandardOutput` or `StandardError` — those would normally fall through
to the systemd journal (`journalctl --user -u pi-weather-server`).
However, `install.sh` always writes a drop-in at
`~/.config/systemd/user/pi-weather-server.service.d/override.conf`
that pins both streams to a file:

```ini
[Service]
StandardOutput=append:/home/<user>/.local/state/pi-weather-station/server.log
StandardError=append:/home/<user>/.local/state/pi-weather-station/server.log
```

This is a deliberate choice — a flat file is easier to `tail`, easier
to `grep`, easier to ship through `logrotate`, and survives operations
that would otherwise drop journal entries (the journal can be
volatile-only on space-constrained Pis). The trade-off is that
`journalctl --user -u pi-weather-server` now contains only systemd
**lifecycle** events (start, stop, exit code, ExecStartPre output)
and **none** of the application's own logging. If you grep journalctl
and find nothing useful, that is why — read the file instead.

### Why the XDG state dir (and not `/tmp`)

Installs before 2026-06 pinned the log to `/tmp/weather-server.log`.
On RPi OS **Trixie** / Debian 13, `/tmp` is a **tmpfs**: the log (and
its rotated copies) lived in RAM and vanished at every reboot — which
is exactly when they're needed (the post-freeze diagnostic pattern is
"kiosk froze → user reboots → read the log", and the reboot destroyed
the evidence). `~/.local/state/pi-weather-station/` (XDG state dir)
is on the SD card and survives reboots; the 10 MB rotation cap keeps
the write footprint negligible. Existing installs migrate the next
time `bash deploy/install.sh` runs; until then they keep logging to
`/tmp` and the debug panel reads both locations.

### Why a different path on macOS

The macOS install path uses a launchd plist (`com.pi-weather-station`)
written by the same `install.sh` script. launchd takes file paths
directly via `StandardOutPath` / `StandardErrorPath`, and the natural
choice is the repo directory itself (no `/tmp` cleanup wrinkle the way
Linux has, no `journalctl` analog to integrate with). The plist
points both streams at `<repo>/server.log`, which is `.gitignore`d.

### Log rotation

On Linux, `install.sh` generates `/etc/logrotate.d/weather-server`
from the template at `deploy/logrotate-weather-server`, substituting
the real log path and the install user/group (the old static copy
hardcoded `su pi pi`, which made logrotate silently skip the config on
any system without a `pi` user). The policy: rotate **daily and
additionally whenever the file passes 10 MB** (`maxsize`), keep 7
rotations, gzip them. If `sudo` is declined during install, the
generated config is left in a temp file with instructions — rotation
is then NOT active until it's copied into place.

No rotation on macOS (newsyslog's rename-based rotation doesn't play
well with launchd's always-open file descriptor) — `install.sh`
truncates the file at re-install when it exceeds 50 MB; truncate it
manually with `: > ~/pi-weather-station/server.log` if it gets large
(rare in practice for a single-user dev box).

### Reading systemd lifecycle events (Linux)

For the systemd-side view (start/stop, restart-on-failure history,
`ExecStartPre` output), `journalctl` is still the right tool — it just
won't have the application logs:

```bash
# Lifecycle events for this user unit
journalctl --user -u pi-weather-server -n 50

# Follow live (still no app stdout — see above)
journalctl --user -u pi-weather-server -f
```

### Sense HAT companion service (`pi-sensehat`)

The optional Sense HAT display service is a Python script with no
StandardOutput override, so its output **does** flow through the
journal as expected:

```bash
journalctl --user -u pi-sensehat -n 50
journalctl --user -u pi-sensehat -f
```

## Other server-side artefacts

Not strictly logs but commonly confused with them — same directory,
similar names:

| File | What it is | Where |
|---|---|---|
| `npm-audit.log` | Legacy: output of `npm audit` runs from older versions of `install.sh`. Vulnerability scanning moved to Dependabot on GitHub (`.github/dependabot.yml`) and the Debug panel's "Vulnerability scan" section now links there directly; this file is no longer read or updated and can be safely deleted | `<repo>/npm-audit.log` (gitignored) |
| `request-counts.json` | Daily quota counters for external APIs, not human-readable as logs | `<repo>/server/request-counts.json` (gitignored) |

## Debug panel — bottom-of-page log preview

When `DEBUG=true` is set in the systemd / launchd drop-in (toggle via
`bash deploy/toggle-debug.sh`), the in-app debug panel shows the last
~100 lines of the server log inline — same file as above, just
surfaced through `/api/debug` for convenience when SSH is awkward.
The endpoint is `localhostOnly`, so this preview is never exposed to
remote clients; it tails the file the host is actually writing to
(`~/.local/state/pi-weather-station/server.log` on Linux — falling
back to the legacy `/tmp/weather-server.log` on not-yet-migrated
installs — and `<repo>/server.log` on macOS).

## TL;DR for "I changed something on the server, where do I see it?"

```bash
# Linux (Pi) — installs from 2026-06 on
tail -f ~/.local/state/pi-weather-station/server.log

# Linux (Pi) — older installs (until install.sh is re-run)
tail -f /tmp/weather-server.log

# macOS (dev)
tail -f ~/pi-weather-station/server.log
```

If you find yourself reaching for `journalctl --user -u
pi-weather-server`, you are looking in the wrong place — that view
shows systemd lifecycle events only.
