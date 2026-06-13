#!/bin/bash
# Pi Weather Station — detect-display-scale
# ----------------------------------------------------------------------------
# Computes a kiosk display-scale factor from the connected panel's PHYSICAL
# pixel density, so the UI keeps a consistent physical size across the fleet's
# heterogeneous screens (7" 800x480, 10.1" 800x1280, ...) instead of rendering
# tiny on a dense panel left at compositor scale 1.
#
# Output : a single decimal scale factor on stdout (e.g. "1.25", "1.5"), ONLY
#          when scaling is actually beneficial. Empty output means "leave the
#          display untouched" (panel density already near the baseline, or no
#          geometry could be read). All diagnostics go to stderr. Always exits
#          0 — never breaks the kiosk launch.
#
# How     : effective density should match TARGET_PPI, which is the density of
#           the 7" official Raspberry Pi touchscreen (800x480 @ ~133 PPI) — the
#           screen the v3 UI was tuned on. scale = physical_PPI / TARGET_PPI,
#           snapped to clean quarters so the resulting devicePixelRatio stays
#           crisp. Physical size + native resolution come from wlr-randr
#           (Wayland/wlroots: labwc, wayfire, sway) or xrandr (X11).
#
# Override: DISPLAY_SCALE in browser.conf (start-server exports it into this
#           script's env):
#             unset / "" / "auto"  -> auto-detect (default)
#             a number > 1         -> pin that scale, skip detection
#             "off" / 0 / <= 1     -> scaling disabled (emit nothing)
#
# This script is consumed by deploy/start-server at every boot (self-correcting
# if the panel is ever swapped) and run once by install.sh to report the pick.

# Force C numeric locale: awk's printf/sprintf honour LC_NUMERIC, so on a
# French/locale Pi the factor would format as "1,25" (comma) and Chromium's
# --force-device-scale-factor would reject it. C locale guarantees a period.
export LC_ALL=C

# Design baseline: the 7" official screen sits at ~133 PPI and the UI looks
# right there at scale 1. Scaling every panel to this effective density makes
# the fleet visually consistent. LOWER this constant to make everything
# physically larger across the board.
TARGET_PPI=130
SNAP_STEP=0.25   # snap the factor to clean quarters (crisp DPRs)
MAX_SCALE=3.0    # sanity cap against a bogus EDID

log() { echo "detect-display-scale: $*" >&2; }

# --- 0. Manual override ---------------------------------------------------
case "${DISPLAY_SCALE:-auto}" in
    auto|AUTO) ;;  # fall through to detection
    off|OFF|none|NONE)
        log "scaling disabled via DISPLAY_SCALE=$DISPLAY_SCALE"
        exit 0 ;;
    *)
        if awk -v v="$DISPLAY_SCALE" 'BEGIN { exit !(v + 0 > 1.0) }'; then
            log "using pinned DISPLAY_SCALE=$DISPLAY_SCALE"
            echo "$DISPLAY_SCALE"
        else
            log "DISPLAY_SCALE='$DISPLAY_SCALE' is <= 1 or invalid -> scaling disabled"
        fi
        exit 0 ;;
esac

# --- 1. Make sure the display tools can reach the session -----------------
: "${XDG_RUNTIME_DIR:=/run/user/$(id -u)}"
export XDG_RUNTIME_DIR
if [ -z "$WAYLAND_DISPLAY" ] && [ -d "$XDG_RUNTIME_DIR" ]; then
    for sock in "$XDG_RUNTIME_DIR"/wayland-[0-9]*; do
        # the socket is a unix socket (-S); skip the matching .lock regular file
        [ -S "$sock" ] || continue
        WAYLAND_DISPLAY=$(basename "$sock")
        export WAYLAND_DISPLAY
        break
    done
fi

# --- 2. Read "PHYS_WxPHYS_H RES_WxRES_H" from wlr-randr or xrandr ----------
# Physical size is in millimetres, resolution in pixels. PPI is derived from
# the diagonal, so panel rotation (transform 90/270) doesn't matter.
geom=""
if [ -n "$WAYLAND_DISPLAY" ] && command -v wlr-randr >/dev/null 2>&1; then
    geom=$(wlr-randr 2>/dev/null | awk '
        function flush() { if (chosen == "" && en == 1 && phys != "" && cur != "") { print phys, cur; chosen = 1 } }
        /^[^[:space:]]/        { flush(); en = 0; phys = ""; cur = "" }   # new output block
        /Physical size:/       { phys = $3 }                              # "135x216"
        /Enabled:[[:space:]]*yes/ { en = 1 }
        /current/              { if ($1 ~ /^[0-9]+x[0-9]+$/) cur = $1 }    # "800x1280"
        END { flush() }
    ')
    [ -n "$geom" ] && log "source=wlr-randr geom='$geom'"
fi

if [ -z "$geom" ] && command -v xrandr >/dev/null 2>&1; then
    geom=$(xrandr --query 2>/dev/null | awk '
        / connected/ {
            res = ""; wmm = ""; hmm = ""
            for (i = 1; i <= NF; i++) {
                if ($i ~ /^[0-9]+x[0-9]+\+[0-9]+\+[0-9]+$/) { split($i, a, "+"); res = a[1] }
                if ($i ~ /^[0-9]+mm$/ && $(i + 1) == "x" && $(i + 2) ~ /^[0-9]+mm$/) {
                    wmm = $i; hmm = $(i + 2); sub(/mm/, "", wmm); sub(/mm/, "", hmm)
                }
            }
            if (res != "" && wmm + 0 > 0 && hmm + 0 > 0) { print wmm "x" hmm, res; exit }
        }')
    [ -n "$geom" ] && log "source=xrandr geom='$geom'"
fi

if [ -z "$geom" ]; then
    log "no display geometry available (wlr-randr/xrandr missing, or panel reports no physical size) -> no scaling"
    exit 0
fi

# --- 3. Physical PPI -> snapped scale -------------------------------------
# geom is two space-separated tokens by construction (PHYS RES) — intentional word-split.
# shellcheck disable=SC2086
set -- $geom
scale=$(awk -v phys="$1" -v res="$2" -v target="$TARGET_PPI" -v step="$SNAP_STEP" -v maxs="$MAX_SCALE" '
    BEGIN {
        split(phys, p, "x"); wmm = p[1]; hmm = p[2]
        split(res,  r, "x"); pw = r[1];  ph = r[2]
        if (wmm <= 0 || hmm <= 0 || pw <= 0 || ph <= 0) { exit 1 }
        diag_px = sqrt(pw * pw + ph * ph)
        diag_in = sqrt(wmm * wmm + hmm * hmm) / 25.4
        ppi = diag_px / diag_in
        raw = ppi / target
        snapped = int(raw / step + 0.5) * step
        if (snapped > maxs) snapped = maxs
        if (snapped <= 1.0) {
            printf "detect-display-scale: PPI=%.0f raw=%.3f -> 1.0 (no scaling needed)\n", ppi, raw > "/dev/stderr"
            exit 2
        }
        printf "detect-display-scale: PPI=%.0f raw=%.3f -> scale %.2f\n", ppi, raw, snapped > "/dev/stderr"
        s = sprintf("%.2f", snapped); sub(/0+$/, "", s); sub(/\.$/, "", s)  # trim 1.50 -> 1.5, 1.00 -> 1
        print s
    }')

if [ -z "$scale" ]; then
    exit 0   # density at/below baseline, or bogus geometry -> leave display untouched
fi
echo "$scale"
