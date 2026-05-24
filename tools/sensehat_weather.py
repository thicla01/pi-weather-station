#!/usr/bin/env python3
"""
Pi Weather Station — Sense HAT Display
Reads current weather from the pi-weather-station local API and renders
weather state animations on the Sense HAT 8×8 RGB LED matrix.

IMPORTANT — exclusive HAT access
  This script takes exclusive control of the Sense HAT LED matrix.
  Any other program writing to the HAT (clock display, demos, etc.)
  must be disabled before enabling this service to avoid display
  conflicts. Check for running services with:
    systemctl --user list-units | grep -iE 'sense|hat'

Configuration: edit the constants in the CONFIG section below.

Installation:
  sudo apt-get install sense-hat
  pip3 install requests   # usually already available via sense-hat

Systemd service (managed by install.sh, or manually):
  cp deploy/pi-sensehat.service ~/.config/systemd/user/
  systemctl --user enable --now pi-sensehat
"""

import glob
import logging
import math
import os
import struct
import subprocess
import sys
import time
import urllib3

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [sensehat] %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

try:
    from sense_hat import SenseHat
except Exception as exc:
    log.error("Cannot initialize Sense HAT: %s", exc)
    log.error("Verify that the Sense HAT is physically attached and that")
    log.error("the sense-hat package is installed (sudo apt-get install sense-hat).")
    log.error("To disable this service: systemctl --user disable pi-sensehat")
    raise SystemExit(1)

# ── CONFIG ────────────────────────────────────────────────────────────────────

SERVER_URL    = "https://localhost:8443"  # pi-weather-station server (same Pi)
# Poll cadence. 60 s lets us pick up an incoming gov alert within a
# minute of it appearing in the ECCC / NWS feed — short enough that a
# tornado warning doesn't sit invisible for 10 minutes, long enough
# that the server's internal alert-source caches (5 min TTL) absorb
# most calls without an upstream fetch. Weather state from
# `/api/sensehat` is fetched in the same call but updates slowly; the
# "Updated" log line below is gated on actual state change so the
# faster cadence doesn't add log noise.
POLL_INTERVAL = 60                       # seconds between /api/sensehat calls
FRAME_DELAY   = 0.12                     # seconds between animation frames

# Rotation of the LED matrix (degrees): 0 / 90 / 180 / 270.
# Adjust so that the top of the display matches your physical mount.
# On a Pi 4B with USB-C/HDMI pointing up: try 180.
ROTATION = 180

BRIGHTNESS_DAY   = 1.0   # LED brightness 0.0–1.0 (daytime)
BRIGHTNESS_NIGHT = 0.35  # dimmer at night (avoids glare in the dark)

# Time window before sunset during which the sunset frame is shown (seconds).
SUNSET_WINDOW_SEC = 30 * 60  # 30 minutes

# Sun travels from east (left) to west (right) across the display.
# Set to False if east is on the right side for your physical mount.
SUN_EAST_LEFT = True

# Duration of each state in test mode (seconds).
TEST_STATE_DURATION = 15

# Retry-with-backoff policy at startup. Used to absorb the typical race where
# pi-sensehat starts before pi-weather-server is ready to answer HTTPS — the
# display stays blank until the first successful fetch rather than rendering
# a misleading default scene (e.g. midday sun at midnight).
# Total worst-case wait with the values below: ~120 s across 8 attempts
# (1, 2, 4, 8, 16, 30, 30, 30 seconds between tries).
STARTUP_FETCH_MAX_ATTEMPTS  = 8
STARTUP_FETCH_INITIAL_DELAY = 1.0
STARTUP_FETCH_MAX_DELAY     = 30.0

# ──────────────────────────────────────────────────────────────────────────────

# Suppress InsecureRequestWarning for the self-signed localhost certificate.
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


# ── COLORS ────────────────────────────────────────────────────────────────────

SKY_BLUE    = (  0, 100, 200)
SUN_YELLOW  = (255, 200,   0)
SUNSET_RED  = (220,  60,   0)
NIGHT_SKY   = (  0,   0,  25)
STAR_WHITE  = (240, 240, 200)
CLOUD_LIGHT = (160, 160, 165)
CLOUD_DARK  = (100, 100, 108)
GREY_LIGHT  = (140, 140, 145)
GREY_MID    = (105, 105, 110)
GREY_DARK   = ( 70,  70,  75)
FOG_COLOR   = (190, 195, 205)
RAIN_BG     = ( 25,  45,  70)
RAIN_DROP   = ( 60, 140, 255)
SNOW_BG     = (110, 120, 140)
SNOW_FLAKE  = (220, 230, 255)
STORM_BG    = ( 35,  35,  45)
LIGHTNING   = (255, 225,   0)
ICE_BG      = ( 20,  40,  65)
ICE_PELLET  = ( 80, 200, 255)  # bright cyan — distinct from white snow flakes
OFF         = (  0,   0,   0)

# Short aliases for the static frame tables below
B  = SKY_BLUE
Y  = SUN_YELLOW
R  = SUNSET_RED
N  = NIGHT_SKY
S  = STAR_WHITE
CL = CLOUD_LIGHT
CD = CLOUD_DARK
GL = GREY_LIGHT
GM = GREY_MID
GD = GREY_DARK
L  = LIGHTNING
X  = STORM_BG


# ── STATIC FRAMES (64-element flat lists of RGB tuples) ───────────────────────

# ☀️  Clear sky — day: blue sky with 2×2 yellow sun; position varies by time of day.
# ☀️  Sunset: same as clear_day but with 4 red pixels at the bottom row (horizon glow).
# Both are built dynamically by _clear_day_frame() / _sunset_frame() using sun_row.

# 🌙  Clear sky — night. Pre-2026-05 this was a static frame (black
# background + scattered warm-white stars at fixed brightness). The
# new `_clear_night_frame(tick)` builder below animates the same star
# positions with two effects:
#   1. Each star independently pulses brightness on a slow sine cycle
#      (~4 s) with a per-star phase offset, giving the screen a
#      breathing "alive" feel that the static frame lacked.
#   2. Every ~90 s a shooting star streaks diagonally across the
#      grid (~1.4 s total) — a brief delightful moment that you'd
#      catch only if you happened to glance at the HAT.
# Both effects are subtle by design: stars never fully extinguish
# (floor at 40 % brightness), and the shooting star is short enough
# that it reads as a "did I just see that?" event rather than a
# distraction.
FRAME_CLEAR_NIGHT = [
    N,  N,  S,  N,  N,  N,  S,  N,
    N,  N,  N,  N,  S,  N,  N,  N,
    S,  N,  N,  N,  N,  N,  N,  S,
    N,  N,  N,  S,  N,  N,  N,  N,
    N,  S,  N,  N,  N,  N,  S,  N,
    N,  N,  N,  N,  S,  N,  N,  N,
    N,  N,  S,  N,  N,  S,  N,  N,
    S,  N,  N,  N,  N,  N,  N,  N,
]

# Extracted star positions (row, col) from FRAME_CLEAR_NIGHT above,
# in source order. The animation builder uses the list index as the
# per-star phase offset so adjacent stars never twinkle in lockstep.
_NIGHT_STARS = [
    (0, 2), (0, 6),
    (1, 4),
    (2, 0), (2, 7),
    (3, 3),
    (4, 1), (4, 6),
    (5, 4),
    (6, 2), (6, 5),
    (7, 0),
]

# Twinkle parameters. The cycle is intentionally slow — fast pulsing
# reads as "broken pixel" rather than "stars in the sky". The floor
# is held at 0.65, not 0.40 as in the initial design, because the
# Sense HAT pipeline multiplies again by BRIGHTNESS_NIGHT (0.35) at
# render time: floor 0.40 × 0.35 = 14 % effective brightness, which
# is below the Sense HAT LED's visibility threshold and reads as
# "off" — defeats the point of subtle twinkling. Floor 0.65 keeps
# the dim phase at ~23 % effective brightness, clearly visible while
# still producing a ~12 % perceptible swing against the ceiling.
_STAR_TWINKLE_PERIOD_TICKS = 33   # ~4 s at FRAME_DELAY=0.12 s
_STAR_BRIGHTNESS_FLOOR = 0.65     # never fully dark (stars don't blink off)
_STAR_BRIGHTNESS_CEILING = 1.00

