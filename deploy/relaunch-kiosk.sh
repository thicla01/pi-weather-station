#!/bin/bash
# Pi Weather Station — relaunch-kiosk
# ----------------------------------------------------------------------------
# Relaunches the kiosk browser so a changed DISPLAY_SCALE (browser.conf) takes
# effect — `--force-device-scale-factor` / Firefox `layout.css.devicePixelRatio`
# are browser LAUNCH flags and can't change on a live page.
#
# Invoked detached by displayScaleCtrl (POST /api/relaunch-kiosk). This is NOT
# a server restart: the kiosk browser is a separate process from
# pi-weather-server. It is the field-tested manual relaunch recipe, wrapped.
#
# Because it kills the very browser whose page triggered the request, it MUST
# run detached from that browser (the caller spawns it via `bash` with
# detached+unref) and it relaunches start-server under `setsid` so the kiosk
# survives this script exiting. It never targets `node`/the server.

set -u

# Let the HTTP 200 flush and the requesting kiosk page settle before we kill it.
sleep 1

export LC_ALL=C
: "${XDG_RUNTIME_DIR:=/run/user/$(id -u)}"
export XDG_RUNTIME_DIR

# The systemd-user service env that spawned us usually lacks WAYLAND_DISPLAY —
# discover it from the socket, the same way detect-display-scale.sh does, so
# start-server's Wayland launch path works.
if [ -z "${WAYLAND_DISPLAY:-}" ]; then
    for sock in "$XDG_RUNTIME_DIR"/wayland-[0-9]*; do
        [ -S "$sock" ] || continue
        WAYLAND_DISPLAY=$(basename "$sock")
        export WAYLAND_DISPLAY
        break
    done
fi

# Stop the autostart launcher first so it doesn't race our relaunch.
pkill -f '/.local/bin/start-server' 2>/dev/null

# Kill the kiosk browser by its `--kiosk` flag — family-agnostic (Chromium,
# Chrome, Brave, Edge, Firefox all carry it) and path-independent. TERM first,
# then KILL for stragglers. This flag never appears on start-server, the
# server, or this script, so nothing else is caught.
pkill -TERM -f -- '--kiosk' 2>/dev/null
sleep 2
pkill -KILL -f -- '--kiosk' 2>/dev/null

# Clear Chromium's hostname-stamped singleton locks so the relaunch doesn't
# bail with "profile in use" (harmless no-op when the files don't exist, e.g.
# Firefox).
rm -f "$HOME/.config/chromium/Singleton"{Lock,Cookie,Socket} 2>/dev/null

# Relaunch via the installed launcher, fully detached so it outlives us.
LAUNCHER="$HOME/.local/bin/start-server"
[ -x "$LAUNCHER" ] || LAUNCHER="$(dirname "$0")/start-server"
setsid nohup "$LAUNCHER" </dev/null >/dev/null 2>&1 &

exit 0
