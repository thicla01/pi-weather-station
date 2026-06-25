# Troubleshooting — Raspberry Pi Official 7" Touchscreen

## Imprecise tapping / small buttons hard to hit / scroll not working

**Symptoms**

- Small buttons (settings, debug, dark-mode toggle) are difficult to tap accurately.
- The AI Summary panel does not scroll when swiping.
- Taps register slightly off from where you touched.

**Cause**

Raspberry Pi OS Trixie (and some Bookworm builds) enables **Mouse Emulation** mode for the official Raspberry Pi 7" touchscreen by default. In this mode the OS translates raw touch events into mouse cursor events (left-click, right-click, drag). This introduces positioning lag and suppresses native multitouch/scroll gestures that the app relies on.

**Fix — GUI (recommended)**

1. Open **Control Centre** (top-right corner of the desktop taskbar).
2. Go to **Screens → Screens → DSI-1 → Touchscreen**.
3. Change **Mode** from `Mouse Emulation` to `Multitouch`.
4. The change takes effect immediately — no reboot required.

**Fix — config file (alternative, and more reliable than the GUI on Trixie)**

labwc matches its touch config **per device**, so the override must name the exact device. Find that name first:

```bash
sudo libinput list-devices | grep -iE 'Device:|touch'
# e.g. "10-0038 generic ft5x06 (79)"  — official 7" panel (ft5x06 on i2c bus 10)
```

Then add a matching `<touch>` element to `~/.config/labwc/rc.xml` (copy `/etc/xdg/labwc/rc.xml` first if the user file doesn't exist yet) with `mouseEmulation="no"`:

```xml
<touch deviceName="10-0038 generic ft5x06 (79)" mapToOutput="DSI-1" mouseEmulation="no"/>
```

Reload with `labwc --reconfigure` (or reboot).

> **Note:** the older standalone `<mouseEmulation>no</mouseEmulation>` form does **not** work on Trixie's labwc. It must be the `<touch … mouseEmulation="no"/>` element above, with a `deviceName` that exactly matches what `libinput list-devices` reports.

**Result**

Once Multitouch is enabled:

- Small buttons respond accurately to light taps.
- Swipe-to-scroll works in the info panel (forecast charts, AI Summary).
- The AI Summary panel correctly slides up over the location name when opened.
- Pinch-to-zoom in and out works correctly on the radar map.

---

## The Touchscreen / Multitouch option disappeared from Control Centre (or touch stopped working entirely)

**Symptoms**

- The **Screens → DSI-1 → Touchscreen** submenu (the Mouse Emulation / Multitouch toggle) is **gone** from Control Centre.
- Touch may also be completely unresponsive.
- Often shows up right after an OS update/upgrade — i.e. after the reboot it triggers.

**Cause**

Control Centre only builds the per-display **Touchscreen** submenu when a touch input *device* is detected and bound to that output. If the touch controller fails to initialise at boot there is no device → no menu. **The missing option is a symptom, not a settings regression** — and toggling the menu is not the fix because there is nothing to toggle.

On the official 7" panel the touch controller (`edt_ft5x06`, i2c address `0x38`) sits on the DSI flat-flex ribbon's i2c bus, shared with the backlight and the panel. A marginal ribbon/connector makes the probe fail intermittently:

```bash
sudo dmesg | grep -iE 'ft5|edt|touchscreen'
# Bad boot:  edt_ft5x06 10-0038: probe with driver edt_ft5x06 failed with error -5
# Good boot: input: 10-0038 generic ft5x06 (79) as /devices/.../10-0038/input/input4

sudo libinput list-devices | grep -iE 'Device:|touch'   # is any touch device present?
```

`error -5` is **EIO** — an I/O error talking to the chip over i2c, i.e. an electrical/connection problem. The kernel/OS update is **not** the cause; its reboot merely power-cycled a contact that was already marginal.

**Fix**

1. **Reboot.** The probe failure is often transient (an i2c init race at power-up); a clean boot usually re-detects the controller and the menu returns. If you already have the `<touch … mouseEmulation="no"/>` override above, multitouch is re-applied automatically — you don't even need the menu.
2. **If it keeps failing across boots → reseat the DSI ribbon.** Power off (unplug, cold), reseat the flat-flex at **both** ends (the Pi's DSI connector and the display adapter board), and make sure both FPC latches are fully closed with the ribbon square and fully inserted.
3. **If it still fails → replace the DSI FFC ribbon.** It is the known weak point of the official 7" display.

---

## Screen is backlit but black — no image (touch and backlight still work)

**Symptoms**

- The panel is clearly **backlit** (lit, but showing black) — not powered off.
- **Touch works** (tapping deploys menus) and the desktop is visible over **RPi Connect screen sharing** — yet the physical panel shows nothing.

**Cause**

RPi Connect screen sharing captures the **composited framebuffer** (a screencopy of the output), *not* what the panel physically receives. So "the image looks fine in screen share" does **not** prove the DSI video link is delivering pixels.

This is the same marginal-DSI-ribbon failure as the section above, but hitting the **high-speed video lanes** instead of the (low-speed) i2c lines. The tell: everything on the slow lines works (touch `0x38`, backlight `0x45`, DSI init/control) while only the HS video fails. KMS looks completely healthy:

```bash
# Wayland tools need these in an ssh one-shot:
export XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0
wlr-randr                                                    # DSI-1 enabled, mode set, no error
cat /sys/class/drm/card*/card*-DSI-1/{status,enabled,dpms}   # connected / enabled / On
sudo dmesg | grep -iE 'vc4|dsi|underrun|flip_done'           # no scanout errors
cat /sys/class/backlight/*/actual_brightness                 # backlight is on (non-zero)
```

A forced modeset (`wlr-randr --output DSI-1 --off` then `--on --mode 800x480 --transform 180`) re-trains the link, but does **not** restore the image when the ribbon is the problem.

**Fix**

Same as the section above — **cold power-cycle and reseat the DSI ribbon at both ends; replace the FFC if it recurs.** A warm reboot may not fully reset the DSI PHY, so pull power for ~10 s rather than just rebooting.

> **Backlight nodes:** `10-0045` is the real one (the Atmel backlight controller on i2c); `rpi_backlight` is the legacy firmware interface. A black-but-backlit panel whose `actual_brightness` on `10-0045` is non-zero rules out a brightness/screensaver cause and points squarely at the video link.
