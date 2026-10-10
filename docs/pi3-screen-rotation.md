# Raspberry Pi 3 (and older): don't rotate the screen in software

**Applies to:** Raspberry Pi 3B / 3B+ / 3A+, Zero 2 W and older boards running Raspberry Pi OS with the default **labwc** desktop (Bookworm, Trixie). A Pi 4, Pi 5 or CM4/CM5 is **not** affected.

## The short version

If the official 7" touchscreen (or any panel) sits upside down in its stand and the image is flipped back with the OS **Screen Configuration / Orientation** setting, a Pi 3 loses most of its fluidity:

| Pi 3B, official 7" (800×480) | Screen rotated 180° in software | No rotation |
|---|---|---|
| Radar timeline playing at 4× | **~5 frames/s** | **~59 frames/s** |
| Dragging the map | ~36 frames/s | ~60 frames/s |
| Radar focus on/off (20 toggles) | ~20 frames/s | ~49 frames/s |
| Opening/closing the forecast and conditions views | ~25 frames/s | ~53 frames/s |
| CPU used by the desktop compositor (labwc) while the radar plays | ~96 % of one core | ~1 % |

*Measured on 2026-10-10 on a Pi 3B bench running commit `1f38e04`, Chromium 152, in the kiosk itself (frame rate from the page's animation frames). Three runs: rotated, unrotated, rotated again; the two rotated runs agree within 1–4 frames/s, so the difference comes from the rotation alone.*

At rest (nothing moving on screen) both orientations cost nothing. The difference shows whenever something moves: the radar loop, a pan, a transition.

**Fix: mount the screen the right way up and set the orientation back to normal.** Details below.

## Why

On boards whose GPU has no MMU (Pi 0 to Pi 3), Raspberry Pi OS starts labwc with a **software renderer** (`WLR_RENDERER=pixman`, set in `/usr/bin/labwc-pi`).

- **Without rotation**, labwc hands the browser's full-screen frame straight to the display ("direct scanout"). It does almost no work per frame, whatever the renderer.
- **With rotation**, that shortcut isn't available. Every frame the browser draws has to be recomposed and rotated by labwc **on the CPU**, which on a Pi 3 means reading the frame back from graphics memory. That caps the whole screen at a few frames per second while the radar plays.

A Pi 4 or Pi 5 uses the GPU renderer, so rotation costs it almost nothing.

## Check your Pi

```bash
# 1. Is the output rotated? ("Transform: normal" is what you want on a Pi 3)
XDG_RUNTIME_DIR=/run/user/$(id -u) WAYLAND_DISPLAY=wayland-0 wlr-randr | grep -E 'Transform'

# 2. Is labwc using the software renderer? ("WLR_RENDERER=pixman" on a Pi 0-3)
tr '\0' '\n' < /proc/$(pgrep -x labwc | head -1)/environ | grep '^WLR_'
```

If the first command prints `Transform: 180` (or 90/270) and the second prints `WLR_RENDERER=pixman`, this page applies.

## Fix

1. **Turn the screen the right way up** in its stand or case, for example by turning the display over so the image no longer needs flipping.
2. **Set the orientation back to normal:**
   - **GUI:** Control Centre → **Screens**, select the display (**DSI-1** for the official touchscreen), and set its **Orientation** to normal. This is the same panel as the touchscreen **Mode** setting described in [troubleshooting-touchscreen.md](troubleshooting-touchscreen.md).
   - **Or** edit `~/.config/kanshi/config` and remove `transform 180` (or set `transform normal`) from the output line, then reboot.
   - To try it first without saving: `XDG_RUNTIME_DIR=/run/user/$(id -u) WAYLAND_DISPLAY=wayland-0 wlr-randr --output DSI-1 --transform normal`. This lasts until the next reboot.
3. **Check the touchscreen.** When the touch device is mapped to the output (labwc `rc.xml`, `mapToOutput="DSI-1"`), touch follows the new orientation automatically. If taps land in the wrong place, see [troubleshooting-touchscreen.md](troubleshooting-touchscreen.md).
4. **Mind the power cable.** Once the screen is the right way up, the Pi 3's micro-USB power input may face the table and keep the stand from sitting flat. A **right-angle (90°) micro-USB cable or adapter** solves it. Keep powering the Pi **directly** with a proper supply (official 5.1 V / 2.5 A), never through the touchscreen's board via the GPIO pins (see the hardware note in the [readme](../readme.md#setup) and [issue 284](https://github.com/thicla01/pi-weather-station/issues/284)).

## Related

- The kiosk's display scale ([display-scale-override-design.md](display-scale-override-design.md)) is a different setting: it changes the size of the interface, not the orientation, and has no such cost.
