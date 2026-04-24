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

**Fix — config file (alternative)**

Edit `~/.config/labwc/rc.xml` and set `mouseEmulation` to `no` for the DSI-1 display entry:

```xml
<mouseEmulation>no</mouseEmulation>
```

> **Note:** In practice this file-based setting has been found to be unreliable on Trixie. Prefer the GUI method above.

**Result**

Once Multitouch is enabled:

- Small buttons respond accurately to light taps.
- Swipe-to-scroll works in the info panel (forecast charts, AI Summary).
- The AI Summary panel correctly slides up over the location name when opened.
- Pinch-to-zoom in and out works correctly on the radar map.
