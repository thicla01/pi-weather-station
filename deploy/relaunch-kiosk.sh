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

# Breadcrumb log: the controller spawns us with stdio ignored, so without it a
# failed scope creation, a browser that won't start or a lock decision below
# would be invisible (a dark kiosk with no trace). Our own notes and the
# launcher's output (see the launch at the bottom) are appended here.
KIOSK_LOG="${XDG_STATE_HOME:-$HOME/.local/state}/pi-weather-station/kiosk.log"
mkdir -p "$(dirname "$KIOSK_LOG")" 2>/dev/null

log() {
    printf '%s relaunch-kiosk: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$KIOSK_LOG" 2>/dev/null
}

# --- Which browser is the kiosk? -------------------------------------------
# Same source start-server reads (install.sh writes BROWSER_CMD +
# BROWSER_FAMILY there). Resolved BEFORE anything is killed, and in a subshell
# with `set +u`: browser.conf is user-editable shell, and an error while
# sourcing it must never abort THIS script once the kiosk is down — nothing
# would relaunch it. Output: the family on line 1, the command's basename on
# line 2 (either may be empty, e.g. a pre-browser-choice install).
CONFIG_FILE="$HOME/.config/pi-weather-station/browser.conf"
read_kiosk_browser() {
    (
        set +u
        BROWSER_CMD=""
        BROWSER_FAMILY=""
        if [ -f "$CONFIG_FILE" ]; then
            # shellcheck disable=SC1090
            . "$CONFIG_FILE" >/dev/null 2>&1
        fi
        printf '%s\n' "$BROWSER_FAMILY"
        if [ -n "$BROWSER_CMD" ]; then basename -- "$BROWSER_CMD"; else echo; fi
    ) 2>/dev/null
}
KIOSK_FAMILY=""
KIOSK_NAME=""
{ IFS= read -r KIOSK_FAMILY; IFS= read -r KIOSK_NAME; } < <(read_kiosk_browser) || true
# A browser.conf without BROWSER_FAMILY: derive Firefox from the name, as
# start-server's own fallback does (Chromium-family names are mapped below).
if [ -z "$KIOSK_FAMILY" ]; then
    case "$KIOSK_NAME" in
        firefox|firefox-esr) KIOSK_FAMILY="firefox" ;;
    esac
fi

# Chromium-family profile directory per executable basename. One arm per name
# install.sh offers, IDENTICAL to start-server's clean_orphan_chromium_lock
# arms (test/kioskBrowserLists.test.js keeps the two in lockstep). Returns 1
# for a name it doesn't know (Firefox, a hand-edited path, ...).
kiosk_profile_dir() {
    case "$1" in
        chromium|chromium-browser)              echo "$HOME/.config/chromium" ;;
        google-chrome|google-chrome-stable)     echo "$HOME/.config/google-chrome" ;;
        microsoft-edge|microsoft-edge-stable)   echo "$HOME/.config/microsoft-edge" ;;
        brave-browser)                          echo "$HOME/.config/BraveSoftware/Brave-Browser" ;;
        *)                                      return 1 ;;
    esac
}
# One name per distinct profile directory above — swept when the configured
# browser can't be mapped to a single one (no browser.conf, unknown name).
KIOSK_SWEEP_NAMES="chromium google-chrome microsoft-edge brave-browser"

# Is $1 a running (non-zombie) process? A zombie still answers `kill -0`, and
# the browser we just SIGKILLed can linger as one until it is reaped.
pid_is_live() {
    case "$1" in ''|*[!0-9]*) return 1 ;; esac
    state=$(ps -o stat= -p "$1" 2>/dev/null)
    state=${state//[[:space:]]/}
    case "$state" in ''|Z*) return 1 ;; esac
    return 0
}

# This host's name as Chromium stamps it (gethostname). `uname -n` is the
# fallback for a system without the `hostname` binary: an empty value would
# make every lock look foreign, so even a live one would be removed.
THIS_HOST=$(hostname 2>/dev/null || uname -n 2>/dev/null)

# Clear a Chromium profile's Singleton{Lock,Cookie,Socket} unless a LIVE
# process on this host still holds it. SingletonLock is a symlink to
# `HOSTNAME-PID`. Chromium reclaims a same-host lock whose PID is dead on its
# own, but refuses one stamped with ANOTHER hostname ("profile in use by
# another computer" — silent in kiosk mode), e.g. after a hostname change.
# Removing a lock a live browser still holds (a desktop user's own window on
# the same profile) would let a second instance open that profile, so that
# one is left alone.
clear_stale_profile_lock() {
    profile_dir="$1"
    lock="$profile_dir/SingletonLock"
    [ -L "$lock" ] || return 0
    target=$(readlink "$lock" 2>/dev/null) || return 0
    lock_host="${target%-*}"
    lock_pid="${target##*-}"
    if [ "$lock_host" = "$THIS_HOST" ] && pid_is_live "$lock_pid"; then
        log "$lock still held by live PID $lock_pid — left in place."
        return 0
    fi
    rm -f "$lock" "$profile_dir/SingletonCookie" "$profile_dir/SingletonSocket"
    log "cleared stale profile lock in $profile_dir (was $target)."
}

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

# Clear the killed kiosk's hostname-stamped singleton lock so the relaunch
# doesn't bail with "profile in use" — in the profile of the browser actually
# configured (it used to be ~/.config/chromium only, whatever the browser).
# Firefox needs nothing: it doesn't use Singleton* files, and its profile
# lock is released when the process dies.
case "$KIOSK_FAMILY" in
    firefox)
        ;;
    *)
        if KIOSK_PROFILE=$(kiosk_profile_dir "$KIOSK_NAME"); then
            clear_stale_profile_lock "$KIOSK_PROFILE"
        else
            # Family unknown/chromium but no recognisable name: sweep every
            # known Chromium-family profile (the live-lock guard keeps this
            # safe for browsers that are still running).
            for name in $KIOSK_SWEEP_NAMES; do
                KIOSK_PROFILE=$(kiosk_profile_dir "$name") && clear_stale_profile_lock "$KIOSK_PROFILE"
            done
        fi
        ;;
esac

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

# Each launch below appends the launcher's output to $KIOSK_LOG (defined at
# the top) instead of dropping it to /dev/null.
log "relaunching ${KIOSK_NAME:-the kiosk browser} (family: ${KIOSK_FAMILY:-unset}) via $LAUNCHER."
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
