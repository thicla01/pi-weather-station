#!/bin/bash
# Pi Weather Station — check-kiosk-browser-flags.sh
# ----------------------------------------------------------------------------
# Read-only check of the RUNNING kiosk browser's effective command line: does
# it still carry --force-renderer-accessibility? Raspberry Pi OS adds that flag
# to every Chromium launch (/etc/chromium.d/00-rpi-vars); install.sh installs
# /etc/chromium.d/99-pi-weather-station-kiosk, which removes it for the kiosk
# launched by start-server only. This script shows whether that worked.
#
# Usage: bash deploy/check-kiosk-browser-flags.sh
#
# Prints each kiosk browser process (PID + command line), then a verdict.
# Exit status:
#   0  kiosk browser running, flag absent
#   1  kiosk browser running WITH the flag
#   2  no kiosk browser running (or no /proc to read)
#
# The kiosk browser is the process whose arguments include exactly `--kiosk`
# (start-server launches every family with it) and no `--type=…` argument
# (Chromium's renderer / GPU / zygote helpers carry one). Command lines are
# read straight from /proc/<pid>/cmdline with bash builtins, so the check never
# spawns a process whose own arguments contain `--kiosk`; it also skips its
# own PID and pkill/pgrep (relaunch-kiosk.sh runs `pkill -f -- --kiosk`).
#
# KIOSK_CHECK_PROC_DIR overrides /proc (used by test/kioskChromiumFlags.test.js
# with a fake process tree).

set -u

PROC_DIR="${KIOSK_CHECK_PROC_DIR:-/proc}"
FLAG="--force-renderer-accessibility"

if [ ! -d "$PROC_DIR" ]; then
    echo "check-kiosk-browser-flags: $PROC_DIR not found — this check needs Linux /proc." >&2
    exit 2
fi

found=0
flagged=0
for dir in "$PROC_DIR"/[0-9]*; do
    pid="${dir##*/}"
    case "$pid" in ''|*[!0-9]*) continue ;; esac
    [ "$pid" = "$$" ] && continue
    [ -r "$dir/cmdline" ] || continue

    args=()
    # cmdline is NUL-separated with a trailing NUL; a process that exits
    # mid-read just yields fewer (or no) arguments. The `|| [ -n … ]` keeps a
    # last argument with no trailing NUL.
    arg=""
    while IFS= read -r -d '' arg || [ -n "$arg" ]; do
        args+=("$arg")
        arg=""
    done 2>/dev/null < "$dir/cmdline"
    [ "${#args[@]}" -gt 0 ] || continue
    # A process that rewrote its title (Chromium does it for its helpers)
    # exposes one space-joined string instead: split it on spaces.
    if [ "${#args[@]}" -eq 1 ] && [[ "${args[0]}" == *" "* ]]; then
        read -r -a args <<< "${args[0]}"
    fi

    case "${args[0]##*/}" in
        pkill|pgrep) continue ;;
    esac

    is_kiosk=0
    is_helper=0
    has_flag=0
    for arg in "${args[@]}"; do
        case "$arg" in
            --kiosk) is_kiosk=1 ;;
            --type=*) is_helper=1 ;;
            "$FLAG"|"$FLAG"=*) has_flag=1 ;;
        esac
    done
    if [ "$is_kiosk" = 0 ] || [ "$is_helper" = 1 ]; then
        continue
    fi

    found=$((found + 1))
    echo "PID $pid: ${args[*]}"
    if [ "$has_flag" = 1 ]; then
        flagged=$((flagged + 1))
    fi
done

if [ "$found" -eq 0 ]; then
    echo "No kiosk browser running (no process launched with --kiosk)."
    exit 2
fi
if [ "$flagged" -gt 0 ]; then
    echo "FAIL: $FLAG is present on the kiosk browser."
    echo "      Is /etc/chromium.d/99-pi-weather-station-kiosk installed (bash deploy/install.sh)?"
    echo "      Was the kiosk relaunched since? start-server must export PI_WEATHER_STATION_KIOSK=1."
    exit 1
fi
echo "OK: $FLAG is absent from the kiosk browser."
exit 0
