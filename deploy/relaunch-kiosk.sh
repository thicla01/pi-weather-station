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

# Relaunch via the installed launcher. CRITICAL: launch it in a transient
# systemd --user scope so the kiosk's whole process tree does NOT live in
# pi-weather-server.service's cgroup.
#
# Why (mechanism, measured on RPi5-PWS5 2026-06-24):
# This script is spawned by the Node server (displayScaleCtrl), which lives in
# pi-weather-server.service. A plain `setsid` child inherits that cgroup
# (setsid changes the session, NOT the systemd cgroup). When start-server then
# launches Chromium, Chromium's MAIN process self-migrates into its own
# app-org.chromium.Chromium-<pid>.scope — BUT its helper processes (zygote, GPU
# process, renderers) STAY in the inherited cgroup. Measured: 8 of 9 chromium
# PIDs sat in pi-weather-server.service while only the main process self-scoped.
# So a later `systemctl --user restart pi-weather-server` (KillMode=control-
# group, the default) SIGTERMs the service cgroup, kills those 8 helpers, and
# the browser collapses — with nothing to respawn it (start-server runs the
# browser in the foreground; the XDG autostart fires once per session). Net: a
# button-relaunched kiosk dies on the next server restart / fleet redeploy /
# in-app update. (NB checking only the first chromium PID's cgroup is
# misleading — it is the one process that escapes; check the helpers too.)
#
# `systemd-run --user --scope` registers a transient scope as a SIBLING of
# pi-weather-server.service (under app.slice) and runs start-server inside it,
# so the ENTIRE Chromium tree is outside the service cgroup and a server restart
# can no longer reach it. This mirrors how the XDG-autostart kiosk already
# behaves (its start-server lives in the graphical session, not the service),
# which is why those kiosks survive a restart and button-relaunched ones did
# not. See incident: kiosk killed by server restart (cgroup).
LAUNCHER="$HOME/.local/bin/start-server"
[ -x "$LAUNCHER" ] || LAUNCHER="$(dirname "$0")/start-server"

# Breadcrumb: the controller spawns us with stdio ignored and each launch below
# would otherwise drop its output to /dev/null, so a failed scope creation or a
# browser that won't start is invisible (a dark kiosk with no trace). Append the
# launcher's output to a dedicated kiosk log in the XDG state dir instead.
KIOSK_LOG="${XDG_STATE_HOME:-$HOME/.local/state}/pi-weather-station/kiosk.log"
mkdir -p "$(dirname "$KIOSK_LOG")" 2>/dev/null

if command -v systemd-run >/dev/null 2>&1; then
    # --scope inherits this script's environment (WAYLAND_DISPLAY +
    # XDG_RUNTIME_DIR, set above) and runs the launcher synchronously, so we
    # detach it with setsid+& and let it outlive this script. --collect reaps
    # the transient unit once the kiosk exits; no --unit name (auto-generated)
    # so a repeated relaunch never collides with a not-yet-reaped prior scope.
    setsid systemd-run --user --scope --quiet --collect \
        "$LAUNCHER" </dev/null >>"$KIOSK_LOG" 2>&1 &
else
    # Fallback when systemd-run is unavailable (should never happen on a
    # systemd-managed Pi): the legacy detached launch. Stays in the caller's
    # cgroup, so a concurrent server restart can still take the kiosk down —
    # but better than not relaunching at all.
    setsid nohup "$LAUNCHER" </dev/null >>"$KIOSK_LOG" 2>&1 &
fi

exit 0