# Shooting-star parameters. Diagonal path top-right → bottom-left
# (visually right-to-left + top-to-bottom, the conventional Western
# direction for shooting-star drawings). The streak is one bright
# head pixel + a 2-pixel decaying trail behind.
_SHOOTING_STAR_PERIOD_TICKS = 750     # ~90 s at FRAME_DELAY=0.12 s
_SHOOTING_STAR_DURATION_TICKS = 12    # ~1.4 s start to finish
_SHOOTING_STAR_TRAIL_LEN = 3          # head + 2 trailing pixels

# 🌤  Partly cloudy — day: blue sky with grey cloud on upper half
FRAME_PARTLY_CLOUDY_DAY = [
    B,  B,  CL, CL, CL, CL, B,  B,
    B,  CL, CL, CL, CL, CL, CL, B,
    B,  CL, CD, CD, CD, CD, CL, B,
    B,  B,  CD, CD, CD, CD, B,  B,
    B,  B,  B,  B,  B,  B,  B,  B,
    B,  B,  B,  B,  B,  B,  B,  B,
    B,  B,  B,  B,  B,  B,  B,  B,
    B,  B,  B,  B,  B,  B,  B,  B,
]

# 🌤🌙  Partly cloudy — night: same cloud on dark sky with stars peeking
# below. Pre-2026-05 this was rendered as the static frame below; it is now
# built dynamically by `_partly_cloudy_night_frame(tick)` so the cloud
# drifts horizontally and the stars beneath twinkle. The constant is kept
# as documentation of the canonical star positions, which are extracted
# into `_PARTLY_CLOUDY_NIGHT_STARS` for the animated builder.
FRAME_PARTLY_CLOUDY_NIGHT = [
    N,  N,  CL, CL, CL, CL, N,  N,
    N,  CL, CL, CL, CL, CL, CL, N,
    N,  CL, CD, CD, CD, CD, CL, N,
    N,  N,  CD, CD, CD, CD, N,  N,
    N,  N,  N,  N,  N,  N,  N,  N,
    S,  N,  N,  S,  N,  N,  N,  S,
    N,  N,  S,  N,  N,  N,  N,  N,
    N,  N,  N,  N,  S,  N,  S,  N,
]

# Base cloud shape (row, col, color) shared by `_partly_cloudy_day_frame`
# and `_partly_cloudy_night_frame`. The animated builders apply a
# horizontal offset modulo 8, so the cloud drifts across the screen and
# wraps at the edge — when half the cloud exits on the right, the other
# half re-enters from the left, giving the illusion of an endless
# parade of clouds across the sky.
_CLOUD_BASE_PIXELS = [
    (0, 2, CL), (0, 3, CL), (0, 4, CL), (0, 5, CL),
    (1, 1, CL), (1, 2, CL), (1, 3, CL), (1, 4, CL), (1, 5, CL), (1, 6, CL),
    (2, 1, CL), (2, 2, CD), (2, 3, CD), (2, 4, CD), (2, 5, CD), (2, 6, CL),
    (3, 2, CD), (3, 3, CD), (3, 4, CD), (3, 5, CD),
]

# Drift rate. 100 ticks @ FRAME_DELAY=0.12 s ≈ 12 s per pixel of drift,
# so a full 8-px traversal takes ~1.6 minutes. The pace is intentionally
# slow — fast enough that a 30-second glance reveals motion, slow enough
# that a quick look reads as a still picture rather than a screensaver.
_CLOUD_DRIFT_PERIOD_TICKS = 100

# Star positions for partly-cloudy night, extracted from
# `FRAME_PARTLY_CLOUDY_NIGHT` above. All sit in rows 5-7 because the
# upper half of the sky is occluded by the drifting cloud. The animated
# builder twinkles these on the same sine cycle as the clear-night
# stars.
_PARTLY_CLOUDY_NIGHT_STARS = [
    (5, 0), (5, 3), (5, 7),
    (6, 2),
    (7, 4), (7, 6),
]

# ☁️  Overcast: textured grey checkerboard to suggest thick cloud
# cover. Pre-2026-05 this was the rendered frame; it's now built
# dynamically by `_overcast_frame(tick)` so the three grey shades
# roll across the matrix in diagonal waves. Kept as documentation of
# the canonical three-tone palette (GL / GM / GD) that the wave
# interpolation reproduces in motion.
FRAME_OVERCAST = [
    GL, GM, GL, GM, GL, GM, GL, GM,
    GM, GD, GM, GD, GM, GD, GM, GD,
    GL, GM, GD, GM, GD, GM, GD, GM,
    GM, GL, GM, GL, GM, GL, GM, GL,
    GD, GM, GL, GM, GL, GM, GL, GM,
    GM, GD, GM, GD, GM, GD, GM, GD,
    GL, GM, GD, GM, GD, GM, GD, GM,
    GM, GL, GM, GL, GM, GL, GM, GL,
]

# 🌫  Fog: uniform pale grey-blue. Now built dynamically by
# `_fog_frame(tick)` so the matrix breathes — all 64 pixels modulate
# together between 55 % and 100 % brightness on a 6 s sine cycle.
# This constant is the peak-brightness reference (what the breathing
# pulse equals at its maximum).
FRAME_FOG = [FOG_COLOR] * 64

# ⛈  Thunderstorm: background + static lightning bolt (flashed on/off)
LIGHTNING_BOLT = [
    X,  X,  X,  L,  X,  X,  X,  X,
    X,  X,  X,  L,  L,  X,  X,  X,
    X,  X,  L,  L,  X,  X,  X,  X,
    X,  X,  L,  X,  X,  X,  X,  X,
    X,  L,  L,  X,  X,  X,  X,  X,
    X,  L,  X,  X,  X,  X,  X,  X,
    L,  L,  X,  X,  X,  X,  X,  X,
    L,  X,  X,  X,  X,  X,  X,  X,
]


# ── DYNAMIC SUN FRAMES ───────────────────────────────────────────────────────

def _compute_sun_pos(sunrise_ts, sunset_ts):
    """
    Return (sun_row, sun_col) of the top-left corner of the 2×2 sun block.

    Vertical arc (sine):
      row 6 at sunrise/sunset (horizon) → row 0 at solar noon (zenith).
    Horizontal drift (linear):
      col 0 at sunrise (east) → col 3 at noon (centre) → col 6 at sunset (west).
      Reversed when SUN_EAST_LEFT is False.

    @param sunrise_ts: int|None — Unix timestamp in milliseconds
    @param sunset_ts:  int|None — Unix timestamp in milliseconds
    @returns: tuple (row int 0–6, col int 0–6)
    """
    if sunrise_ts is None or sunset_ts is None:
        return 1, 3  # default: near top-centre
    now_ms   = time.time() * 1000
    total_ms = sunset_ts - sunrise_ts
    if total_ms <= 0:
        return 1, 3
    # progress: 0.0 = sunrise, 0.5 = solar noon, 1.0 = sunset
    progress = max(0.0, min(1.0, (now_ms - sunrise_ts) / total_ms))
    sun_row = round(6.0 * (1.0 - math.sin(progress * math.pi)))
    sun_col = round(6.0 * progress) if SUN_EAST_LEFT else round(6.0 * (1.0 - progress))
    return sun_row, sun_col


