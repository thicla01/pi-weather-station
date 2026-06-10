import React, { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { InlineIcon } from "@iconify/react";
import maximize from "@iconify/icons-carbon/maximize";
import minimize from "@iconify/icons-carbon/minimize";
import { AppContext } from "~/AppContext";
import WeatherMap from "~/components/WeatherMap";
import HeroCompact from "~/components/ambient/HeroCompact";
import TimeBlock from "~/components/ambient/TimeBlock";
import MetricsGrid from "~/components/ambient/MetricsGrid";
import AlertBanner from "~/components/ambient/AlertBanner";
import AlertDetailInline from "~/components/ambient/AlertDetailInline";
import AlertMiniCards from "~/components/ambient/AlertMiniCards";
import IndoorBlock from "~/components/ambient/IndoorBlock";
import ChartTabs from "~/components/ambient/ChartTabs";
import AiSummaryInline from "~/components/ambient/AiSummaryInline";
import BottomDock from "~/components/ambient/BottomDock";
import styles from "./styles.css";

/**
 * Direction C — Mobile layout (Variant A · Compagnon nomade).
 *
 * Third layout alongside `LayoutPi` (800-1279px) and `LayoutDesktop`
 * (≥1280px). Triggered for viewports < 800 px wide — in practice
 * 375-430 px portrait phones. Reuses every Direction C primitive
 * (`cTokens`, `MapBg`, `HeroCompact`, `MetricsGrid`, `AlertBanner`,
 * `ChartTabs`, `AiSummaryInline`) — no new tokens introduced.
 *
 * Structure (single scrollable column):
 *   ┌──────────────────────────────┐
 *   │ TimeBlock                    │  ◀ clock + sunrise/sunset
 *   │ AlertBanner                  │  ◀ government alert (when active)
 *   │ HeroCompact                  │  ◀ location, big temp, condition
 *   │ AlertDetailInline            │  ◀ expanded alert (tap to open)
 *   │ MetricsGrid                  │  ◀ wind / humid / UV / AQ tiles
 *   │ IndoorBlock                  │  ◀ Homebridge temps (when configured)
 *   │ Radar mini (~220 px) [⛶]    │  ◀ small inset map; maximize toggle
 *   │ ChartTabs                    │  ◀ 24h hourly chart
 *   │ AiSummaryInline              │  ◀ Claude-generated summary
 *   │ Footer hint                  │  ◀ "settings live on the Pi"
 *   ├──────────────────────────────┤
 *   │ BottomDock                   │  ◀ palette + marker + recenter
 *   └──────────────────────────────┘
 *
 * **Design intent — "Compagnon nomade" (Variant A from the design
 * package, DESIGN-NOTES §14):** the mobile is for the user who is
 * AWAY from the Pi and wants a quick read of conditions / alerts.
 * The dock is kept on this implementation (vs. the stricter Variant A
 * which omits it) because the existing dock buttons are pure view
 * toggles (palette, marker, etc.) — useful from any browser. API
 * keys, debug, and the full settings panel remain Pi-only (gated by
 * `isLocal` in their respective handlers).
 *
 * **Radar maximize** (v2.15.2): the mini radar card carries a
 * maximize toggle in its top-right corner. Tapping it promotes the
 * card to `position: absolute; inset: 12px` so the radar fills the
 * scroll container — at which point the radar timeline scrubber and
 * the precipitation legend (both inside `WeatherMap`) become readable.
 * In mini mode (220 px tall) those overlays would crowd the small
 * tile area; CSS in this module hides them while the card is mini.
 * Same affordance language ChartTabs and AiSummaryInline use.
 *
 * Safe areas are handled via `env(safe-area-inset-*)` in styles.css
 * so the scroll area clears the iOS notch + home indicator. PWA-ready:
 * the palette tokens applied at the `.ambientRoot` level inherit to
 * the standalone-mode chrome without extra work.
 *
 * @returns {JSX.Element} Mobile layout
 */
const LayoutMobile = () => {
  const { t } = useTranslation();
  const {
    darkMode,
    defaultMapZoom,
    mouseHide,
    mobileRadarMaximized,
    setMobileRadarMaximized,
    radarTimelineVisible,
    toggleRadarTimelineVisible,
  } = useContext(AppContext);

  // Radar maximize state lives in AppContext (see the field's comment
  // there for the full rationale). LayoutMobile owns the toggle UI;
  // WeatherMap reads the state to re-center / invalidateSize on
  // change; ControlButtons reads it to grey out the timeline + legend
  // dock buttons while the radar overlays they control are hidden.
  const mapCardRef = useRef(null);
  const scrollRef = useRef(null);

  // Pull-to-refresh. Primary use case: PWA standalone mode on iOS
  // where the browser's reload UI isn't reachable (no address bar,
  // no Cmd+R). The .scroll container captures touch deltas while
  // scrollTop === 0 and surfaces a small indicator. Crossing
  // `PTR_THRESHOLD` triggers a `location.reload()`. Below the
  // threshold the indicator springs back. The dock button is the
  // discoverable counterpart of the same action.
  const PTR_THRESHOLD = 80;
  const PTR_MAX = 120;
  const [pullDistance, setPullDistance] = useState(0);
  const [pullArmed, setPullArmed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const ptrStateRef = useRef({ startY: 0, active: false });
  // Mirror refs for the state values read inside the touch
  // handlers. Without these, the effect below would need
  // `[pullArmed, pullDistance, refreshing]` in its deps to capture
  // the latest values via closure — and `setPullDistance` fires on
  // every `touchmove` (~60×/s during a pull). The four listeners
  // would tear down + re-install at the same rate, ~240 add/remove
  // ops per second. Cheap-ish but wasteful. By mirroring the state
  // into refs and reading the refs inside the handlers, the effect
  // can subscribe once on mount and the handlers always see the
  // latest value without re-subscription. Cf. design audit B3
  // (2026-05-28).
  const pullArmedRef = useRef(false);
  const pullDistanceRef = useRef(0);
  const refreshingRef = useRef(false);

  useEffect(() => { pullArmedRef.current = pullArmed; }, [pullArmed]);
  useEffect(() => { pullDistanceRef.current = pullDistance; }, [pullDistance]);
  useEffect(() => { refreshingRef.current = refreshing; }, [refreshing]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const onStart = (e) => {
      if (el.scrollTop > 0 || refreshingRef.current) return;
      ptrStateRef.current = { startY: e.touches[0].clientY, active: true };
    };
    const onMove = (e) => {
      const st = ptrStateRef.current;
      if (!st.active) return;
      const delta = e.touches[0].clientY - st.startY;
      if (delta <= 0) {
        if (pullDistanceRef.current !== 0) setPullDistance(0);
        if (pullArmedRef.current) setPullArmed(false);
        return;
      }
      // Damped travel — pulls past PTR_MAX get diminishing returns.
      const damped = Math.min(PTR_MAX, delta * 0.5);
      setPullDistance(damped);
      setPullArmed(damped >= PTR_THRESHOLD);
    };
    const onEnd = () => {
      const st = ptrStateRef.current;
      if (!st.active) return;
      ptrStateRef.current = { startY: 0, active: false };
      if (pullArmedRef.current && !refreshingRef.current) {
        setRefreshing(true);
        setPullDistance(PTR_THRESHOLD);
        setTimeout(() => window.location.reload(), 200);
      } else {
        setPullDistance(0);
        setPullArmed(false);
      }
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state values are read via mirror refs (above) so the effect can subscribe once on mount, not 60×/s during a pull
  }, []);

  // When entering maximize mode, scroll the scroll container to the
  // top so the absolutely-positioned card (pinned to the scroll's
  // content origin, not its viewport) lands inside the visible area.
  // Without this, if the user had scrolled down to reach the radar
  // before tapping maximize, the promoted card would expand ABOVE the
  // current scroll position — full-size and opaque but invisible until
  // the user manually scrolled back up. Mirrors the same pattern in
  // AiSummaryInline.
  useEffect(() => {
    if (!mobileRadarMaximized || !mapCardRef.current) return;
    let el = mapCardRef.current.parentElement;
    while (el && el !== document.body) {
      const overflowY = window.getComputedStyle(el).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        el.scrollTop = 0;
        break;
      }
      el = el.parentElement;
    }
  }, [mobileRadarMaximized]);

  // Auto-deactivate the radar timeline scrubber when the user
  // minimizes the radar card. The scrubber is CSS-hidden in mini mode
  // (no readable room), and the dock's timeline button is greyed out
  // (see `ControlButtons` `radarOverlaysDisabled`), so a `true`
  // scrubber state stuck across a minimize would be unreachable from
  // the user's standpoint — they'd have to re-maximize just to flip
  // it off. Resetting on minimize keeps the dock button's visual
  // state aligned with the (invisible) scrubber state.
  //
  // Gated on the maximized→mini TRANSITION (prev ref), not the value:
  // the lifecycle effect below sets `mobileRadarMaximized` to `false`
  // on mount, and an un-gated `=== false` check fired on that mount
  // pass too — toggleRadarTimelineVisible() persists to localStorage,
  // so every LayoutMobile mount silently flipped the user's saved
  // scrubber preference off (defeating the "default true so first-time
  // users see the timeline" intent).
  const prevRadarMaximizedRef = useRef(mobileRadarMaximized);
  useEffect(() => {
    const wasMaximized = prevRadarMaximizedRef.current === true;
    prevRadarMaximizedRef.current = mobileRadarMaximized;
    if (wasMaximized && mobileRadarMaximized === false && radarTimelineVisible) {
      toggleRadarTimelineVisible();
    }
  }, [mobileRadarMaximized, radarTimelineVisible, toggleRadarTimelineVisible]);

  // Lifecycle: signal to AppContext consumers that we're on the
  // mobile layout. The tri-state value is `false` (mini, default)
  // while we're mounted and `null` once we unmount — that way the
  // dock's timeline + legend disable rule (which keys on `=== false`)
  // only kicks in while LayoutMobile is actually active.
  useEffect(() => {
    setMobileRadarMaximized(false);
    return () => setMobileRadarMaximized(null);
  }, [setMobileRadarMaximized]);

  return (
    <div className={styles.layout}>
      {/* Pull-to-refresh indicator. Floats above the scroll content
       * (position: absolute, top: 0) and translates down based on the
       * current pull distance. Inert visual once `refreshing` is true. */}
      {(pullDistance > 0 || refreshing) && (
        <div
          className={styles.ptrIndicator}
          style={{ transform: `translateY(${pullDistance}px)` }}
          role="status"
          aria-live="polite"
        >
          <div className={`${styles.ptrSpinner} ${refreshing ? styles.ptrSpinning : ""} ${pullArmed ? styles.ptrArmed : ""}`} />
          <span className={styles.ptrLabel}>
            {refreshing
              ? t("toasts.refreshing", { defaultValue: "Refreshing…" })
              : pullArmed
                ? t("toasts.refreshing", { defaultValue: "Refreshing…" })
                : t("controls.refreshApp", { defaultValue: "Refresh app" })}
          </span>
        </div>
      )}
      <div
        ref={scrollRef}
        className={styles.scroll}
        style={pullDistance > 0 ? { transform: `translateY(${pullDistance}px)` } : undefined}
      >
        <TimeBlock />
        {/* AlertBanner + AlertDetailInline placed just under
         * TimeBlock (ABOVE HeroCompact), matching the v2 InfoPanel
         * .alertArea position and the LayoutPi ordering. Both
         * components return null when no eligible alert is active,
         * so this slot is invisible on calm days. */}
        <AlertBanner />
        <AlertDetailInline />
        <AlertMiniCards />
        <HeroCompact />
        <MetricsGrid />
        <IndoorBlock />
        <div
          ref={mapCardRef}
          className={`${styles.mapCard} ${mobileRadarMaximized ? styles.mapCardMaximized : ""} map-container ${darkMode ? "map-dark-mode" : ""} ${mouseHide ? "map-mouse-hide" : ""}`}
          data-mobile-radar-maximized={mobileRadarMaximized ? "true" : undefined}
        >
          <WeatherMap zoom={defaultMapZoom} dark={darkMode} />
          <button
            type="button"
            className={styles.mapMaximizeButton}
            onClick={() => setMobileRadarMaximized(!mobileRadarMaximized)}
            aria-pressed={mobileRadarMaximized}
            aria-label={t(mobileRadarMaximized ? "controls.minimizeRadar" : "controls.maximizeRadar", {
              defaultValue: mobileRadarMaximized ? "Restore radar size" : "Expand radar",
            })}
            title={t(mobileRadarMaximized ? "controls.minimizeRadar" : "controls.maximizeRadar", {
              defaultValue: mobileRadarMaximized ? "Restore radar size" : "Expand radar",
            })}
          >
            <InlineIcon icon={mobileRadarMaximized ? minimize : maximize} />
          </button>
        </div>
        <ChartTabs />
        <AiSummaryInline />
        <div className={styles.footer}>
          {t("mobile.settingsHint", {
            defaultValue: "Pour les réglages avancés, ouvre l'app depuis le Pi en local.",
          })}
        </div>
      </div>
      <BottomDock />
    </div>
  );
};

export default LayoutMobile;
