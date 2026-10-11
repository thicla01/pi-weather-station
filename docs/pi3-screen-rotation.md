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

**Fix: mount the screen the right way up and set the orientation back to normal.** If you can't turn the screen over, a kernel option can flip the image in the display hardware instead, at no cost; it is undocumented, so read its caveats first ([Alternative](#alternative-flip-the-image-in-hardware)). Details below.

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

## Alternative: flip the image in hardware

If the screen has to stay upside down in its stand, the Pi's display controller can do the 180° flip itself. The compositor then sees an unrotated output and keeps handing Chromium's frame straight to the display.

| Pi 3B, official 7" (800×480) | Rotated 180° in software | Flipped in hardware |
|---|---|---|
| Radar timeline playing at 4× | ~5 frames/s | ~59 frames/s |
| CPU used by labwc while the radar plays | ~96 % of one core | ~1 % |
| Dragging the map | ~36 frames/s | ~60 frames/s |
| Radar focus on/off (20 toggles) | ~20 frames/s | ~48 frames/s |

*Measured on 2026-10-10 on the same Pi 3B bench (commit `96b7e14`): identical, within a few tenths, to an unrotated screen.*

**Caveats — read before using it:**
- **It is not documented by Raspberry Pi**, and it relies on behaviour a Raspberry Pi engineer describes as a bug ([wlroots merge request 4508](https://gitlab.freedesktop.org/wlroots/wlroots/-/merge_requests/4508), unmerged since January 2024): the compositor never resets the flip the kernel sets at boot. A future update of the desktop (wlroots, libliftoff or labwc) could undo it, putting the image back upside down or bringing the CPU cost back. **After every `apt full-upgrade`, check that the image is still upright and run the checks below.**
- **180° only** (not 90° or 270°).
- **The mouse cursor is not flipped**: it shows at the mirrored spot. Irrelevant on a touch-only kiosk (the cursor hides as soon as the screen is touched), but a mouse becomes unusable.
- Tested on the official 7" touchscreen (v1, `DSI-1`). Other displays should take the same option with their own connector name (for example `HDMI-A-1` and its mode); untested.

**Steps** (on the Pi, as the kiosk user):

```bash
# 1. Backups
sudo cp /boot/firmware/cmdline.txt /boot/firmware/cmdline.txt.bak-hvsflip
cp ~/.config/kanshi/config ~/.config/kanshi/config.bak-hvsflip
cp ~/.config/labwc/rc.xml ~/.config/labwc/rc.xml.bak-hvsflip

# 2. Tell the kernel the panel is mounted upside down. cmdline.txt must stay ONE line;
#    don't add rotate=180 as well (the two flips would cancel out).
sudo sed -i -E '1 s/$/ video=DSI-1:800x480@60,panel_orientation=upside_down/' /boot/firmware/cmdline.txt
cat /boot/firmware/cmdline.txt

# 3. Remove the software rotation (otherwise it flips the image back)
sed -i -E 's/transform +180/transform normal/' ~/.config/kanshi/config

# 4. Flip the touch input, which no longer follows the (now normal) output
sed -i 's#</openbox_config>#  <libinput><device category="touch"><calibrationMatrix>-1 0 1 0 -1 1</calibrationMatrix></device></libinput>\n</openbox_config>#' ~/.config/labwc/rc.xml

sudo reboot
```

Step 4 assumes the touchscreen is mapped to the output (`mapToOutput="DSI-1"` in `~/.config/labwc/rc.xml`), the usual setup. If your touch was flipped with `invx,invy` on the display overlay instead, skip step 4. In both cases, tap a button after the reboot: if taps land at the mirrored spot, adjust step 4. If your `rc.xml` uses `<labwc_config>` as its root element, put the `<libinput>` line inside that element instead.

**Check after the reboot:** the boot screen and the kiosk are upright and taps land where you touch. Then:

```bash
XDG_RUNTIME_DIR=/run/user/$(id -u) WAYLAND_DISPLAY=wayland-0 wlr-randr | grep Transform   # "Transform: normal" (expected: the compositor doesn't know about the flip)
sudo dmesg | grep -i panel_orientation   # "cmdline forces connector DSI-1 panel_orientation to 1"
```

While the radar timeline plays, `top` should show `labwc` near 0-1 % instead of near 100 %.

**Undo:**

```bash
sudo cp /boot/firmware/cmdline.txt.bak-hvsflip /boot/firmware/cmdline.txt
cp ~/.config/kanshi/config.bak-hvsflip ~/.config/kanshi/config
cp ~/.config/labwc/rc.xml.bak-hvsflip ~/.config/labwc/rc.xml
sudo reboot
```

If the Pi no longer boots, edit `cmdline.txt` from another computer: it sits on the SD card's FAT boot partition.

## Related

- The kiosk's display scale ([display-scale-override-design.md](display-scale-override-design.md)) is a different setting: it changes the size of the interface, not the orientation, and has no such cost.