def _sun_color(sun_row):
    """
    Interpolate the sun colour from yellow (zenith) to red (horizon).

    sun_row 0 → SUN_YELLOW (255, 200, 0)   noon / high sun
    sun_row 3 → orange     (~237, 130, 0)  mid-morning / mid-afternoon
    sun_row 6 → SUNSET_RED (220,  60, 0)   sunrise / sunset horizon

    @param sun_row: int  top row of the sun (0–6)
    @returns: tuple  (r, g, b)
    """
    t = sun_row / 6.0  # 0.0 at zenith → 1.0 at horizon
    r = round(SUN_YELLOW[0] + t * (SUNSET_RED[0] - SUN_YELLOW[0]))
    g = round(SUN_YELLOW[1] + t * (SUNSET_RED[1] - SUN_YELLOW[1]))
    b = round(SUN_YELLOW[2] + t * (SUNSET_RED[2] - SUN_YELLOW[2]))
    return (r, g, b)


def _clear_day_frame(sun_row, sun_col):
    """
    Blue sky with a 2×2 sun block at (sun_row, sun_col).
    Sun colour shifts from yellow at noon to orange/red near the horizon.

    @param sun_row: int  top row of the sun (0–6); 0=zenith, 6=horizon
    @param sun_col: int  left col of the sun (0–6); 0=east, 6=west
    @returns: list  64-element flat list of RGB tuples
    """
    frame = [B] * 64
    color = _sun_color(sun_row)
    for dr in range(2):
        r = sun_row + dr
        if r < 8:
            for dc in range(2):
                c = sun_col + dc
                if c < 8:
                    frame[r * 8 + c] = color
    return frame


