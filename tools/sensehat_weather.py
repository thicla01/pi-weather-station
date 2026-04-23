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
POLL_INTERVAL = 10 * 60                  # seconds between weather API calls
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

# 🌙  Clear sky — night: black with scattered warm-white stars
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

# 🌤🌙  Partly cloudy — night: same cloud on dark sky with stars peeking below
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

# ☁️  Overcast: textured grey checkerboard to suggest thick cloud cover
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

# 🌫  Fog: uniform pale grey-blue
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


def _partly_cloudy_day_frame(sun_row, sun_col):
    """
    Blue sky with the dynamic sun at (sun_row, sun_col) and a grey cloud
    overlaid on the upper portion. The cloud draws on top of the sun, so
    when the sun is high (rows 0–3) it is partially or fully hidden behind
    the cloud — just like real partly-cloudy conditions.

    @param sun_row: int  top row of the sun (0–6)
    @param sun_col: int  left col of the sun (0–6)
    @returns: list  64-element flat list of RGB tuples
    """
    frame = _clear_day_frame(sun_row, sun_col)
    # Cloud pixels overlaid on top of the sky+sun base
    cloud_pixels = [
        (0, 2, CL), (0, 3, CL), (0, 4, CL), (0, 5, CL),
        (1, 1, CL), (1, 2, CL), (1, 3, CL), (1, 4, CL), (1, 5, CL), (1, 6, CL),
        (2, 1, CL), (2, 2, CD), (2, 3, CD), (2, 4, CD), (2, 5, CD), (2, 6, CL),
        (3, 2, CD), (3, 3, CD), (3, 4, CD), (3, 5, CD),
    ]
    for r, c, color in cloud_pixels:
        frame[r * 8 + c] = color
    return frame


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
        return list(FRAME_FOG)
    if state == "overcast":
        return list(FRAME_OVERCAST)
    if state == "partly_cloudy":
        if is_day:
            return _partly_cloudy_day_frame(sun_row, sun_col)
        return list(FRAME_PARTLY_CLOUDY_NIGHT)
    if state == "sunset":
        return _sunset_frame(sun_row, sun_col)
    # "clear"
    if is_day:
        return _clear_day_frame(sun_row, sun_col)
    return list(FRAME_CLEAR_NIGHT)


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


# States that require continuous redraws (animation).
# All other states are static: set_pixels is called only when state changes.
_ANIMATED_STATES = {"rain", "rain_light", "snow", "ice", "storm"}


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


def _render(sense, state, is_day, tick, sun_row=0, sun_col=3):
    """
    Build and push one frame to the Sense HAT.

    Writes directly to the framebuffer device in RGB565 format, bypassing
    the sense_hat library's internal pixel cache which only sends changed
    pixels and causes previous pixel colours to bleed into new frames.

    @param sense:   SenseHat instance (fallback only)
    @param state:   str  display state
    @param is_day:  bool true between sunrise and sunset
    @param tick:    int  animation frame counter
    @param sun_row: int  top row of the sun block (0=zenith … 6=horizon)
    @param sun_col: int  left col of the sun block (0=east … 6=west)
    """
    global _FB_PATH

    brightness = BRIGHTNESS_DAY if is_day else BRIGHTNESS_NIGHT
    frame = get_frame(state, is_day, tick, sun_row, sun_col)
    frame = apply_brightness(frame, brightness)

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


# ── MAIN LOOP ─────────────────────────────────────────────────────────────────

def run():
    sense = SenseHat()
    sense.set_rotation(ROTATION)
    sense.low_light = False

    base_state  = "clear"
    is_day      = True
    sunrise_ts  = None
    sunset_ts   = None
    tick        = 0
    next_poll   = 0       # 0 forces an immediate fetch on first iteration
    last_render = None    # (state, is_day, sun_row) of the last rendered frame

    log.info("Sense HAT display started (rotation=%d°, poll every %ds)", ROTATION, POLL_INTERVAL)

    while True:
        now = time.time()

        # ── Re-fetch weather every POLL_INTERVAL seconds ──────────────────────
        if now >= next_poll:
            data = fetch_weather()
            if data:
                base_state = classify(data.get("weatherCode"), data.get("cloudCover", 0))
                is_day     = data.get("isDay", True)
                sunrise_ts = data.get("sunriseTs")
                sunset_ts  = data.get("sunsetTs")
                log.info(
                    "Updated — code=%s state=%s isDay=%s temp=%s°C",
                    data.get("weatherCode"), base_state, is_day,
                    f"{data['temperature']:.1f}" if data.get("temperature") is not None else "?",
                )
            else:
                log.warning("Fetch failed — keeping previous state: %s", base_state)
            next_poll = now + POLL_INTERVAL

        # ── Resolve final display state (sunset override on clear days) ───────
        state = "sunset" if (base_state == "clear" and is_day and is_sunset_soon(sunset_ts)) \
                else base_state

        # ── Sun position: arc east→zenith→west, horizon→top→horizon ─────────
        if is_day:
            sun_row, sun_col = _compute_sun_pos(sunrise_ts, sunset_ts)
        else:
            sun_row, sun_col = 0, 3

        # ── Render ────────────────────────────────────────────────────────────
        if state in _ANIMATED_STATES:
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

def run_test():
    """
    Cycle through all display states for TEST_STATE_DURATION seconds each.
    Useful for verifying colours, animations and rotation without waiting
    for real weather changes.  Run with: python3 sensehat_weather.py --test
    """
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
                elif state not in _ANIMATED_STATES:
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
    args = parser.parse_args()

    try:
        if args.test:
            run_test()
        else:
            run()
    except KeyboardInterrupt:
        log.info("Interrupted — clearing display")
        SenseHat().clear()
