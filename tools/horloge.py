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
import os
import signal
import sys
import time

from sense_hat import SenseHat

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
    while True:
        now = time.localtime()
        try:
            sense.set_pixels(build_clock_frame(now.tm_hour, now.tm_min, hour_color, minute_color))
        except Exception as exc:
            # Don't crash the daemon on a single bad frame — the i2c
            # bus can occasionally drop a transaction. Log it, wait
            # for the next minute, try again.
            logging.warning("set_pixels failed: %s", exc)
        time.sleep(seconds_until_next_minute())


if __name__ == "__main__":
    main()
