import React, { useContext, useEffect, useRef } from "react";
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
 *   │ HeroCompact                  │  ◀ location, big temp, condition
 *   │ AlertBanner                  │  ◀ government alert (when active)
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
  } = useContext(AppContext);

  // Radar maximize state lives in AppContext (see the field's comment
  // there for the full rationale). LayoutMobile owns the toggle UI;
  // WeatherMap reads the state to re-center / invalidateSize on
  // change; ControlButtons reads it to grey out the timeline + legend
  // dock buttons while the radar overlays they control are hidden.
  const mapCardRef = useRef(null);

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
      <div className={styles.scroll}>
        <TimeBlock />
        <HeroCompact />
        <AlertBanner />
        <AlertDetailInline />
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
