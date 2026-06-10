#!/usr/bin/env python3
"""
Pi Weather Station — Sense HAT Clock Display

Renders the current local time on the Sense HAT's 8x8 RGB LED matrix as
two side-by-side 4x4 numerals per row: hours in the top half (red),
minutes in the bottom half (cyan). The leading zero on the hour is
suppressed (rendered blank) so single-digit hours read cleanly; the
leading zero on the minute is kept so 13:05 still reads as "1305".

IMPORTANT — exclusive HAT access
  This script takes exclusive control of the Sense HAT LED matrix.
  Mutually exclusive with `sensehat_weather.py`; the two are managed
  via `pi-sensehat.service` (weather) and `pi-sensehat-clock.service`
  (this script), with at most one running at any given time. The
  /api/sensehat-mode endpoint of the weather server orchestrates the
  switch (systemctl --user start/stop).

Loop cadence
  The script runs as a long-lived daemon. It re-renders on each minute
  boundary (the cadence the bitmap font supports — no seconds) and
  sleeps to the next exact wall-clock minute. SIGTERM (sent by
  `systemctl stop`) clears the matrix and exits cleanly so the next
  service to start sees a blank slate.

Historical note
  Pre-2026-05 this script was a one-shot invocation triggered by cron
  every minute. The daemon shape removes the cron entry (one source of
  config drift gone), avoids the ~60×/hour Sense HAT initialisation
  overhead, and matches the lifecycle pattern of sensehat_weather.py.
"""

import json
import logging
import math
import os
import signal
import sys
import time
import urllib3

import requests

from sense_hat import SenseHat

# ── ALERT OVERRIDE ───────────────────────────────────────────────────────────
#
# When a gov alert (ECCC / NWS) of severity ≥ moderate is active, the
# clock display is replaced by the same red/orange breathing pulse that
# `sensehat_weather.py` shows in weather mode — alerts take precedence
# over both modes so a tornado warning at 3 a.m. isn't hidden behind
# the user's chosen display preference. The clock fetches alert state
# from /api/sensehat (same endpoint as the weather daemon); the
# `alert` field is included server-side when the tier warrants the
# override.
#
# Cadence: alert poll runs at 60 s. While idle (no alert) the daemon
# wakes once per minute to refresh the clock — same as before. When
# an alert is active, the main loop switches to FRAME_DELAY (0.12 s)
# so the pulse animates smoothly.

SERVER_URL              = "https://localhost:8443"
ALERT_POLL_INTERVAL_SEC = 60      # how often to refetch /api/sensehat for alert state
FRAME_DELAY_SEC         = 0.12    # animation cadence during an active alert

# How long a previously-fetched alert state stays trusted when the server
# is unreachable (in-app update restart, network blip). Within the window
# an active pulse keeps animating on stale data — better than a tornado
# warning's pulse dropping because one poll failed during a server
# restart. Past the window the alert is assumed expired and the clock
# returns. Mirrored in tools/sensehat_weather.py — keep in sync.
STALE_ALERT_MAX_SEC     = 15 * 60

# Sentinel distinguishing "fetch failed" from "no active alert" (both used
# to map to None, which made the loop log "Alert cleared" — and kill the
# pulse — on a single failed poll).
FETCH_FAILED = object()

_ALERT_COLORS = {
    "red":    [255,  30,  30],
    "orange": [255, 140,   0],
}
_ALERT_PULSE_PERIOD_TICKS = {
    "red":    25,
    "orange": 33,
}
_ALERT_BRIGHTNESS_FLOOR = 0.50
_ALERT_BRIGHTNESS_CEILING = 1.00

# Suppress InsecureRequestWarning for the localhost self-signed cert.
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Settings file path — resolved relative to this script so we don't
# hard-code a $HOME path that breaks for non-pi users. The kiosk's
# pi-weather-server reads/writes the same file from server/settingsCtrl.js.
SETTINGS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "settings.json",
)

# Default brightness percent if the setting is absent / unreadable.
# Picked at the midpoint so the very first user-pull-without-config
# gets a comfortable level rather than the original full-blast Red+Cyan.
DEFAULT_BRIGHTNESS_PERCENT = 50


