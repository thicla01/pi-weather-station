import React, { useContext } from "react";
import { useTranslation } from "react-i18next";
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
 *   │ Radar (constrained ~220 px)  │  ◀ small inset map with rings
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
  } = useContext(AppContext);

  return (
    <div className={styles.layout}>
      <div className={styles.scroll}>
        <TimeBlock />
        <HeroCompact />
        <AlertBanner />
        <AlertDetailInline />
        <MetricsGrid />
        <IndoorBlock />
        <div className={`${styles.mapCard} map-container ${darkMode ? "map-dark-mode" : ""} ${mouseHide ? "map-mouse-hide" : ""}`}>
          <WeatherMap zoom={defaultMapZoom} dark={darkMode} />
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