def _cloud_offset(tick):
    """Return the current horizontal cloud-drift offset in [0, 7].
    Increments by 1 every `_CLOUD_DRIFT_PERIOD_TICKS` ticks, then wraps.
    Used by both partly-cloudy builders so the day and night versions
    drift at exactly the same rate.
    """
    return (tick // _CLOUD_DRIFT_PERIOD_TICKS) % 8


def _draw_cloud(frame, offset):
    """Overlay `_CLOUD_BASE_PIXELS` onto `frame` with a horizontal shift
    of `offset` columns, wrapping at the edge so the cloud appears to
    drift continuously across the screen.
    """
    for r, c, color in _CLOUD_BASE_PIXELS:
        frame[r * 8 + ((c + offset) % 8)] = color


def _partly_cloudy_day_frame(sun_row, sun_col, tick):
    """
    Blue sky with the dynamic sun at (sun_row, sun_col) and a grey cloud
    drifting horizontally across the upper portion. The cloud draws on
    top of the sky+sun base, so when the sun is high (rows 0–3) it is
    partially or fully hidden as the cloud passes over it — just like
    real partly-cloudy conditions where the sun ducks behind a cloud.

    @param sun_row: int  top row of the sun (0–6)
    @param sun_col: int  left col of the sun (0–6)
    @param tick:    int  animation frame counter — drives cloud drift
    @returns: list  64-element flat list of RGB tuples
    """
    frame = _clear_day_frame(sun_row, sun_col)
    _draw_cloud(frame, _cloud_offset(tick))
    # Horizon glow when sun is low — same behaviour as sunset frame
    if sun_row >= 4:
        for c in range(max(0, sun_col - 1), min(8, sun_col + 3)):
            frame[7 * 8 + c] = R
    return frame


def _partly_cloudy_night_frame(tick):
    """
    Dark sky with twinkling stars in the lower half (rows 5–7) and a
    drifting cloud occluding the upper half. The cloud uses the same
    base shape and drift period as the day version, and the stars use
    the same sine-pulse twinkle as the clear-night frame (slightly
    different positions because the upper half is occupied by the
    cloud).

    No shooting star here — its diagonal path runs through the cloud
    occlusion zone, so it would visibly clip in and out and look broken.
    The clear-night frame keeps the shooting star to itself.

    @param tick: int — animation frame counter
    @returns: list — 64-element flat list of RGB tuples
    """
    frame = [NIGHT_SKY] * 64

    # ── Twinkling stars (lower half only) ─────────────────────────
    amplitude = _STAR_BRIGHTNESS_CEILING - _STAR_BRIGHTNESS_FLOOR
    for i, (row, col) in enumerate(_PARTLY_CLOUDY_NIGHT_STARS):
        phase = (tick / _STAR_TWINKLE_PERIOD_TICKS
                 + i / len(_PARTLY_CLOUDY_NIGHT_STARS)) * 2 * math.pi
        brightness = _STAR_BRIGHTNESS_FLOOR + amplitude * (math.sin(phase) + 1.0) / 2.0
        frame[row * 8 + col] = _scale_color(STAR_WHITE, brightness)

    # ── Drifting cloud (upper half) ────────────────────────────────
    _draw_cloud(frame, _cloud_offset(tick))

    return frame


def _scale_color(rgb, brightness):
    """Multiply each channel of an RGB tuple by a 0.0–1.0 factor.
    Clamped to [0, 255] so the math can't overflow into invalid pixels.
    Returned as a tuple so the SenseHat library accepts it directly.
    """
    return tuple(max(0, min(255, int(round(c * brightness)))) for c in rgb)


def _clear_night_frame(tick):
    """Animated night sky: same star positions as the original
    `FRAME_CLEAR_NIGHT` constant, plus per-star twinkle (slow sine
    pulse) and an occasional shooting star streak.

    @param tick: int — animation frame counter, monotonically incremented
                       once per FRAME_DELAY in the main loop.
    @returns: list — 64-element flat list of RGB tuples
    """
    frame = [NIGHT_SKY] * 64

    # ── Twinkling stars ───────────────────────────────────────────
    # Each star pulses on the same period but with a phase offset
    # derived from its index, so they never all peak together. The
    # brightness curve is `floor + amplitude × (sin(...) + 1) / 2`
    # which spans cleanly between floor and floor+amplitude with no
    # overshoot.
    amplitude = _STAR_BRIGHTNESS_CEILING - _STAR_BRIGHTNESS_FLOOR
    for i, (row, col) in enumerate(_NIGHT_STARS):
        # Phase: each star is offset by 2π × (i / N) within the cycle.
        # Sin input cycles 0 → 2π every _STAR_TWINKLE_PERIOD_TICKS frames.
        phase = (tick / _STAR_TWINKLE_PERIOD_TICKS + i / len(_NIGHT_STARS)) * 2 * math.pi
        brightness = _STAR_BRIGHTNESS_FLOOR + amplitude * (math.sin(phase) + 1.0) / 2.0
        frame[row * 8 + col] = _scale_color(STAR_WHITE, brightness)

    # ── Shooting star ─────────────────────────────────────────────
    # `tick % PERIOD` gives the current position within a 90-second
    # cycle. The streak only renders during the first
    # DURATION ticks of that cycle (≈ 1.4 s out of 90 s). The rest of
    # the cycle is "calm" — just twinkling stars.
    phase_in_cycle = tick % _SHOOTING_STAR_PERIOD_TICKS
    if phase_in_cycle < _SHOOTING_STAR_DURATION_TICKS:
        # Head position: top-right → bottom-left diagonal. At t=0 the
        # head is at (row 0, col 7); at t=DURATION-1 it's at
        # (row ≈ 7, col ≈ 0). Linear interpolation.
        progress = phase_in_cycle / max(1, _SHOOTING_STAR_DURATION_TICKS - 1)
        head_row = round(7 * progress)
        head_col = round(7 * (1.0 - progress))
        # Bright head + dim trail. Each trail pixel sits one step
        # behind the head along the same diagonal (so the trail
        # "follows" naturally as the head advances).
        for t in range(_SHOOTING_STAR_TRAIL_LEN):
            r = head_row - t
            c = head_col + t
            if 0 <= r < 8 and 0 <= c < 8:
                # Head = 100 %, trail decays linearly to ~20 %.
                pixel_brightness = 1.0 - 0.4 * t
                frame[r * 8 + c] = _scale_color(STAR_WHITE, pixel_brightness)

    return frame


# ── GOV ALERT OVERRIDE ───────────────────────────────────────────────────────
#
# Active gov alert (ECCC / NWS) of severity ≥ moderate takes precedence
# over every other display state. The whole 8×8 matrix becomes a slow
# sinusoidal breathing pulse in the tier colour — red for extreme /
# severe (tornado, severe thunderstorm), orange for moderate (winter
# storm warning, freeze warning). Yellow-tier minor advisories don't
# trigger the override (filtered server-side in `sensehatCtrl`); they
# would be routine and just spam the LED matrix.
#
# Two design choices worth flagging for future maintainers:
#   1. Full-matrix override rather than a coloured border around the
#      weather frame. The compromise version was tried in mockups and
#      reads as "fancy weather decoration" rather than "look at me" —
#      not what an alert needs to convey at 3 a.m. across a dark room.
#   2. Red pulses faster (~3 s) than orange (~4 s). Period encodes
#      urgency, not just colour — a glance picks up "urgent" vs
#      "preoccupant" even before the eye registers the hue.

_ALERT_COLORS = {
    "red":    (255,  30,  30),   # extreme / severe — tornado, hurricane, severe T-storm
    "orange": (255, 140,   0),   # moderate         — winter storm warning, freeze, etc.
}
_ALERT_PULSE_PERIOD_TICKS = {
    "red":    25,                 # ~3 s at FRAME_DELAY=0.12 s
    "orange": 33,                 # ~4 s at FRAME_DELAY=0.12 s
}
# Floor lifted to 0.50 (rather than the star-twinkle 0.65) because the
# whole matrix is lit here — at 0.65 the "off" phase is barely
# distinguishable from "on" so the pulse vanishes. 0.50 gives a clearly
# perceptible 50 → 100 % swing without the dim phase reading as off.
_ALERT_BRIGHTNESS_FLOOR = 0.50
_ALERT_BRIGHTNESS_CEILING = 1.00


def _alert_frame(tier, tick):
    """Full-matrix breathing pulse in the alert tier colour.

    @param tier: str  "red" or "orange" (validated server-side)
    @param tick: int  animation frame counter
    @returns: list    64-element flat list of RGB tuples
    """
    base = _ALERT_COLORS.get(tier, _ALERT_COLORS["red"])
    period = _ALERT_PULSE_PERIOD_TICKS.get(tier, _ALERT_PULSE_PERIOD_TICKS["red"])
    amplitude = _ALERT_BRIGHTNESS_CEILING - _ALERT_BRIGHTNESS_FLOOR
    phase = (tick / period) * 2 * math.pi
    brightness = _ALERT_BRIGHTNESS_FLOOR + amplitude * (math.sin(phase) + 1.0) / 2.0
    return [_scale_color(base, brightness)] * 64


def _sunset_frame(sun_row, sun_col):
    """
    Clear day sky + red horizon glow when the sun is low (sun_row >= 4).
    The glow follows the sun's horizontal position.

    @param sun_row: int  top row of the sun (0–6)
    @param sun_col: int  left col of the sun (0–6)
    @returns: list  64-element flat list of RGB tuples
    """
    frame = _clear_day_frame(sun_row, sun_col)
    if sun_row >= 4:
        # 4-pixel glow centred just below the sun, clamped to display edges
        for c in range(max(0, sun_col - 1), min(8, sun_col + 3)):
            frame[7 * 8 + c] = R
    return frame


# ── ANIMATED FRAME BUILDERS ───────────────────────────────────────────────────

# Rain drop column definitions: (col, phase_offset, drop_length)
_RAIN_DROPS = [
    (0, 0, 3), (2, 3, 2), (4, 6, 3), (6, 1, 2),
    (1, 5, 2), (5, 2, 3), (7, 4, 2),
]

# Snow flake column definitions: (col, phase_offset)
_SNOW_FLAKES = [(0, 0), (2, 5), (4, 2), (6, 8), (1, 3), (5, 7), (7, 1)]

# Ice pellet column definitions: (col, phase_offset)
# Fewer columns than rain/snow because each pellet is 2 pixels wide.
_ICE_PELLETS = [(0, 0), (3, 4), (5, 2), (1, 6)]


def _rain_frame(tick, light=False):
    """Rain animation: drops fall from top to bottom at different phases."""
    grid = [RAIN_BG] * 64
    for col, offset, base_len in _RAIN_DROPS:
        drop_len = max(1, base_len - (1 if light else 0))
        period = 8 + drop_len
        pos = (tick + offset) % period
        for d in range(drop_len):
            row = pos - drop_len + d
            if 0 <= row < 8:
                # Brightest at the leading edge (bottom of drop)
                brightness = (d + 1) / drop_len
                grid[row * 8 + col] = tuple(
                    int(c * brightness) for c in RAIN_DROP
                )
    return grid


def _snow_frame(tick):
    """Snow animation: flakes fall at half the rain speed."""
    grid = [SNOW_BG] * 64
    period = 10
    for col, offset in _SNOW_FLAKES:
        row = (tick // 2 + offset) % period
        if 0 <= row < 8:
            grid[row * 8 + col] = SNOW_FLAKE
    return grid


def _storm_frame(tick):
    """Thunderstorm: lightning bolt flashes on for 2 frames, off for 8."""
    if tick % 10 < 2:
        return list(LIGHTNING_BOLT)
    return [STORM_BG] * 64


def _ice_frame(tick):
    """
    Freezing rain / ice pellets: bright-cyan 2-pixel-wide drops on dark background.
    Wider and a different colour than snow flakes (white single-pixel on grey).
    Falls at full tick speed — faster than snow (tick // 2).
    """
    grid = [ICE_BG] * 64
    period = 8  # shorter than snow for a faster, harder fall
    for col, offset in _ICE_PELLETS:
        row = (tick + offset) % period
        if 0 <= row < 8:
            grid[row * 8 + col] = ICE_PELLET
            # 2-pixel-wide pellet — suggests a hard, round ice pellet vs a soft flake
            if col + 1 < 8:
                grid[row * 8 + col + 1] = ICE_PELLET
    return grid


# ── OVERCAST / FOG ANIMATION PARAMETERS ──────────────────────────────────────
#
# Overcast: diagonal rolling waves through the three canonical grey
# shades (GREY_DARK ↔ GREY_MID ↔ GREY_LIGHT). Each pixel's brightness
# is modulated by sin((row + col) × spatial − tick × 2π / period), so
# bands of brightness drift south-west → north-east across the matrix
# in a way that evokes overcast clouds shifting overhead. The sine
# midpoint lands exactly on GREY_MID, so the wave passes through all
# three shades of the original static checkerboard frame — same
# palette, just animated.
#
# Fog: uniform breathing pulse — all 64 pixels exhale together on a
# slow sine cycle. Period 6 s (slower than the 4 s star twinkle)
# because fog feels heavy / dense; a faster pulse reads as nervous.
# Floor at 55 % keeps the dim phase clearly visible after the
# BRIGHTNESS_NIGHT (0.35) multiplier — 0.55 × 0.35 = 19 % effective,
# above the visibility threshold the star twinkle calibration
# established earlier.

_OVERCAST_WAVE_PERIOD_TICKS = 100        # ~12 s for one full sine cycle
_OVERCAST_WAVE_SPATIAL = math.pi / 8     # radians of phase per (row + col) step

_FOG_BREATH_PERIOD_TICKS = 50            # ~6 s for one full breath cycle
_FOG_BRIGHTNESS_FLOOR = 0.55
_FOG_BRIGHTNESS_CEILING = 1.00

# Per-pixel dither used by `_fog_frame`. First attempt (commit
# 44ae526) used an 8×8 Bayer matrix, which fixed the strobe but
# introduced a different artifact: Bayer's structured high-frequency
# values cluster into checkered diagonals, so as the base brightness
# rose certain pixel groups crossed quantization thresholds in
# sequence — the eye read this as raindrops falling on top of the
# fog. The fix is to use unstructured per-pixel noise instead:
# each of the 64 pixels gets a fixed offset drawn from a seeded RNG,
# so the spatial pattern at any one moment is just static noise
# (uniformly distributed brightnesses) with no directional bias to
# read as motion.
#
# Seed 42 is arbitrary but fixed for reproducibility — same pattern
# on every restart, same field-test reference image.
#
# Dither magnitude `_FOG_DITHER_AMPLITUDE = 0.042` is calibrated to
# ±0.5 of one RGB565 R-quantization step at peak FOG_COLOR (8 RGB888
# units of R-precision is 8/190 ≈ 0.042 in brightness units). Spread
# of one full step means there's always a near-equal split of pixels
# above/below any given threshold, so the matrix transitions through
# the threshold smoothly as base brightness shifts.
_FOG_DITHER_AMPLITUDE = 0.042
import random as _random
_FOG_PIXEL_DITHER = [
    (_random.Random(42 + i).random() - 0.5) * _FOG_DITHER_AMPLITUDE
    for i in range(64)
]
del _random

# ── FOG density drift (D-A: continuous secondary effect) ─────────────
#
# Slow horizontal wave layered on top of the breath. Adds ±4 % of
# brightness to each pixel depending on its column and a slow
# time-drift, so denser/thinner patches of fog seem to glide
# horizontally across the matrix at ~one matrix-width per 60 s. The
# breath remains the dominant effect; this gives the fog spatial
# character (real fog isn't uniform — pockets vary) and a sense of
# wind-driven motion without competing with the unified pulse.
_FOG_DRIFT_PERIOD_TICKS  = 500       # ~60 s for one full drift cycle
_FOG_DRIFT_SPATIAL       = math.pi / 4   # one wavelength fits ~the matrix
_FOG_DRIFT_AMPLITUDE     = 0.04      # ±4 % brightness per column

# ── FOG rift (D-B: occasional surprise event) ────────────────────────
#
# Every _FOG_RIFT_PERIOD_TICKS, a brighter zone slides horizontally
# across the matrix in _FOG_RIFT_DURATION_TICKS — like a brief patch
# of sunlight breaking through the fog. The boost is Gaussian-shaped
# in horizontal position so the brighter zone has soft edges that
# blend into the surrounding mist rather than a hard-edged spotlight.
# Same philosophy as the clear-night shooting star: 95 % of the time
# the animation is calm, every minute or two a delightful event you'd
# only catch if you happened to be glancing.
_FOG_RIFT_PERIOD_TICKS   = 750       # ~90 s between rift events
_FOG_RIFT_DURATION_TICKS = 25        # ~3 s for the rift to traverse
_FOG_RIFT_WIDTH_SIGMA    = 1.2       # Gaussian falloff in columns
_FOG_RIFT_MAX_BOOST      = 0.15      # peak brightness boost at rift centre


def _fog_density_offset(col, tick):
    """Slow horizontal-drift density variation. Returns a brightness
    offset in [-_FOG_DRIFT_AMPLITUDE, +_FOG_DRIFT_AMPLITUDE] for the
    given column at the given tick.
    """
    return math.sin(
        col * _FOG_DRIFT_SPATIAL
        + tick * 2 * math.pi / _FOG_DRIFT_PERIOD_TICKS
    ) * _FOG_DRIFT_AMPLITUDE


def _fog_rift_offset(col, tick):
    """Occasional traversing rift (sunlight breaking through fog).
    Returns a brightness boost in [0, _FOG_RIFT_MAX_BOOST] for the
    given column at the given tick. Returns 0 when no rift is active.

    The rift centre travels from column -2 (off-screen left) to
    column +9 (off-screen right) over `_FOG_RIFT_DURATION_TICKS`, so
    the rift enters and exits the matrix smoothly without popping in
    at the edge. Gaussian falloff with sigma = `_FOG_RIFT_WIDTH_SIGMA`
    softens the brighter zone's edges.
    """
    phase_in_cycle = tick % _FOG_RIFT_PERIOD_TICKS
    if phase_in_cycle >= _FOG_RIFT_DURATION_TICKS:
        return 0.0
    progress = phase_in_cycle / max(1, _FOG_RIFT_DURATION_TICKS - 1)
    rift_centre = -2 + progress * 11.0     # -2 → +9 over the duration
    distance = col - rift_centre
    gauss = math.exp(-(distance * distance) / (2 * _FOG_RIFT_WIDTH_SIGMA ** 2))
    return _FOG_RIFT_MAX_BOOST * gauss


def _overcast_frame(tick):
    """Rolling diagonal wave through GREY_DARK ↔ GREY_MID ↔ GREY_LIGHT.

    Brightness at pixel (row, col) on tick `tick` follows
    `sin((row + col) × _OVERCAST_WAVE_SPATIAL − tick × 2π / period)`.
    The diagonal phase term `(row + col)` produces bands perpendicular
    to the anti-diagonal; the time term advances those bands across
    the matrix tick by tick. The sine midpoint is reached at exactly
    GREY_MID (interpolated halfway between GREY_DARK and GREY_LIGHT),
    so the wave reproduces the static checkerboard's three-tone
    palette in smooth transition.

    @param tick: int — animation frame counter
    @returns: list — 64-element flat list of RGB tuples
    """
    frame = []
    for row in range(8):
        for col in range(8):
            wave = math.sin(
                (row + col) * _OVERCAST_WAVE_SPATIAL
                - (tick * 2 * math.pi / _OVERCAST_WAVE_PERIOD_TICKS)
            )
            t = (wave + 1.0) / 2.0  # map sin range [-1, 1] to [0, 1]
            r_chan = round(GREY_DARK[0] + t * (GREY_LIGHT[0] - GREY_DARK[0]))
            g_chan = round(GREY_DARK[1] + t * (GREY_LIGHT[1] - GREY_DARK[1]))
            b_chan = round(GREY_DARK[2] + t * (GREY_LIGHT[2] - GREY_DARK[2]))
            frame.append((r_chan, g_chan, b_chan))
    return frame


def _fog_frame(tick):
    """Layered fog animation:
      1. Unified breath (6 s sine cycle, full matrix in lockstep) —
         the dominant effect, gives the fog its "exhaling" character.
      2. Slow horizontal density drift (60 s cycle, ±4 % brightness
         per column) — denser/thinner patches glide across the matrix
         as if the fog were drifting on a light wind.
      3. Occasional Gaussian-shaped rift (every ~90 s, ~3 s traversal,
         +15 % brightness at the peak) — a brief patch where sunlight
         breaks through, soft-edged so it blends rather than spotlights.
      4. Static random per-pixel dither — kills the RGB565 quantization
         strobe without introducing visible spatial patterns.

    @param tick: int — animation frame counter
    @returns: list — 64-element flat list of RGB tuples
    """
    amplitude = _FOG_BRIGHTNESS_CEILING - _FOG_BRIGHTNESS_FLOOR
    phase = (tick / _FOG_BREATH_PERIOD_TICKS) * 2 * math.pi
    breath = _FOG_BRIGHTNESS_FLOOR + amplitude * (math.sin(phase) + 1.0) / 2.0

    frame = []
    for i in range(64):
        col = i % 8
        # Layers compose additively: breath + drift ± a few percent,
        # plus the rare rift boost, plus the static dither. The clamp
        # guarantees the final value stays inside [0, 1] regardless of
        # how the layers stack.
        brightness = (
            breath
            + _fog_density_offset(col, tick)
            + _fog_rift_offset(col, tick)
            + _FOG_PIXEL_DITHER[i]
        )
        frame.append(_scale_color(FOG_COLOR, max(0.0, min(1.0, brightness))))
    return frame


# ── STATE CLASSIFICATION ──────────────────────────────────────────────────────

# Tomorrow.io weatherCode → display state
_STORM_CODES   = {8000}
_ICE_CODES     = {7000, 7101, 7102, 6000, 6001, 6200, 6201}
_SNOW_CODES    = {5000, 5001, 5100, 5101}
_RAIN_CODES    = {4001, 4200, 4201}
_DRIZZLE_CODES = {4000}
_FOG_CODES     = {2000, 2100}
_OVERCAST      = {1001, 1102}
_PARTLY        = {1101}
_MOSTLY_CLEAR  = {1100}


def classify(weather_code, cloud_cover):
    """
    Map a Tomorrow.io weatherCode to an animation state string.

    Returns one of: 'clear', 'partly_cloudy', 'overcast', 'fog',
                    'rain_light', 'rain', 'snow', 'ice', 'storm'
    """
    wc = weather_code or 1000

    if wc in _STORM_CODES:
        return "storm"
    if wc in _ICE_CODES:
        return "ice"
    if wc in _SNOW_CODES:
        return "snow"
    if wc in _RAIN_CODES:
        return "rain"
    if wc in _DRIZZLE_CODES:
        return "rain_light"
    if wc in _FOG_CODES:
        return "fog"
    if wc in _OVERCAST:
        return "overcast"
    if wc in _PARTLY:
        return "partly_cloudy"
    if wc in _MOSTLY_CLEAR:
        # Mostly clear but with some cloud cover → show as partly cloudy
        return "partly_cloudy" if (cloud_cover or 0) > 25 else "clear"
    # 1000, 3000–3002 (wind) → clear
    return "clear"


def get_frame(state, is_day, tick, sun_row=0, sun_col=3):
    """
    Return the 64-element RGB pixel list for the current animation frame.

    @param state:   str  display state (e.g. 'clear', 'rain', 'storm')
    @param is_day:  bool true between sunrise and sunset
    @param tick:    int  animation frame counter
    @param sun_row: int  top row of the sun (0=zenith … 6=horizon)
    @param sun_col: int  left col of the sun (0=east … 6=west)
    @returns: list  64-element flat list of RGB tuples
    """
    if state == "storm":
        return _storm_frame(tick)
    if state == "ice":
        return _ice_frame(tick)
    if state == "snow":
        return _snow_frame(tick)
    if state in ("rain", "rain_light"):
        return _rain_frame(tick, light=(state == "rain_light"))
    if state == "fog":
        return _fog_frame(tick)
    if state == "overcast":
        return _overcast_frame(tick)
    if state == "partly_cloudy":
        if is_day:
            return _partly_cloudy_day_frame(sun_row, sun_col, tick)
        return _partly_cloudy_night_frame(tick)
    if state == "sunset":
        return _sunset_frame(sun_row, sun_col)
    # "clear"
    if is_day:
        return _clear_day_frame(sun_row, sun_col)
    return _clear_night_frame(tick)


# ── BRIGHTNESS ────────────────────────────────────────────────────────────────

def apply_brightness(frame, brightness):
    """
    Scale all pixel values by a 0.0–1.0 brightness factor.
    Always returns a list of [r, g, b] lists (not tuples) because
    sense.set_pixels() requires lists in some versions of the library.
    """
    return [
        [int(r * brightness), int(g * brightness), int(b * brightness)]
        for r, g, b in frame
    ]


# ── WEATHER FETCH ─────────────────────────────────────────────────────────────

def fetch_weather():
    """
    GET /api/sensehat from the local pi-weather-station server.
    Returns the parsed JSON dict, or None on any error.
    """
    try:
        r = requests.get(
            f"{SERVER_URL}/api/sensehat",
            timeout=10,
            verify=False,  # self-signed certificate on localhost
        )
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        log.warning("Weather fetch failed: %s", exc)
        return None


def fetch_weather_with_retry():
    """
    Try to fetch weather with exponential backoff. Returns the parsed dict
    on the first successful response, or None if every attempt failed.

    Used at startup to absorb the typical race condition where pi-sensehat
    comes up before pi-weather-server is ready to answer HTTPS. Without
    this retry, the first fetch fails, the script falls back to default
    values (no sunrise/sunset → midday-sun position, isDay=True), and a
    misleading scene is shown until the regular polling interval kicks in.
    """
    delay = STARTUP_FETCH_INITIAL_DELAY
    for attempt in range(1, STARTUP_FETCH_MAX_ATTEMPTS + 1):
        data = fetch_weather()
        if data:
            if attempt > 1:
                log.info("Initial fetch succeeded on attempt %d/%d",
                         attempt, STARTUP_FETCH_MAX_ATTEMPTS)
            return data
        if attempt < STARTUP_FETCH_MAX_ATTEMPTS:
            log.info("Initial fetch attempt %d/%d failed; retrying in %.1fs",
                     attempt, STARTUP_FETCH_MAX_ATTEMPTS, delay)
            time.sleep(delay)
            delay = min(delay * 2, STARTUP_FETCH_MAX_DELAY)
    return None


# ── SUNSET DETECTION ─────────────────────────────────────────────────────────

def is_sunset_soon(sunset_ts):
    """
    Return True if sunset_ts (Unix ms) is within SUNSET_WINDOW_SEC from now.

    @param sunset_ts: int|None — Unix timestamp in milliseconds from /api/sensehat
    @returns: bool
    """
    if sunset_ts is None:
        return False
    seconds_to_sunset = sunset_ts / 1000 - time.time()
    return 0 < seconds_to_sunset < SUNSET_WINDOW_SEC


# States that require continuous redraws regardless of day/night.
# Other states may still need redraws conditionally — see `_is_animated`.
_ANIMATED_STATES = {"rain", "rain_light", "snow", "ice", "storm", "partly_cloudy", "overcast", "fog"}


def _is_animated(state, is_day):
    """Return True if `state` (in current day/night context) needs a
    fresh frame on every tick. The main loop uses this to decide
    whether to advance the animation counter or fall through to the
    static-cache branch.

    Most state/day-night combinations are static (clear day, sunset,
    overcast, fog) — they only redraw when the cache key changes. Two
    cases need per-tick redraws even though their `state` value isn't
    in `_ANIMATED_STATES` outright:

      * `clear` + night: the night sky has subtle star twinkle and an
        occasional shooting star, both driven by `tick`.

    Without this helper the clear-night animation built in
    `_clear_night_frame(tick)` would never play — the cache key
    `("clear", False, 0, 3)` is constant overnight, so the static
    branch would render the very first frame and never update.
    """
    if state in _ANIMATED_STATES:
        return True
    if state == "clear" and not is_day:
        return True
    return False


def _find_sensehat_fb():
    """
    Return the path of the Sense HAT framebuffer device, or None.
    The HAT registers as /dev/fb0 or /dev/fb1 depending on Pi OS version.
    Detection order:
      1. sysfs 'name' file containing 'sense' or 'RPi-Sense'
      2. sysfs driver symlink containing 'sense' or 'rpisense'
      3. Fallback to /dev/fb1 then /dev/fb0
    """
    for sysfs in sorted(glob.glob("/sys/class/graphics/fb*")):
        fb_dev = "/dev/" + os.path.basename(sysfs)
        # Check human-readable name (e.g. "RPi-Sense HAT")
        try:
            with open(sysfs + "/name") as f:
                if "sense" in f.read().lower():
                    return fb_dev
        except OSError:
            pass
        # Check driver symlink (e.g. "rpisense-fb")
        try:
            driver = os.path.basename(os.readlink(sysfs + "/device/driver"))
            if "sense" in driver.lower():
                return fb_dev
        except OSError:
            pass
    # Fallback
    for fb in ["/dev/fb1", "/dev/fb0"]:
        if os.path.exists(fb):
            return fb
    return None


_FB_PATH = None  # resolved once at first render


def _push_frame(sense, frame):
    """Push a 64-pixel frame buffer to the Sense HAT framebuffer.

    Writes directly to the framebuffer device in RGB565 format,
    bypassing the sense_hat library's internal pixel cache which only
    sends changed pixels and causes previous pixel colours to bleed
    into new frames. Falls back to `sense.set_pixels` when the
    framebuffer device can't be opened.

    Shared by the weather (`_render`) and alert (`_render_alert`)
    render paths — both produce a 64-pixel buffer and want the same
    rotation + RGB565 + framebuffer pipeline.

    @param sense: SenseHat instance (fallback only)
    @param frame: list of 64 RGB tuples in row-major order
    """
    global _FB_PATH

    # ── Build rotated 8×8 grid ────────────────────────────────────────────
    grid = [frame[y * 8 + x] for y in range(8) for x in range(8)]

    rot = ROTATION % 360
    if rot == 90:
        grid = [frame[(7 - x) * 8 + y] for y in range(8) for x in range(8)]
    elif rot == 180:
        grid = [frame[(7 - y) * 8 + (7 - x)] for y in range(8) for x in range(8)]
    elif rot == 270:
        grid = [frame[x * 8 + (7 - y)] for y in range(8) for x in range(8)]

    # ── Convert to RGB565 ─────────────────────────────────────────────────
    raw = b"".join(
        struct.pack("H", ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3))
        for r, g, b in grid
    )

    # ── Write to framebuffer ──────────────────────────────────────────────
    if _FB_PATH is None:
        _FB_PATH = _find_sensehat_fb()
        log.info("Sense HAT framebuffer: %s", _FB_PATH)

    if _FB_PATH:
        try:
            with open(_FB_PATH, "wb") as fb:
                fb.write(raw)
            return
        except OSError as exc:
            log.warning("Framebuffer write failed (%s): %s — falling back to set_pixels", _FB_PATH, exc)
            _FB_PATH = None  # retry detection next time

    # ── Fallback: sense_hat set_pixels ────────────────────────────────────
    try:
        sense.set_pixels([[r, g, b] for r, g, b in frame])
    except Exception as exc:
        log.error("set_pixels fallback failed: %s", exc)


def _render(sense, state, is_day, tick, sun_row=0, sun_col=3):
    """Build the weather frame and push it.

    @param sense:   SenseHat instance (fallback only)
    @param state:   str  display state
    @param is_day:  bool true between sunrise and sunset
    @param tick:    int  animation frame counter
    @param sun_row: int  top row of the sun block (0=zenith … 6=horizon)
    @param sun_col: int  left col of the sun block (0=east … 6=west)
    """
    brightness = BRIGHTNESS_DAY if is_day else BRIGHTNESS_NIGHT
    frame = get_frame(state, is_day, tick, sun_row, sun_col)
    frame = apply_brightness(frame, brightness)
    _push_frame(sense, frame)


def _render_alert(sense, tier, tick, is_day):
    """Build the alert pulse frame and push it.

    Renders the full-matrix breathing pulse override that takes
    precedence over weather (and clock, in the clock daemon's
    parallel implementation). Brightness is still gated by day/night
    so the override doesn't blind at 3 a.m. — the dim multiplier
    applies on top of the alert frame's own sine pulse.

    @param sense:  SenseHat instance (fallback only)
    @param tier:   str  "red" or "orange"
    @param tick:   int  animation frame counter
    @param is_day: bool true between sunrise and sunset
    """
    brightness = BRIGHTNESS_DAY if is_day else BRIGHTNESS_NIGHT
    frame = _alert_frame(tier, tick)
    frame = apply_brightness(frame, brightness)
    _push_frame(sense, frame)


# ── MAIN LOOP ─────────────────────────────────────────────────────────────────

def run():
    sense = SenseHat()
    sense.set_rotation(ROTATION)
    sense.low_light = False

    # State variables — None until the first successful fetch. Rendering is
    # suppressed in that case so we don't show a misleading default scene
    # (e.g. midday sun at midnight) when pi-sensehat starts before the
    # weather server is responsive.
    base_state    = None
    is_day        = None
    sunrise_ts    = None
    sunset_ts     = None
    active_alert  = None   # None or {"tier", "severity", "source", "event"} from /api/sensehat
    tick          = 0
    last_render   = None   # (state, is_day, sun_row, sun_col) of the last rendered static frame
    last_log_key  = None   # cache key for the "Updated" log — gates noise at 60 s polling

    log.info("Sense HAT display started (rotation=%d°, poll every %ds)", ROTATION, POLL_INTERVAL)

    # Try harder at startup to land on real values before falling through to
    # the regular polling cadence. Display stays blank during the wait.
    sense.clear((0, 0, 0))
    initial = fetch_weather_with_retry()
    if initial:
        base_state   = classify(initial.get("weatherCode"), initial.get("cloudCover", 0))
        is_day       = initial.get("isDay", True)
        sunrise_ts   = initial.get("sunriseTs")
        sunset_ts    = initial.get("sunsetTs")
        active_alert = initial.get("alert")
        log.info(
            "Initial state — code=%s state=%s isDay=%s temp=%s°C alert=%s",
            initial.get("weatherCode"), base_state, is_day,
            f"{initial['temperature']:.1f}" if initial.get("temperature") is not None else "?",
            (active_alert and f"{active_alert.get('tier')}/{active_alert.get('source')}/{active_alert.get('event')}") or "none",
        )
        last_log_key = (base_state, is_day, active_alert and active_alert.get("tier"))
    else:
        log.warning("Server unreachable after retries — display blank until a fetch succeeds")

    next_poll = time.time() + POLL_INTERVAL

    while True:
        now = time.time()

        # ── Re-fetch weather + alert every POLL_INTERVAL seconds ─────────────
        if now >= next_poll:
            data = fetch_weather()
            if data:
                was_blank    = base_state is None
                base_state   = classify(data.get("weatherCode"), data.get("cloudCover", 0))
                is_day       = data.get("isDay", True)
                sunrise_ts   = data.get("sunriseTs")
                sunset_ts    = data.get("sunsetTs")
                active_alert = data.get("alert")  # dict or None
                # Gate the "Updated" log on actual state change. With
                # POLL_INTERVAL=60 s we'd otherwise emit 60 lines/hour
                # for what's typically static weather; this drops it to
                # one line per real transition (state, day↔night, or
                # alert tier change).
                log_key = (base_state, is_day, active_alert and active_alert.get("tier"))
                if log_key != last_log_key:
                    log.info(
                        "Updated — code=%s state=%s isDay=%s temp=%s°C alert=%s",
                        data.get("weatherCode"), base_state, is_day,
                        f"{data['temperature']:.1f}" if data.get("temperature") is not None else "?",
                        (active_alert and f"{active_alert.get('tier')}/{active_alert.get('source')}/{active_alert.get('event')}") or "none",
                    )
                    last_log_key = log_key
                if was_blank:
                    log.info("Display now active after recovery")
            elif base_state is None:
                log.warning("Server still unreachable — display still blank")
            else:
                log.warning("Fetch failed — keeping previous state: %s", base_state)
            next_poll = now + POLL_INTERVAL

        # Suppress rendering until at least one successful fetch.
        if base_state is None:
            time.sleep(FRAME_DELAY)
            continue

        # ── Gov alert override (highest priority) ───────────────────────────
        # Active red/orange tier alert from ECCC/NWS → full-matrix
        # breathing pulse, replaces every weather animation. Yellow/minor
        # is filtered out server-side so we don't need to re-check the
        # tier here. Always animated.
        if active_alert and active_alert.get("tier") in ("red", "orange"):
            _render_alert(sense, active_alert["tier"], tick, is_day)
            last_render = None  # invalidate the static cache so weather redraws on alert clear
            time.sleep(FRAME_DELAY)
            tick += 1
            continue

        # ── Resolve final display state (sunset override on clear days) ───────
        state = "sunset" if (base_state == "clear" and is_day and is_sunset_soon(sunset_ts)) \
                else base_state

        # ── Sun position: arc east→zenith→west, horizon→top→horizon ─────────
        if is_day:
            sun_row, sun_col = _compute_sun_pos(sunrise_ts, sunset_ts)
        else:
            sun_row, sun_col = 0, 3

        # ── Render ────────────────────────────────────────────────────────────
        if _is_animated(state, is_day):
            # Animated: redraw every frame to advance the animation.
            _render(sense, state, is_day, tick, sun_row, sun_col)
            time.sleep(FRAME_DELAY)
            tick += 1
        else:
            # Static: redraw when state, day/night, or sun position changes.
            render_key = (state, is_day, sun_row, sun_col)
            if render_key != last_render:
                _render(sense, state, is_day, tick, sun_row, sun_col)
                last_render = render_key
            time.sleep(FRAME_DELAY)


# ── TEST MODE ─────────────────────────────────────────────────────────────────

def _production_service_active():
    """Return True if `pi-sensehat.service` is currently `active`
    according to `systemctl --user`. False on any other status, on
    error, or when systemctl is unavailable (typical for dev hosts:
    macOS, non-systemd Linux). Used to bail out of `--test` and
    `--state` before two processes start fighting over the framebuffer
    — the field-test scenario that produced the "fog + rain
    superimposed" artifact during the 2026-05-24 session.
    """
    try:
        result = subprocess.run(
            ["systemctl", "--user", "is-active", "pi-sensehat.service"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        return result.stdout.strip() == "active"
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return False


def _abort_if_service_running():
    """If the production daemon is active, refuse to start a test mode
    so the user doesn't end up with two processes writing interleaved
    frames to the same framebuffer (visually: chaotic "two
    animations playing simultaneously" — completely defeats the
    purpose of a calibration test).
    """
    if not _production_service_active():
        return
    log.error(
        "pi-sensehat.service is currently active — test mode would write "
        "frames in parallel with the production daemon, producing visual "
        "chaos on the LED matrix. Stop the service first:"
    )
    log.error("    systemctl --user stop pi-sensehat")
    log.error("…and restart it when you're done testing:")
    log.error("    systemctl --user start pi-sensehat")
    sys.exit(1)


# CLI slug → (internal state name, is_day) mapping for `--state`. Slugs
# are kebab-case so they're shell-friendly (no shell-special chars,
# unambiguous on a tab-completion line). Day/night variants get
# explicit suffixes — defaulting to one or the other would be a
# guessing game, so the user picks.
_TEST_STATE_SLUGS = {
    "clear-day":           ("clear",         True),
    "clear-night":         ("clear",         False),
    "sunset":              ("sunset",        True),
    "partly-cloudy-day":   ("partly_cloudy", True),
    "partly-cloudy-night": ("partly_cloudy", False),
    "overcast":            ("overcast",      True),
    "fog":                 ("fog",           True),
    "rain-light":          ("rain_light",    True),
    "rain":                ("rain",          True),
    "snow":                ("snow",          False),
    "ice":                 ("ice",           True),
    "storm":               ("storm",         False),
}

# In single-state mode, the sun arc has no natural deadline to compress
# into, so we just loop the arc on a slow period. 30 s feels right —
# fast enough to see the motion start to finish, slow enough not to
# read as cartoonish.
_SUN_ARC_LOOP_SECONDS = 30


def run_test_single(state, is_day):
    """Render ONE state continuously until Ctrl-C, for visual
    validation of a specific animation without the strobe-like
    transitions and 12-state churn of the full cycle.

    Mirrors the per-state branches of `run_test()`: sun-arc loop for
    clear/sunset day, animated tick loop for everything in
    `_ANIMATED_STATES` (plus clear-night), single-shot render + sleep
    for static states. The sun-arc loop wraps every
    `_SUN_ARC_LOOP_SECONDS` so the user sees the full east→west
    motion in a comfortable timescale rather than waiting for the
    accelerated 15 s of the cycle test.

    @param state:  str   internal state name (e.g. "fog", "partly_cloudy")
    @param is_day: bool  whether to render the day or night variant
    """
    _abort_if_service_running()

    sense = SenseHat()
    sense.set_rotation(ROTATION)
    sense.low_light = False
    sense.clear()

    log.info("Single-state test: state=%s is_day=%s — Ctrl-C to exit",
             state, is_day)

    tick = 0
    try:
        if state in ("clear", "sunset") and is_day:
            # Loop the sun arc on a slow period.
            arc_start = time.time()
            while True:
                elapsed  = (time.time() - arc_start) % _SUN_ARC_LOOP_SECONDS
                progress = elapsed / _SUN_ARC_LOOP_SECONDS
                sun_row  = round(6.0 * (1.0 - math.sin(progress * math.pi)))
                sun_col  = round(6.0 * progress) if SUN_EAST_LEFT \
                           else round(6.0 * (1.0 - progress))
                _render(sense, state, is_day, tick, sun_row, sun_col)
                time.sleep(FRAME_DELAY)
                tick += 1
        elif not _is_animated(state, is_day):
            # Static state: render once, then idle. Sleep in short
            # chunks so Ctrl-C is responsive.
            _render(sense, state, is_day, tick, 0, 3)
            while True:
                time.sleep(FRAME_DELAY)
        else:
            while True:
                _render(sense, state, is_day, tick, 0, 3)
                time.sleep(FRAME_DELAY)
                tick += 1
    except KeyboardInterrupt:
        pass
    finally:
        sense.clear()
        log.info("Single-state test ended — display cleared")


def run_test():
    """
    Cycle through all display states for TEST_STATE_DURATION seconds each.
    Useful for verifying colours, animations and rotation without waiting
    for real weather changes.  Run with: python3 sensehat_weather.py --test
    """
    _abort_if_service_running()

    sense = SenseHat()
    sense.set_rotation(ROTATION)
    sense.low_light = False

    test_states = [
        ("clear (day)",           "clear",         True),
        ("sunset",                "sunset",         True),
        ("clear (night)",         "clear",         False),
        ("partly cloudy (day)",   "partly_cloudy",  True),
        ("partly cloudy (night)", "partly_cloudy", False),
        ("overcast",              "overcast",        True),
        ("fog",                   "fog",             True),
        ("light rain",            "rain_light",      True),
        ("rain",                  "rain",            True),
        ("snow",                  "snow",           False),
        ("ice pellets",           "ice",             True),
        ("thunderstorm",          "storm",          False),
    ]

    log.info("TEST MODE — cycling %d states × %ds each. Ctrl-C to exit.",
             len(test_states), TEST_STATE_DURATION)

    tick = 0
    try:
        while True:
            for label, state, is_day in test_states:
                log.info("State: %s", label)
                deadline   = time.time() + TEST_STATE_DURATION
                state_start = time.time()
                sense.clear()
                # For clear/sunset states: animate the sun arc over the test duration
                # so the viewer can see the sun move up and down.
                if state in ("clear", "sunset") and is_day:
                    # Animate full east→west arc over the test duration.
                    while time.time() < deadline:
                        elapsed  = time.time() - state_start
                        progress = min(1.0, elapsed / TEST_STATE_DURATION)
                        sun_row  = round(6.0 * (1.0 - math.sin(progress * math.pi)))
                        sun_col  = round(6.0 * progress) if SUN_EAST_LEFT \
                                   else round(6.0 * (1.0 - progress))
                        _render(sense, state, is_day, tick, sun_row, sun_col)
                        time.sleep(FRAME_DELAY)
                        tick += 1
                elif not _is_animated(state, is_day):
                    _render(sense, state, is_day, tick, 0, 3)
                    while time.time() < deadline:
                        time.sleep(FRAME_DELAY)
                else:
                    while time.time() < deadline:
                        _render(sense, state, is_day, tick, 0, 3)
                        time.sleep(FRAME_DELAY)
                        tick += 1
    except KeyboardInterrupt:
        pass
    finally:
        sense.clear()
        log.info("Test mode ended — display cleared")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Pi Weather Station — Sense HAT display")
    parser.add_argument(
        "--test", action="store_true",
        help="Cycle through all display states for testing"
    )
    parser.add_argument(
        "--state", metavar="SLUG", choices=sorted(_TEST_STATE_SLUGS),
        help="Show only the named state continuously. Useful for visual "
             "validation of a specific animation without the strobe-like "
             "transitions of the full cycle. Implies test mode. "
             "Available: " + ", ".join(sorted(_TEST_STATE_SLUGS))
    )
    args = parser.parse_args()

    try:
        if args.state:
            state, is_day = _TEST_STATE_SLUGS[args.state]
            run_test_single(state, is_day)
        elif args.test:
            run_test()
        else:
            run()
    except KeyboardInterrupt:
        log.info("Interrupted — clearing display")
        SenseHat().clear()