def read_clock_brightness():
    """Read advanced.sensehat.clockBrightness from settings.json.
    Returns an integer in [0, 100], or DEFAULT_BRIGHTNESS_PERCENT on
    any read / parse error. The systemd service is restarted by the
    server when the user changes this slider, so this read happens
    once at process start.
    """
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        v = data.get("advanced", {}).get("sensehat", {}).get("clockBrightness")
        if isinstance(v, (int, float)) and 0 <= v <= 100:
            return int(v)
    except Exception:
        pass
    return DEFAULT_BRIGHTNESS_PERCENT


def scale_color(rgb, brightness_percent):
    """Scale an [r, g, b] triple by a 0-100 percent factor."""
    factor = max(0, min(100, brightness_percent)) / 100.0
    return [int(round(c * factor)) for c in rgb]


# 4x4 bitmap font, digits 0-9. Each row of the digit is 4 pixels; four
# rows stack to form one digit. Two digits side-by-side fill one half
# of the 8x8 matrix (4 px wide × 4 px tall).
NUMBER = [
    [[0, 1, 1, 1], [0, 1, 0, 1], [0, 1, 0, 1], [0, 1, 1, 1]],  # 0
    [[0, 0, 1, 0], [0, 1, 1, 0], [0, 0, 1, 0], [0, 1, 1, 1]],  # 1
    [[0, 1, 1, 1], [0, 0, 1, 1], [0, 1, 1, 0], [0, 1, 1, 1]],  # 2
    [[0, 1, 1, 1], [0, 0, 1, 1], [0, 0, 1, 1], [0, 1, 1, 1]],  # 3
    [[0, 1, 0, 1], [0, 1, 1, 1], [0, 0, 0, 1], [0, 0, 0, 1]],  # 4
    [[0, 1, 1, 1], [0, 1, 1, 0], [0, 0, 1, 1], [0, 1, 1, 1]],  # 5
    [[0, 1, 0, 0], [0, 1, 1, 1], [0, 1, 0, 1], [0, 1, 1, 1]],  # 6
    [[0, 1, 1, 1], [0, 0, 0, 1], [0, 0, 1, 0], [0, 1, 0, 0]],  # 7
    [[0, 1, 1, 1], [0, 1, 1, 1], [0, 1, 1, 1], [0, 1, 1, 1]],  # 8
    [[0, 1, 1, 1], [0, 1, 0, 1], [0, 1, 1, 1], [0, 0, 0, 1]],  # 9
]
NO_NUMBER = [0, 0, 0, 0]

HOUR_COLOR = [255, 0, 0]      # Red
MINUTE_COLOR = [0, 255, 255]  # Cyan
EMPTY = [0, 0, 0]             # Off

# Physical mounting orientation of the Sense HAT board on the Pi.
# 180° puts the display the right way up when the GPIO header is at
# the top of the chassis — adjust to match your installation.
ROTATION_DEGREES = 180


