import { useEffect, useLayoutEffect, useRef } from "react";
import { afterNextFrame } from "./useShellTiming";
import { createSheetWarmup, whenIdle } from "~/ui/sheetWarmup";
import { createStyleWarmup } from "~/ui/styleWarmup";

/* Overlay shell: lay out AND paint each hidden view host once, out of
 * sight, before its first opening.
 *
 * Under the overlay shell the four view hosts sit in the sheet and the other
 * states' are skipped by `content-visibility: hidden` (styles.css), which
 * keeps a host's layout for its next reveal once it has been revealed.
 * Revealing the never-revealed conditions and alert hosts for one idle frame
 * with the sheet still closed spares their first opening after boot their
 * style and layout (first openings at 4× CPU throttling, conditions
 * 41.9 → 26.2 ms and alert 40.4 → 24.6 ms, against 26.6 and 25.2 for the
 * grid shell at 800 × 480; medians of 6 boots). But the first opening since
 * load still paid the first rasterization of the views' content: a frame
 * skipped at the start of the slide in 8 first openings out of 8,
 * compositor / GPU side, the caches a later opening finds warm (shader
 * programs, glyphs, decoded images) never having met that content.
 *
 * So each host is also painted once: in its warm frame the root's
 * `data-pi-warm` names the host's state, and styles.css both un-skips that
 * host and puts the closed sheet in place at opacity 0.001 with its own
 * layer, inert and taking no pointer, which the compositor rasterizes like
 * an opening's and draws without changing a pixel; the next frame takes it
 * off and the layer is dropped. That layer is transient — one frame per
 * host, on screen, never off screen, never kept — and noted as such: no
 * mechanism paints the sheet without one. All four hosts (the forecast and
 * AI views' first rasterization too), each once with content mounted at its
 * top, again when content mounts there later (the alert view renders nothing
 * until an alert arrives: a MutationObserver on the host's own children, not
 * its subtree, so data updates inside don't). Only at rest with the sheet
 * closed (MID or MIN, settled, the data in), once the page has loaded with
 * its fonts, a quiet second after the load, the rest's start and the last
 * input or scroll, never with a pointer down (a finger held through a native
 * scroll included), in an idle callback; any pointerdown, keydown or wheel
 * cancels at once. Mechanism, timing, constants, what it cannot warm, and
 * the attributes it sets (`data-pi-warm`, which styles.css reads, and
 * `data-pi-warmed`, for measurement tooling only): ui/sheetWarmup.js.
 *
 * With `styleWarm`, the same scheduler then runs the style warm-up of the
 * alert view's switch, once the alert host is warm — one synchronous task
 * at rest in MID that writes what the switch's commits write, forces style
 * without a layout and puts it all back (ui/styleWarmup.js), its `style`
 * token then in `data-pi-warmed`. The elements are read when the task
 * runs: this hook's refs, the shell registry's view chrome, and Leaflet's
 * zoom bar, looked up in the root once and again only when the one found
 * is gone (as WeatherMap's ShellZoomInert does). */

/**
 * Lays out and paints each of the given hidden view hosts once, out of sight
 * (see the comment above and ui/sheetWarmup.js).
 *
 * @param {Array<{state: string, ref: {current: ?Element}}>} hosts - The hosts to warm, in order, each with the `data-pi-state` that shows it (a stable array; empty: nothing runs).
 * @param {boolean} atRest - The overlay shell on, the sheet closed (MID or MIN), the last switch settled, and the weather data in.
 * @param {{current: ?Element}} rootRef - LayoutPi's root (read in the effects only).
 * @param {{current: ?Element}} sheetRef - The view sheet (read when an input takes a warm pose off, to flush style).
 * @param {?{railRef: {current: ?Element}, dockCellRef: {current: ?Element}, dockShieldRef: {current: ?Element}, dockGuardRef: {current: ?Element}, alertHostRef: {current: ?Element}, shieldClassName: string, shellElements: {viewChrome: function(): Element[]}}} [styleWarm] - The style warm-up's elements (a stable object; null: no style warm-up): the rail frame, the dock cell, the dock band's shield and its guard, the alert host, the views' shield class, and the shell registry.
 * @returns {void}
 */
export default function useHostWarmup(hosts, atRest, rootRef, sheetRef, styleWarm = null) {
  // The scheduler of the current host set, and the last `atRest` it was told.
  const warmupRef = useRef(null);
  const atRestRef = useRef(atRest);

  useEffect(() => {
    const root = rootRef.current;
    if (!hosts.length || !root) return undefined;
    // The style warm-up's zoom bar: Leaflet builds it, so it is looked up — once, and again only when the one found is gone.
    let zoomBar = null;
    const findZoomBar = () => {
      if (!zoomBar || !zoomBar.isConnected) zoomBar = root.querySelector(".leaflet-control-zoom");
      return zoomBar;
    };
    const styleWarmup = styleWarm
      ? createStyleWarmup({
        elements: () => ({
          root,
          rail: styleWarm.railRef.current,
          sheet: sheetRef.current,
          dockCell: styleWarm.dockCellRef.current,
          dockShield: styleWarm.dockShieldRef.current,
          dockGuard: styleWarm.dockGuardRef.current,
          alertHost: styleWarm.alertHostRef.current,
          viewChrome: styleWarm.shellElements.viewChrome(),
          zoomBar: findZoomBar(),
          shieldClassName: styleWarm.shieldClassName,
        }),
      })
      : null;
    const warmup = createSheetWarmup({
      root,
      inputTarget: window,
      hosts: hosts.map(({ state, ref }) => ({ state, element: () => ref.current })),
      whenIdle: (step) => whenIdle(step, window),
      afterFrames: afterNextFrame,
      // An input took a warm pose off: the sheet's closed pose computed now,
      // so a view this tap opens slides from it.
      flushStyle: () => {
        const sheet = sheetRef.current;
        if (sheet) window.getComputedStyle(sheet).getPropertyValue("transform");
      },
      styleWarmup,
    });
    warmupRef.current = warmup;
    warmup.setAtRest(atRestRef.current);

    // The first load: the page's resources, then its fonts (glyphs warmed in
    // a fallback font would be the wrong ones).
    let cancelled = false;
    const onLoad = () => {
      window.removeEventListener("load", onLoad);
      const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
      fontsReady.then(() => {
        if (!cancelled) warmup.setLoaded(true);
      });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad);

    // Content mounted at a host's top after it was warmed: warm it again.
    let observer = null;
    if (typeof MutationObserver !== "undefined") {
      observer = new MutationObserver((records) => {
        for (const record of records) {
          const host = hosts.find((h) => h.ref.current === record.target);
          if (host && record.addedNodes.length > 0) warmup.contentChanged(host.state);
        }
      });
      for (const host of hosts) if (host.ref.current) observer.observe(host.ref.current, { childList: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", onLoad);
      if (observer) observer.disconnect();
      warmup.dispose();
      warmupRef.current = null;
    };
  }, [hosts, rootRef, sheetRef, styleWarm]);

  // In the commit (a layout effect): a switch's own commit leaves the rest,
  // and a warm pose then comes off before that frame paints, so no opening
  // frame shows another view's host. (A view opens from a tap or a key,
  // whose pointerdown or keydown has already taken the pose off and
  // flushed style, so its sheet slides from the closed pose.)
  useLayoutEffect(() => {
    atRestRef.current = atRest;
    if (warmupRef.current) warmupRef.current.setAtRest(atRest);
  }, [atRest]);
}