def build_clock_frame(hour, minute, hour_color=HOUR_COLOR, minute_color=MINUTE_COLOR):
    """Return the 64-pixel buffer for HH:MM.

    Top 4 rows = hour digits (`hour_color`, defaults to red).
    Bottom 4 rows = minute digits (`minute_color`, defaults to cyan).
    Leading zero on the hour is suppressed (rendered blank); leading
    zero on the minute is shown.

    The two colour overrides let `main()` apply the user's brightness
    setting once at start without re-scaling on every frame.

    @param hour: int in [0, 23]
    @param minute: int in [0, 59]
    @param hour_color: [r, g, b] for the top half
    @param minute_color: [r, g, b] for the bottom half
    @returns: list of 64 [r, g, b] triples, row-major
    """
    pixels = []
    # Top half — hour digits, red. Leading zero suppressed.
    for index in range(0, 4):
        if hour >= 10:
            pixels.extend(NUMBER[hour // 10][index])
        else:
            pixels.extend(NO_NUMBER)
        pixels.extend(NUMBER[hour % 10][index])
    # Bottom half — minute digits, cyan. Leading zero KEPT (13:05 reads
    # right).
    for index in range(0, 4):
        pixels.extend(NUMBER[minute // 10][index])
        pixels.extend(NUMBER[minute % 10][index])
    # Map the binary on/off mask to RGB triples — hour colour for the
    # top half (pixels [0, 32)), minute colour for the bottom half.
    coloured = []
    for i, on in enumerate(pixels):
        if on:
            coloured.append(hour_color if i < 32 else minute_color)
        else:
            coloured.append(EMPTY)
    return coloured


def seconds_until_next_minute():
    """Return how long to sleep (in seconds, fractional) until the
    next wall-clock minute boundary. Used to drift-free schedule the
    next render — `sleep(60)` would slowly desync because each render
    takes a small but non-zero amount of time.
    """
    return 60.0 - (time.time() % 60.0)


def fetch_active_alert():
    """Hit /api/sensehat and return the `alert` field if present.

    The endpoint may return 200 with no `alert` key (no active alert),
    200 with an `alert` object (active alert ≥ orange tier), or fail
    entirely (server down / network blip). Failure returns the
    FETCH_FAILED sentinel so the caller can keep the last known alert
    state instead of treating an outage as "alert cleared".

    @returns: dict|None|FETCH_FAILED  alert dict, None (no active
        alert), or FETCH_FAILED (server unreachable)
    """
    try:
        r = requests.get(
            f"{SERVER_URL}/api/sensehat",
            timeout=10,
            verify=False,  # self-signed localhost cert
        )
        r.raise_for_status()
        return r.json().get("alert")
    except Exception:
        return FETCH_FAILED


def build_alert_frame(tier, tick, brightness_percent):
    """Build the 64-pixel alert pulse frame.

    Mirrors `_alert_frame()` from sensehat_weather.py so the display
    is identical whether the user is in weather mode or clock mode at
    alert onset. The user-configured clock brightness applies on top
    of the alert's own sine pulse so the override doesn't bypass the
    dimming the user set for night-time clock visibility.

    @param tier: str  "red" or "orange"
    @param tick: int  animation frame counter
    @param brightness_percent: int  0-100, user's clock brightness setting
    @returns: list of 64 [r, g, b] triples
    """
    base = _ALERT_COLORS.get(tier, _ALERT_COLORS["red"])
    period = _ALERT_PULSE_PERIOD_TICKS.get(tier, _ALERT_PULSE_PERIOD_TICKS["red"])
    amplitude = _ALERT_BRIGHTNESS_CEILING - _ALERT_BRIGHTNESS_FLOOR
    phase = (tick / period) * 2 * math.pi
    pulse = _ALERT_BRIGHTNESS_FLOOR + amplitude * (math.sin(phase) + 1.0) / 2.0
    user_dim = max(0, min(100, brightness_percent)) / 100.0
    factor = pulse * user_dim
    scaled = [int(round(c * factor)) for c in base]
    return [scaled] * 64


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    sense = SenseHat()
    sense.set_rotation(ROTATION_DEGREES)

    brightness = read_clock_brightness()
    hour_color = scale_color(HOUR_COLOR, brightness)
    minute_color = scale_color(MINUTE_COLOR, brightness)
    logging.info("clock brightness: %d%% (hour=%s, minute=%s)", brightness, hour_color, minute_color)

    def cleanup_and_exit(*_):
        """Handler for SIGTERM (systemctl stop) and SIGINT (Ctrl-C).
        Clears the matrix so the next service or `sense.clear()` from
        elsewhere doesn't have to deal with a frozen frame.
        """
        try:
            sense.clear()
        except Exception:
            pass
        logging.info("clock daemon stopping")
        sys.exit(0)

    signal.signal(signal.SIGTERM, cleanup_and_exit)
    signal.signal(signal.SIGINT, cleanup_and_exit)

    logging.info("clock daemon started")

    # Two-mode loop:
    #   - idle (no active alert): sleep until the next minute, render
    #     the clock once, then sleep again. Wakes briefly every
    #     ALERT_POLL_INTERVAL_SEC to refetch alert state.
    #   - alert active: tight FRAME_DELAY loop that renders the
    #     breathing pulse. Refetches alert state every
    #     ALERT_POLL_INTERVAL_SEC; transitions back to idle when the
    #     alert clears.
    #
    # Both modes carry a single `tick` counter so the pulse animation
    # advances smoothly across re-renders.
    initial_alert        = fetch_active_alert()  # may be FETCH_FAILED at boot
    active_alert         = None if initial_alert is FETCH_FAILED else initial_alert
    last_alert_success   = time.time()  # last successful alert poll — drives the staleness cap
    next_alert_poll      = time.time() + ALERT_POLL_INTERVAL_SEC
    tick                 = 0
    last_rendered_minute = -1
    last_alert_tier      = active_alert and active_alert.get("tier")

    if active_alert:
        logging.info(
            "Active alert at startup: tier=%s source=%s event=%s — overriding clock",
            active_alert.get("tier"), active_alert.get("source"), active_alert.get("event"),
        )

    while True:
        now = time.time()

        # ── Refetch alert state at fixed cadence ───────────────────
        if now >= next_alert_poll:
            result = fetch_active_alert()
            if result is FETCH_FAILED:
                # Server unreachable (in-app update restart, network blip):
                # keep the last known alert state so an active pulse doesn't
                # drop on a single failed poll — but only within the
                # staleness window, past which the alert is assumed expired.
                if active_alert and (now - last_alert_success) > STALE_ALERT_MAX_SEC:
                    logging.info(
                        "Alert state stale (server unreachable for %ds) — returning to clock display",
                        int(now - last_alert_success),
                    )
                    active_alert = None
                    last_alert_tier = None
                    last_rendered_minute = -1  # force a clock redraw
                elif active_alert:
                    # One line per failed poll (60 s cadence) so an outage
                    # during an active alert leaves a diagnostic trace.
                    logging.info(
                        "Alert poll failed — keeping alert state (age %ds)",
                        int(now - last_alert_success),
                    )
            else:
                last_alert_success = now
                new_alert = result
                new_tier = new_alert and new_alert.get("tier")
                if new_tier != last_alert_tier:
                    if new_alert:
                        logging.info(
                            "Alert became active: tier=%s source=%s event=%s",
                            new_alert.get("tier"), new_alert.get("source"), new_alert.get("event"),
                        )
                    elif last_alert_tier:
                        logging.info("Alert cleared — returning to clock display")
                    last_alert_tier = new_tier
                    last_rendered_minute = -1  # force a clock redraw on next idle frame
                active_alert = new_alert
            next_alert_poll = now + ALERT_POLL_INTERVAL_SEC

        try:
            if active_alert and active_alert.get("tier") in _ALERT_COLORS:
                # Alert mode — animate the breathing pulse.
                sense.set_pixels(build_alert_frame(
                    active_alert["tier"], tick, brightness,
                ))
                tick += 1
                time.sleep(FRAME_DELAY_SEC)
            else:
                # Idle mode — redraw the clock once per minute boundary,
                # then sleep until the next alert poll or the next
                # minute, whichever comes first. The longer of two short
                # sleeps keeps the daemon responsive to alert arrivals
                # without burning CPU during quiet periods.
                local = time.localtime()
                if local.tm_min != last_rendered_minute:
                    sense.set_pixels(build_clock_frame(
                        local.tm_hour, local.tm_min, hour_color, minute_color,
                    ))
                    last_rendered_minute = local.tm_min
                wait_for_alert  = max(0.5, next_alert_poll - time.time())
                wait_for_minute = seconds_until_next_minute()
                time.sleep(min(wait_for_alert, wait_for_minute))
        except Exception as exc:
            # Don't crash the daemon on a single bad frame — the i2c
            # bus can occasionally drop a transaction. Log it, wait a
            # short tick, try again.
            logging.warning("render failed: %s", exc)
            time.sleep(1.0)


if __name__ == "__main__":
    main()
