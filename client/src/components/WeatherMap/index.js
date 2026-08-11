import React, {
  useEffect,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  MapContainer,
  TileLayer,
  WMSTileLayer,
  AttributionControl,
  ZoomControl,
  Marker,
  Circle,
  CircleMarker,
  Polyline,
  GeoJSON,
  Popup,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
// Bundle Leaflet's stylesheet via webpack instead of the CDN <link>
// that index.html used to carry. The CDN <link> + <script> were
// failing SRI checks after unpkg shipped a re-encoded build whose
// SHA-256 no longer matched the pinned hash; the <script> was also
// dead weight since react-leaflet pulls its Leaflet JS from the npm
// package above. Importing the CSS here ties stylesheet loading to
// the component that actually needs it.
import "leaflet/dist/leaflet.css";
// Default marker icons — bundle them via webpack and re-point
// L.Icon.Default so `<Marker>` without an explicit `icon` prop
// renders correctly. Leaflet's defaults assume the images live
// next to leaflet.js at runtime, which isn't the case when
// react-leaflet pulls leaflet from the npm bundle. Without this
// remap the marker fetches resolve to the site root and 404.
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIcon2xUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIcon2xUrl,
  shadowUrl: markerShadowUrl,
});
import PropTypes from "prop-types";
import {
  AppActionsContext,
  SystemContext,
  LocationContext,
  UiPrefsContext,
  AlertsContext,
  RadarStateContext,
} from "~/AppContext";
import useEligibleGovAlerts from "~/hooks/useEligibleGovAlerts";
import SourceBadge from "~/components/ambient/SourceBadge";
import SeverityChip from "~/components/ambient/SeverityChip";
import { useTimeOfDay } from "~/ui/hybrid";
import { isPiMaxView, priorityViewsEnabled } from "~/ui/piLayout";
import { useTranslation } from "react-i18next";
import debounce from "debounce";
import axios from "axios";
import styles from "./styles.css";
import RadarLegend from "./RadarLegend";
import RadarTimeline from "./RadarTimeline";
import RiskRing from "./RiskRing";
import RingLabels from "./RingLabels";
import MapResizer from "./MapResizer";
import RadarFocusControl from "./RadarFocusControl";
import {
  hasVal,
  tierForIntensity,
  buildArrowPath,
  buildSamplingPoints,
  panWithRailOffset,
  KM_PER_UNIT,
  METERS_PER_UNIT,
  RADAR_GEOMETRY,
  DIR_INNER_TO_BEARING,
  DIR_OUTER_TO_BEARING,
  ARROW_COLOR,
  DOT_COLOR_BY_TIER,
  buildAlertPolygonLayers,
  buildRadiusRingOptions,
  pointInGeometry,
} from "./geometry";


/* Shared empty-list default for the alert overlay components below.
 * Module-scope so an omitted prop keeps ONE stable reference across
 * renders — a bare `= []` signature default would allocate a fresh
 * array per render and bust AlertGeometryOverlay's `[govAlerts, …]`
 * memo chain (the same reference-stability contract as the layer-prop
 * memos in the main component). Frozen so nothing can mutate the
 * shared default. */
const NO_ALERTS = Object.freeze([]);

/* Zoom threshold above which the analysis-zone dashed circles AND
 * the sampling-point dots stop rendering. At z=13 the inner 50 km
 * circle has a pixel radius of ~3700 px (≈ 2.7× the iPad viewport
 * width) so most of it is already off-screen; by z=14 it's ~7460 px
 * (entirely off-screen). Beyond that the SVG element is dead
 * weight in the DOM — invisible but still maintained by the
 * renderer, contributing to the pan-jank observed on macOS Firefox
 * and Safari iPad at high zoom. Hiding them frees the SVG layer
 * and restores smooth panning. */
const RING_HIDE_ZOOM = 13;

// Visual nudge for the nearby-alerts radius ring when it would land exactly
// on a drawn radar analysis ring. This only happens in KM mode at 50 / 100 km
// (the radar rings are 50 / 100 km): the alert radius is always stored in km,
// so its drawn circle coincides pixel-for-pixel with the radar circle and the
// dotted ring hides under it, reading as invisible. In MI mode the radar rings
// are 30 / 60 mi (48.3 / 96.6 km) while the alert ring is still drawn from km
// (50 / 100 km), so they're already ~1.7 / 3.4 km apart and visible — no nudge.
// Display-only: the survey *query* radius (alertRadiusKm) is unchanged; only
// the drawn circle is pushed a few km outward (matching the mi-mode offset) so
// it stays legible. The ring is a round proxy for the radius, never a precise
// instrument, so a ~3 km visual offset on a 50 km circle is immaterial.
const ALERT_RING_OVERLAP_EPS_M = 500;   // treat as "on top of" a radar ring within 0.5 km
const ALERT_RING_NUDGE_M = 3000;        // push 3 km outward, just past the radar ring

// Paint order for the nearby-alerts survey polygons, keyed by display tier.
// Leaflet paints later-inserted vector layers ON TOP, and the survey routinely
// contains overlapping — or identical — NWS geometries (a Flood Warning nested
// in a Flood Watch + Advisory; or two zone-based alerts sharing one county
// polygon). The incoming list is sorted worst-first, so a naive map() inserts
// the most severe FIRST (bottom) and the least severe LAST (top) — the yellow
// Advisory then buries the red Warning, and a shared zone reads yellow even
// though a Warning covers it. Rendering in ASCENDING severity puts the worst
// tier last so it paints on top. See issue #252.
const TIER_PAINT_ORDER = { yellow: 0, orange: 1, red: 2 };

/**
 * Build the custom DivIcon used for the user's location marker. v2.14.64
 * replaces Leaflet's default blue teardrop pin — that bright blue
 * stood out against every palette (especially nightRed where it
 * looked alien) and was hard to see on the 7" kiosk at glance
 * distance. The target-style marker (outer ring + filled centre dot)
 * picks up `--c-accent` from the active palette via CSS variables, so
 * it auto-tints with day / dusk / night / nightRed without per-palette
 * overrides. Sized at 22 × 22 with the anchor centred so the dot sits
 * exactly on the selected coordinates.
 *
 * @returns {import("leaflet").DivIcon} Leaflet DivIcon ready for `<Marker icon={…}>`
 */
function buildLocationMarkerIcon() {
  return L.divIcon({
    className: "weather-station-target",
    html:
      '<div class="weather-station-target__ring">' +
      '<div class="weather-station-target__dot"></div>' +
      '</div>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}
const LOCATION_MARKER_ICON = buildLocationMarkerIcon();




// Mapbox basemaps served via the server proxy (keeps the API key off the client).
const MAPBOX_ATTRIBUTION = '© <a href="https://www.mapbox.com/feedback/">Mapbox</a>';


/**
 * Handles map click events from inside the MapContainer context
 *
 * @param {object} props
 * @param {Function} props.onClick click handler
 * @returns {null} renders nothing
 */
const MapClickHandler = ({ onClick }) => {
  useMapEvents({ click: onClick });
  return null;
};

MapClickHandler.propTypes = {
  onClick: PropTypes.func.isRequired,
};


/**
 * Pans the map when panToCoords changes
 *
 * @param {object} props
 * @param {object} props.panToCoords target coordinates
 * @param {Function} props.setPanToCoords resets panToCoords to null
 * @returns {null} renders nothing
 */

/**
 * Read the visible rail's pixel width once on mount + whenever the
 * radar focus-mode flags toggle. Queries the DOM directly
 * because the value lives in CSS variables on `.ambientRoot` and on
 * the rail's actual rendered bounding rect (the `--c-rail-width`
 * value differs between LayoutDesktop and LayoutPi, and is bumped
 * to 360 px on wide displays via a media query). Returns 0 when
 * there's no rail overlaying the map (radar focus mode, a layout
 * where the rail sits in its own grid column, no ambientRoot).
 *
 * The 1-frame timeout is load-bearing for the initial measurement:
 * WeatherMap mounts inside the rail-bearing layout, so the rail's
 * geometry isn't yet laid out when this effect's first synchronous
 * pass runs. Deferring by a frame lets the browser commit the
 * stylesheet before we measure.
 *
 * @returns {Number} rail width in pixels (0 if no offset needed)
 */
function useRailOffset() {
  const { desktopRadarMaximized, piRadarMaximized } = useContext(SystemContext);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useEffect(() => {
    // Focus mode hides HeroBand + rail via display:none. Bail with
    // a zero offset so the marker pans to the geometric centre of
    // the now-empty viewport. The flag is also in the dep array so
    // toggling focus re-runs this effect (without it the offset
    // stayed at the last-measured value and the marker stayed
    // shifted as if the rail were still visible).
    if (desktopRadarMaximized || piRadarMaximized) {
      setOffset({ x: 0, y: 0 });
      return undefined;
    }
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const rail = document.querySelector(".ambientRoot aside");
      const hero = document.querySelector(".ambientRoot [data-ambient-hero]");
      // `data-ambient-hero` is only set in LayoutDesktop, where the map
      // is full-bleed and BOTH the HeroBand (top) and the rail (right
      // edge) OVERLAY the map. On LayoutPi the map sits in its own
      // grid column with the rail in a separate column, so the visible
      // map area is already the full map — no shift needed at all.
      // Pre-v2.14.68 the horizontal offset was applied on every
      // layout, which pushed the marker to the far left on LayoutPi
      // (rail offset shifted the map centre right when the marker was
      // already in the clear). Gating BOTH axes on `hero` keeps the
      // overlay correction limited to LayoutDesktop where it belongs.
      const railOverlaysMap = !!hero;
      const x = (rail && railOverlaysMap) ? Math.round(rail.getBoundingClientRect().width) : 0;
      const y = hero ? Math.round(hero.getBoundingClientRect().height) : 0;
      setOffset({ x, y });
    };
    const handle = requestAnimationFrame(measure);
    // Re-measure on viewport size changes — LayoutDesktop bumps rail
    // width from 320 → 360 px above 1900 px wide via a media query,
    // and the HeroBand's height can shift if its content reflows.
    window.addEventListener("resize", measure);
    return () => {
      cancelled = true;
      cancelAnimationFrame(handle);
      window.removeEventListener("resize", measure);
    };
  }, [desktopRadarMaximized, piRadarMaximized]);
  return offset;
}

const PanHandler = ({ panToCoords, setPanToCoords, railOffset }) => {
  const map = useMap();
  useEffect(() => {
    if (panToCoords) {
      panWithRailOffset(map, [panToCoords.latitude, panToCoords.longitude], railOffset);
      setPanToCoords(null);
    }
  }, [panToCoords, map, setPanToCoords, railOffset]);
  return null;
};

PanHandler.propTypes = {
  panToCoords: PropTypes.object,
  setPanToCoords: PropTypes.func.isRequired,
  railOffset: PropTypes.shape({ x: PropTypes.number, y: PropTypes.number }),
};

/**
 * Re-centres the map whenever `railOffset` changes — collapsing or
 * expanding the rail, or switching layouts, would otherwise leave
 * the marker in the wrong visual position. Pulls the current marker
 * latLng from context and re-applies the offset trick. Skipped when
 * `markerPosition` isn't yet set (initial load before mapGeo lands).
 */
const RailOffsetTracker = ({ railOffset, markerPosition }) => {
  const map = useMap();
  const lastOffsetRef = useRef(railOffset);
  useEffect(() => {
    // useRailOffset returns a fresh object every render even when
    // values haven't changed, so compare by x/y rather than identity.
    // Skip the first run so the initial mount doesn't double-pan —
    // InitialOffsetCentering handles the boot case explicitly.
    const prev = lastOffsetRef.current;
    if (prev && prev.x === railOffset.x && prev.y === railOffset.y) return;
    lastOffsetRef.current = railOffset;
    if (!markerPosition) return;
    panWithRailOffset(map, markerPosition, railOffset, { animate: true });
  }, [railOffset, markerPosition, map]);
  return null;
};

RailOffsetTracker.propTypes = {
  railOffset: PropTypes.shape({ x: PropTypes.number, y: PropTypes.number }),
  markerPosition: PropTypes.array,
};

/**
 * Applies the rail offset on initial mount — MapContainer's `center`
 * prop is read once and never re-applied, so without this effect the
 * marker would stay at viewport-centre (behind the rail) until the
 * user clicks somewhere. Runs once when both map and marker are ready.
 */
const InitialOffsetCentering = ({ railOffset, markerPosition }) => {
  const map = useMap();
  const appliedRef = useRef(false);
  useEffect(() => {
    if (appliedRef.current) return;
    if (!markerPosition || !railOffset) return;
    if (!railOffset.x && !railOffset.y) return;
    appliedRef.current = true;
    panWithRailOffset(map, markerPosition, railOffset, { animate: false });
  }, [map, markerPosition, railOffset]);
  return null;
};

InitialOffsetCentering.propTypes = {
  railOffset: PropTypes.shape({ x: PropTypes.number, y: PropTypes.number }),
  markerPosition: PropTypes.array,
};

/**
 * Pushes the current Leaflet zoom up to AppContext on every zoomend event,
 * plus once on mount so the Debug panel doesn't read a stale fallback. The
 * Debug panel reads currentMapZoom from context instead of poking into the
 * Leaflet instance.
 *
 * @param {object} props
 * @param {Function} props.onZoomChange called with the new zoom on every change
 * @returns {null} renders nothing
 */
const MapZoomTracker = ({ onZoomChange }) => {
  const map = useMapEvents({
    zoomend: () => onZoomChange(map.getZoom()),
  });
  useEffect(() => {
    onZoomChange(map.getZoom());
  }, [map, onZoomChange]);
  return null;
};

MapZoomTracker.propTypes = {
  onZoomChange: PropTypes.func.isRequired,
};

/**
 * Live preview for the Settings → Default Map Zoom slider. When the user
 * moves the slider, AppContext sets zoomToLevel; this handler picks it up
 * and calls map.setZoom, then resets zoomToLevel to null. Without this,
 * the slider would only take effect on next page load — confusing UX.
 *
 * @param {object} props
 * @param {Number|null} props.zoomToLevel target zoom level, or null when idle
 * @param {Function} props.setZoomToLevel resets zoomToLevel to null
 * @returns {null} renders nothing
 */
const ZoomLevelHandler = ({ zoomToLevel, setZoomToLevel }) => {
  const map = useMap();
  useEffect(() => {
    if (zoomToLevel !== null && zoomToLevel !== undefined) {
      map.setZoom(zoomToLevel);
      setZoomToLevel(null);
    }
  }, [zoomToLevel, map, setZoomToLevel]);
  return null;
};

ZoomLevelHandler.propTypes = {
  zoomToLevel: PropTypes.number,
  setZoomToLevel: PropTypes.func.isRequired,
};

/**
 * Anchors the +/- zoom buttons (and keyboard zoom) on the visual centre
 * of the NON-RAIL map area instead of Leaflet's default true-viewport
 * centre — so the location marker no longer drifts when zooming.
 *
 * On LayoutDesktop the rail (right) + HeroBand (top) OVERLAY the map, so
 * `panWithRailOffset` deliberately pushes the map's true centre to the
 * north-east of the marker to keep the marker at the visual centre of the
 * uncovered area. Leaflet's stock `zoomIn`/`zoomOut` zoom around that true
 * centre, which sits up-and-right of the marker — so each zoom step slid
 * the marker toward the lower-left (zoom in) or upper-right (zoom out).
 *
 * Fix: override `zoomIn`/`zoomOut` on the map instance to `setZoomAround`
 * the non-rail visual centre — the exact inverse of the panWithRailOffset
 * placement `(W/2 - offsetX/2, H/2 + offsetY/2)`, the container point where
 * a centred marker sits — so that point stays pinned across zoom steps.
 * The original methods are restored on unmount.
 *
 * No-op when `railOffset` is zero (LayoutPi / LayoutMobile / focus
 * mode): the override falls straight through to Leaflet's centre-anchored
 * default, so center-anchored zoom is preserved everywhere the rail does
 * not overlay the map. Scroll-wheel / double-click / box zoom are
 * untouched — they already anchor on the cursor via their own handlers.
 *
 * @param {object} props
 * @param {{x: Number, y: Number}} props.railOffset pixels covered by rail / HeroBand
 * @returns {null} renders nothing
 */
const ZoomAnchorOffset = ({ railOffset }) => {
  const map = useMap();
  // Latest offset without re-running the patch effect on every change —
  // useRailOffset returns a fresh object each render.
  const offsetRef = useRef(railOffset);
  offsetRef.current = railOffset;
  useEffect(() => {
    const origZoomIn = map.zoomIn;
    const origZoomOut = map.zoomOut;
    const zoomAroundNonRailCentre = (delta) => {
      const offset = offsetRef.current;
      const offsetX = (offset && offset.x) || 0;
      const offsetY = (offset && offset.y) || 0;
      const size = map.getSize();
      const anchor = L.point(size.x / 2 - offsetX / 2, size.y / 2 + offsetY / 2);
      map.setZoomAround(map.containerPointToLatLng(anchor), map.getZoom() + delta);
    };
    // ZoomControl always passes an explicit delta; default to zoomDelta
    // for any caller that omits it (mirrors Leaflet's own fallback).
    const resolveDelta = (delta) => (delta == null ? map.options.zoomDelta : delta);
    map.zoomIn = function patchedZoomIn(delta, options) {
      const offset = offsetRef.current;
      if (!offset || (!offset.x && !offset.y)) return origZoomIn.call(map, delta, options);
      zoomAroundNonRailCentre(resolveDelta(delta));
      return map;
    };
    map.zoomOut = function patchedZoomOut(delta, options) {
      const offset = offsetRef.current;
      if (!offset || (!offset.x && !offset.y)) return origZoomOut.call(map, delta, options);
      zoomAroundNonRailCentre(-resolveDelta(delta));
      return map;
    };
    return () => {
      map.zoomIn = origZoomIn;
      map.zoomOut = origZoomOut;
    };
  }, [map]);
  return null;
};

ZoomAnchorOffset.propTypes = {
  railOffset: PropTypes.shape({ x: PropTypes.number, y: PropTypes.number }),
};

/**
 * Phase 4d (2026-05-28): GeoJSON overlay for the alert zone the user
 * picked via the AlertBanner's "Voir sur la carte" button. Renders a
 * tier-coloured polygon (red / orange / yellow) and zoom-to-fits when
 * `highlightedAlertId` changes. Clears entirely when the id is null
 * or when no matching alert with geometry is found.
 *
 * The fitBounds runs INSIDE the `MapContainer` context — that's why
 * this is a child component using `useMap` rather than a prop on
 * the parent. The `key` on the `<GeoJSON>` element is the alert id so
 * Leaflet re-creates the layer when the user switches between alerts
 * (Leaflet's internal cache wouldn't re-render the path on a plain
 * data prop change).
 *
 * @param {object} props
 * @param {?string} props.highlightedAlertId — id of the alert whose
 *   polygon is currently shown; null = no overlay
 * @param {Array} props.govAlerts — list of active alerts
 * @param {boolean} props.nightRed — night-vision palette active (alert
 *   chrome collapses to the red family, Phase 3 rule A1)
 * @param {boolean} props.dark — dark-mode flag (light mode adds the dark
 *   casing beneath the coloured stroke; dark/nightRed skip it)
 * @returns {JSX.Element|null}
 */
const AlertGeometryOverlay = ({ highlightedAlertId = null, govAlerts = NO_ALERTS, nightRed, dark = false }) => {
  const map = useMap();
  // Find the matching alert. Memo because govAlerts changes on every
  // poll cycle but we only care about the active highlight.
  const alert = useMemo(() => {
    if (!highlightedAlertId || !Array.isArray(govAlerts)) return null;
    return govAlerts.find((a) => a && a.id === highlightedAlertId && a.geometry) || null;
  }, [govAlerts, highlightedAlertId]);
  // Tier → stacked path layers via the shared builder (geometry.js) so the
  // overlay and the nearby-alerts polygons agree — including the nightRed
  // collapse-to-red rule (Phase 3, A1) and the light-mode dark casing that
  // lifts the warm hues off the light basemap (2 px solid border + 15 %
  // fill on top, distinct from the dashed radar circles).
  const layers = useMemo(
    () => (alert ? buildAlertPolygonLayers(alert.tier, nightRed, dark) : null),
    [alert, nightRed, dark]
  );
  // fitBounds when the alert (or its geometry) changes. Generous
  // padding via `padding: [40, 40]` so the polygon doesn't sit
  // edge-to-edge against the map viewport — gives the user context
  // (surrounding towns, radar tiles outside the zone). `maxZoom: 11`
  // prevents an over-zoom on tiny polygons (a single-county polygon
  // would otherwise pin to z 13-14, losing the radar context).
  useEffect(() => {
    if (!alert || !alert.geometry || !map) return;
    try {
      const tmp = L.geoJSON(alert.geometry);
      const bounds = tmp.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
      }
    } catch {
      // GeoJSON parsing failed — silently skip the fitBounds. The
      // <GeoJSON> render below will also bail out gracefully if
      // Leaflet can't parse the geometry.
    }
  }, [alert, map]);
  if (!alert || !layers) return null;
  // One <GeoJSON> per layer (casing under, coloured over) — mirrors how
  // RiskRing stacks buildRingLayers. Keyed per layer so the alert change
  // re-mounts both.
  return (
    <>
      {layers.map((ly, i) => (
        <GeoJSON key={`${alert.id}-${i}`} data={alert.geometry} style={() => ly} />
      ))}
    </>
  );
};

AlertGeometryOverlay.propTypes = {
  highlightedAlertId: PropTypes.string,
  // eslint-disable-next-line react/forbid-prop-types -- alert objects are payload-shaped, not statically typed
  govAlerts: PropTypes.array,
  nightRed: PropTypes.bool,
  dark: PropTypes.bool,
};

/**
 * Display-only overlay painting every active alert within the user's
 * radius (the "Nearby alerts" survey) as a tier-coloured GeoJSON
 * polygon. Unlike `AlertGeometryOverlay` — which renders the single
 * alert the user picked and auto-fitBounds-zooms to it — this renders N
 * polygons and never moves the map: it surveys what is already around
 * the user. Phase 2 of the nearby-alerts feature; the tap popup + count
 * badge land in Phase 3. Renders nothing when the list is empty (e.g.
 * the layer toggle is off or no alert falls in the radius).
 *
 * @param {object} props
 * @param {Array<object>} props.alerts nearby alerts (each carries `geometry`)
 * @param {boolean} props.nightRed night-vision palette active (tiers collapse to the red family)
 * @param {boolean} props.dark dark-mode flag (light mode adds the dark casing; dark/nightRed skip it)
 * @returns {JSX.Element|null} the polygon layers, or null when the list is empty
 */
const NearbyAlertsOverlay = ({ alerts = NO_ALERTS, nightRed, dark = false }) => {
  if (!Array.isArray(alerts) || alerts.length === 0) return null;
  // Sort ascending by severity tier so the most severe polygon is inserted
  // last and Leaflet paints it on top of any lower-tier polygon it overlaps
  // (see TIER_PAINT_ORDER). Without this the worst-first input would bury the
  // red Warning under a yellow Advisory drawn over it. A stable sort keeps the
  // server's worst-first order within a single tier. Copy first — never mutate
  // the prop.
  const painted = [...alerts]
    .filter((a) => a && a.geometry && a.id)
    .sort((a, b) => (TIER_PAINT_ORDER[a.tier] || 0) - (TIER_PAINT_ORDER[b.tier] || 0));
  return (
    <>
      {painted.map((a) => {
        // Same stacked layers as the single-alert overlay (light-mode dark
        // casing under, coloured stroke + 15 % fill over) so radar reads
        // through and the solid border stays distinct from the dashed
        // radar/risk circles. Ascending-severity sort keeps the worst
        // alert's coloured stroke painting last.
        const layers = buildAlertPolygonLayers(a.tier, nightRed, dark);
        return layers.map((ly, i) => (
          <GeoJSON key={`${a.id}-${i}`} data={a.geometry} style={() => ly} />
        ));
      })}
    </>
  );
};

NearbyAlertsOverlay.propTypes = {
  alerts: PropTypes.array,
  nightRed: PropTypes.bool,
  dark: PropTypes.bool,
};

/**
 * Content of the nearby-alerts tap popup (Phase 3b). Shows the subject of
 * each alert the tap landed in — source badge + severity chip + title —
 * and a single "Re-center here" action. Overlapping alerts are listed
 * worst-first (already server-sorted) under a count header. Deliberately
 * lightweight: the full description comes from re-centring, which moves
 * the location to the tapped point and re-activates the point-based
 * banner + GovAlertDetail.
 *
 * @param {object} props
 * @param {Array<object>} props.alerts the alerts under the tapped point
 * @param {() => void} props.onRecenter called when "Re-center here" is tapped
 * @returns {JSX.Element} popup content
 */
const SurveyAlertContent = ({ alerts = NO_ALERTS, onRecenter }) => {
  const { t, i18n } = useTranslation();
  const lang = (i18n.language || "en").slice(0, 2);
  return (
    <div className={styles.surveyPopup}>
      {alerts.length > 1 ? (
        <div className={styles.surveyHead}>{t("radar.nearbyHere", { count: alerts.length })}</div>
      ) : null}
      <div className={styles.surveyList}>
        {alerts.map((a) => (
          <div key={a.id} className={styles.surveyRow}>
            <SourceBadge source={a.source} />
            <SeverityChip severity={a.severity} />
            <span className={styles.surveyTitle}>{(lang === "fr" ? a.title_fr : a.title_en) || a.eventType}</span>
          </div>
        ))}
      </div>
      <button type="button" className={styles.surveyRecenter} onClick={onRecenter}>
        {t("controls.recenterHere")}
      </button>
    </div>
  );
};

SurveyAlertContent.propTypes = {
  alerts: PropTypes.array,
  onRecenter: PropTypes.func.isRequired,
};

/**
 * Weather map
 *
 * @param {object} props
 * @param {Number} props.zoom zoom level
 * @param {Boolean} [props.dark] dark mode
 * @returns {JSX.Element} Weather map
 */
const WeatherMap = ({ zoom, dark }) => {
  const MAP_CLICK_DEBOUNCE_TIME = 200; //ms
  // `nightRed` is the long-wavelength sleep-stage-1 mode. Used here
  // to red-tint the dashed radar circles so they match the rest of
  // the UI when the night-red palette is active. WeatherMap is mounted
  // by all three ambient layouts, so reading from useTimeOfDay keeps
  // the logic palette-aware without coupling to any one layout.
  const nightRed = useTimeOfDay() === "nightRed";
  // `i18n` feeds the ZoomControl remount key: react-leaflet only
  // forwards `position` updates to an existing control, so the +/-
  // titles would otherwise stay frozen in the mount-time language.
  const { t, i18n } = useTranslation();
  // Pixel width of the v3 right rail when visible. Drives the
  // off-centre projection trick that keeps the marker at the visual
  // centre of the non-rail area; see panWithRailOffset for the math.
  // Returns 0 when the rail doesn't overlay the map (LayoutPi /
  // LayoutMobile) or in full-screen radar focus mode.
  const railOffset = useRailOffset();
  const {
    setMapPosition,
    setPanToCoords,
    getMapApiKey,
    setCurrentMapZoom,
    setZoomToLevel,
    setInnerRisk,
    setOuterRisk,
    setInnerTrend,
    setOuterTrend,
    setInnerBumped,
    setOuterBumped,
    setInnerTrendConfidence,
    setOuterTrendConfidence,
    setInnerDirectionVectors,
    setOuterDirectionVectors,
    setRadarFrameTs,
    setDesktopRadarMaximized,
    setPiRadarMaximized,
    setHighlightedAlertId,
  } = useContext(AppActionsContext);
  const {
    mapApiKey,
    mobileRadarMaximized,
    desktopRadarMaximized,
    piRadarMaximized,
    piLayoutState,
    piScrubberOpen,
  } = useContext(SystemContext);
  const {
    browserGeo,
    mapGeo,
    mapTimezone,
    panToCoords,
  } = useContext(LocationContext);
  const {
    markerIsVisible,
    animateWeatherMap,
    radarSpeed,
    radarTimelineVisible,
    radarSource,
    hideRadarLegend,
    aiSummaryAvailable,
    radarAnalysisEnabled,
    extendedRadarRadius,
    showSamplingPoints,
    lightModeStyle,
    darkModeStyle,
    radarOpacityLight,
    radarOpacityDark,
    distanceUnit,
    showDirectionArrows,
  } = useContext(UiPrefsContext);
  const {
    // Phase 4d (2026-05-28): id of the alert whose `geometry` is
    // overlaid on the map + the full govAlerts list for the lookup.
    // Consumed by the `<AlertGeometryOverlay>` child inside the
    // MapContainer below.
    highlightedAlertId,
    govAlerts,
    // Nearby-alerts overlay (Phase 2): the radius survey layer + its
    // user-set radius. Display-only — gated on showWeatherAlerts, OFF by
    // default until the Phase 3 dock toggle wires it up.
    showWeatherAlerts,
    showAlertRing,
    nearbyAlerts,
    alertRadiusKm,
  } = useContext(AlertsContext);
  const {
    currentMapZoom,
    zoomToLevel,
    innerRisk,
    outerRisk,
    innerDirectionVectors,
    outerDirectionVectors,
  } = useContext(RadarStateContext);

  // Clear the map-zone highlight when the alert it points at is no
  // longer displayable — turned off via the "Show advisory alerts"
  // opt-in, dismissed, or expired off the feed. Without this the
  // polygon strands on the map with no way to remove it: the only
  // "Hide zone" control lives in the alert detail, which is gone once
  // the alert stops showing. AlertDetailInline's own clear-on-collapse/
  // unmount cleanup (commit 8bf5cc6) misses this case because the
  // detail renders null internally instead of unmounting. Matching the
  // *eligible* set (not raw govAlerts) also covers dismissal + expiry
  // in one place.
  const { eligibleGovAlerts } = useEligibleGovAlerts();
  useEffect(() => {
    if (highlightedAlertId && !eligibleGovAlerts.some((a) => a.id === highlightedAlertId)) {
      setHighlightedAlertId(null);
    }
  }, [highlightedAlertId, eligibleGovAlerts, setHighlightedAlertId]);

  // Largest sample in each ring drives the circle radius. Multiplied by
  // METERS_PER_UNIT because Leaflet's Circle takes meters.
  const innerRadiusMeters =
    RADAR_GEOMETRY[distanceUnit].inner[RADAR_GEOMETRY[distanceUnit].inner.length - 1] *
    METERS_PER_UNIT[distanceUnit];
  const outerRadiusMeters =
    RADAR_GEOMETRY[distanceUnit].outer[RADAR_GEOMETRY[distanceUnit].outer.length - 1] *
    METERS_PER_UNIT[distanceUnit];

  // Drawn radius for the alert ring. If it coincides with a currently-drawn
  // radar ring (inner whenever radar analysis is on; outer only when the
  // extended radius is enabled), nudge it outward so it doesn't hide under
  // the radar ring — see ALERT_RING_* above for the km-vs-mi rationale.
  const alertRingBaseMeters = alertRadiusKm * 1000;
  const alertRingCollides =
    (radarAnalysisEnabled &&
      Math.abs(alertRingBaseMeters - innerRadiusMeters) < ALERT_RING_OVERLAP_EPS_M) ||
    (radarAnalysisEnabled && extendedRadarRadius &&
      Math.abs(alertRingBaseMeters - outerRadiusMeters) < ALERT_RING_OVERLAP_EPS_M);
  const alertRingMeters = alertRingCollides
    ? alertRingBaseMeters + ALERT_RING_NUDGE_M
    : alertRingBaseMeters;

  // Nearby-alerts tap popup (Phase 3b): { latlng: [lat, lon], alerts: [...] }
  // when the user tapped inside one or more survey polygons; null otherwise.
  const [surveyPopup, setSurveyPopup] = useState(null);
  // Holds the deferred-close timer id for the survey popup, so the
  // "Re-center here" close can be cancelled if the map unmounts first
  // (see handleSurveyRecenter for why the close is deferred).
  const recenterCloseTimerRef = useRef(null);

  const handleMapClick = useCallback((e) => {
    const { lat: latitude, lng: longitude } = e.latlng;
    // Nearby-alerts survey: if the layer is on and the tap landed inside
    // one or more alert polygons, open the survey popup there instead of
    // moving the location marker. nearbyAlerts is server-sorted worst-first.
    if (showWeatherAlerts && Array.isArray(nearbyAlerts) && nearbyAlerts.length) {
      const hit = nearbyAlerts.filter(
        (a) => a && a.geometry && pointInGeometry(latitude, longitude, a.geometry),
      );
      if (hit.length) {
        setSurveyPopup({ latlng: [latitude, longitude], alerts: hit });
        return;
      }
    }
    setSurveyPopup(null);
    setMapPosition({ latitude, longitude });
  }, [showWeatherAlerts, nearbyAlerts, setMapPosition]);

  // "Re-center here" — move the location to the tapped point (guaranteed
  // inside the tapped polygon(s)) so the existing point-based banner +
  // GovAlertDetail surface the full alert(s); then close the popup.
  //
  // The close is deferred to the next tick on purpose. Clearing the
  // popup synchronously here removes it from the DOM in the middle of
  // the originating click's propagation. Leaflet suppresses clicks that
  // land on a popup via a `_leaflet_disable_click` flag on the popup
  // container; once that container is gone, the same click reaches the
  // map, Leaflet fires a map `click`, and the debounced `handleMapClick`
  // re-opens a survey popup at the click point — so the popup appears to
  // "stick" after re-centering. Keeping it mounted until the click has
  // finished propagating lets Leaflet's own guard swallow the click
  // (this is exactly what Leaflet's built-in popup close button does via
  // DomEvent.stop). See incident_survey_popup_recenter_click_leak.md.
  const handleSurveyRecenter = useCallback(() => {
    if (surveyPopup) {
      setMapPosition({ latitude: surveyPopup.latlng[0], longitude: surveyPopup.latlng[1] });
      recenterCloseTimerRef.current = setTimeout(() => setSurveyPopup(null), 0);
    }
  }, [surveyPopup, setMapPosition]);

  // Cancel a pending deferred close if the map unmounts before it fires.
  useEffect(() => () => clearTimeout(recenterCloseTimerRef.current), []);

  const mapClickHandler = useMemo(
    () => debounce(handleMapClick, MAP_CLICK_DEBOUNCE_TIME),
    [handleMapClick]
  );

  const [mapTimestamps, setMapTimestamps] = useState(null);
  // True when the most recent RainViewer frame-list refresh failed —
  // drives the timeline's source chip into its degraded (warn) state
  // so a stale frame window is never a silent failure (Phase 3 design:
  // "no silent failure" on the freshness chip).
  const [timestampsStale, setTimestampsStale] = useState(false);
  const [mapTimestamp, setMapTimestamp] = useState(null);
  // Current playback position in the timeline. -1 = "use the most recent
  // past frame" (initial mount). Kept as local state — earlier we tried
  // hoisting it to AppContext for theoretical centralisation, but every
  // animation tick (1× per second at 1× speed) then re-rendered all of
  // AppContext's ~50 consumers, which queued button-click handlers
  // behind a flood of re-renders and made the play/pause button take
  // 1-2 s to react. RadarTimeline is rendered by us and receives the
  // index via props, so context buys nothing.
  const [radarFrameIdx, setRadarFrameIdx] = useState(-1);
  const animationIntervalRef = useRef(null);

  // Small-screen detection used to auto-hide the radar legend while
  // the radar timeline is open. On the 7" Pi kiosk (height ≤ 520 px,
  // panel deployed) the timeline's right edge ends up sliding under
  // the legend's bottom-right block — the legend has higher z-index
  // (1000 vs 500) so it visually masks the rightmost portion of the
  // scrubber. Both elements are pinned to `bottom: 24px`, so there's
  // no clean way to keep them side by side at this width. Same media
  // query (max-height: 520px) used by the ambient SettingsPanel /
  // DebugPanel for their compact modes. NOTE: `ui/piLayout.js` gates
  // the Pi 3-state rail on (max-height: 540px) — a deliberately
  // separate threshold; don't unify the two.
  const SMALL_SCREEN_MQ = "(max-height: 520px)";
  const [isSmallScreen, setIsSmallScreen] = useState(
    () => typeof window !== "undefined" && window.matchMedia(SMALL_SCREEN_MQ).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(SMALL_SCREEN_MQ);
    const handler = (e) => setIsSmallScreen(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Narrow (phone-width) detection — mirrors AmbientLayers' mobile
  // breakpoint (< 800 px). Drives the timeline's compact copy (short
  // chips / frame counts): the height-based query above doesn't match
  // portrait phones, which are short on WIDTH instead.
  const NARROW_SCREEN_MQ = "(max-width: 799px)";
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(NARROW_SCREEN_MQ).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(NARROW_SCREEN_MQ);
    const handler = (e) => setIsNarrow(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Risk levels for the dashed circles live in AppContext (see InfoPanel's
  // AlertBanner, which reads the same state to surface the alert text). We
  // only keep the polling logic here because it's gated by the same
  // conditions as the circles themselves.
  // Per-point intensities for colouring sampling-point dots stay local —
  // only the renderer below cares about them. Map keyed by `${dir}:${dist}`
  // so the dot lookup is O(1) regardless of how many points are visible.
  const [riskSamples, setRiskSamples] = useState(() => new Map());
  const riskIntervalRef = useRef(null);

  const MAP_TIMESTAMP_REFRESH_FREQUENCY = 1000 * 60 * 10; //update every 10 minutes
  const MAP_CYCLE_RATE = 1000; //ms
  const RISK_REFRESH_INTERVAL = 5 * 60 * 1000; // RainViewer cycles every 10 min; 5 min keeps us close to fresh

  const getMapApiKeyCallback = useCallback(() => getMapApiKey(), [
    getMapApiKey,
  ]);

  useEffect(() => {
    getMapApiKeyCallback().catch((err) => {
      console.log("err!", err);
    });

    const updateTimeStamps = () => {
      getMapTimestamps()
        .then((res) => {
          setMapTimestamps(res);
          setTimestampsStale(false);
          // Surface the newest *actual* (past) RainViewer frame timestamp so
          // NowcastLine can gate its radar-anchored calm copy on data
          // freshness (see NowcastLine RADAR_STALE_MS). `.time` is UNIX
          // seconds; we expose ms. Forecast (nowcast) frames are future and
          // are NOT the freshness signal, so only `kind: "past"` counts.
          if (Array.isArray(res) && res.length > 0) {
            let newestPastSec = null;
            for (const f of res) {
              if (f.kind === "past" && typeof f.time === "number") newestPastSec = f.time;
            }
            setRadarFrameTs(newestPastSec != null ? newestPastSec * 1000 : null);
          }
        })
        .catch((err) => {
          console.log("err", err);
          // Keep the last good frame list on screen but flag it stale —
          // the timeline's source chip flips to the warn tone. Leave the
          // last-good radarFrameTs in place: the freshness gate will trip on
          // its own once that timestamp ages past RADAR_STALE_MS.
          setTimestampsStale(true);
        });
    };

    const mapTimestampsInterval = setInterval(
      updateTimeStamps,
      MAP_TIMESTAMP_REFRESH_FREQUENCY
    );
    updateTimeStamps(); //initial update
    return () => {
      clearInterval(mapTimestampsInterval);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initialization, runs once on mount

  const { latitude, longitude } = browserGeo || {};

  // Resolve the radarFrameIdx (which may be -1 = "default to latest past
  // frame") into a concrete index of the loaded `mapTimestamps` array.
  // Centralised so both the tile renderer and the animation effect read
  // the same value. The "latest past frame" default is the index of the
  // last `kind: "past"` entry — putting playhead there means the user
  // initially sees current radar (not the first past frame, which is 90
  // minutes old).
  const lastPastIdx = useMemo(() => {
    if (!mapTimestamps || mapTimestamps.length === 0) return 0;
    let idx = -1;
    mapTimestamps.forEach((f, i) => { if (f.kind === "past") idx = i; });
    return idx >= 0 ? idx : mapTimestamps.length - 1;
  }, [mapTimestamps]);
  const currentMapTimestampIdx = useMemo(() => {
    if (!mapTimestamps || mapTimestamps.length === 0) return 0;
    if (radarFrameIdx < 0 || radarFrameIdx >= mapTimestamps.length) return lastPastIdx;
    return radarFrameIdx;
  }, [radarFrameIdx, mapTimestamps, lastPastIdx]);

  // Keep the displayed timestamp in sync with the current index
  useEffect(() => {
    if (mapTimestamps) {
      setMapTimestamp(mapTimestamps[currentMapTimestampIdx]);
    }
  }, [currentMapTimestampIdx, mapTimestamps]);

  // Poll /api/radar-risk every 5 min (and on mapGeo / config changes) to
  // colour the dashed circles by intensity. Gated by the same conditions
  // as the circles themselves — fetching when the rings aren't visible
  // would be wasted work.
  // The risk fetch is intentionally NOT gated on aiSummaryAvailable. The
  // /api/radar-risk endpoint is purely deterministic — RainViewer tile
  // sampling + tier classification, no LLM call — so the AlertBanner and
  // dashed circles it feeds are useful even without an Anthropic key. The
  // AI summary's third paragraph is the only Claude-dependent surface,
  // and that's gated server-side in aiSummaryCtrl.js.
  const riskFetchEnabled = radarAnalysisEnabled && Boolean(mapGeo);
  useEffect(() => {
    if (!riskFetchEnabled) {
      setInnerRisk(null);
      setOuterRisk(null);
      setInnerTrend("stable");
      setOuterTrend("stable");
      setInnerBumped(false);
      setOuterBumped(false);
      setInnerTrendConfidence(0);
      setOuterTrendConfidence(0);
      setInnerDirectionVectors([]);
      setOuterDirectionVectors([]);
      setRiskSamples(new Map());
      return undefined;
    }
    // Cancellation flag (same pattern as AppContext's AQI / pollen
    // effects): a slow response keyed to the previous position must not
    // land after a pan and paint the rings/samples of the wrong place.
    let cancelled = false;
    const fetchRisk = () => {
      const params = new URLSearchParams({
        lat: mapGeo.latitude,
        lon: mapGeo.longitude,
        distanceUnit,
      });
      axios
        .get(`/api/radar-risk?${params}`)
        .then((res) => {
          if (cancelled) return;
          setInnerRisk(res.data?.inner?.level || "calm");
          setOuterRisk(res.data?.outer?.level || null);
          setInnerTrend(res.data?.inner?.trend || "stable");
          setOuterTrend(res.data?.outer?.trend || "stable");
          setInnerBumped(Boolean(res.data?.inner?.bumped));
          setOuterBumped(Boolean(res.data?.outer?.bumped));
          setInnerTrendConfidence(Number(res.data?.inner?.trendConfidence) || 0);
          setOuterTrendConfidence(Number(res.data?.outer?.trendConfidence) || 0);
          setInnerDirectionVectors(Array.isArray(res.data?.inner?.directionVectors) ? res.data.inner.directionVectors : []);
          setOuterDirectionVectors(Array.isArray(res.data?.outer?.directionVectors) ? res.data.outer.directionVectors : []);
          // Build the lookup map from inner + outer samples. Same
          // direction:distance keying as buildSamplingPoints, so the
          // renderer can colour each dot in O(1).
          const map = new Map();
          for (const s of res.data?.inner?.samples || []) {
            map.set(`${s.direction}:${s.distance}`, s.intensity);
          }
          for (const s of res.data?.outer?.samples || []) {
            map.set(`${s.direction}:${s.distance}`, s.intensity);
          }
          setRiskSamples(map);
        })
        .catch(() => {
          // Non-fatal — leave the previous colour in place. The endpoint
          // returns 503 when RainViewer is unreachable; clearing here would
          // make the ring flash neutral on every transient failure.
        });
    };
    fetchRisk();
    riskIntervalRef.current = setInterval(fetchRisk, RISK_REFRESH_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(riskIntervalRef.current);
      riskIntervalRef.current = null;
    };
  }, [riskFetchEnabled, mapGeo, distanceUnit, RISK_REFRESH_INTERVAL, setInnerRisk, setOuterRisk, setInnerTrend, setOuterTrend, setInnerBumped, setOuterBumped]);

  // Radar animation: start/stop interval based on animateWeatherMap toggle.
  // Per-frame interval is MAP_CYCLE_RATE / radarSpeed so 1× / 2× / 4× cycling
  // from the timeline's speed selector takes effect immediately. Using a ref
  // for the interval avoids recreating it on every frame tick.
  useEffect(() => {
    if (animationIntervalRef.current) {
      clearInterval(animationIntervalRef.current);
      animationIntervalRef.current = null;
    }

    // Freeze the radar animation in the v3.2 MAX state: there the map is a
    // decorative ~190 px thumbnail, so cycling RainViewer frames just burns
    // the Pi GPU. This doesn't touch the user's `animateWeatherMap`
    // preference — leaving MAX resumes it.
    if (mapTimestamps && animateWeatherMap && !isPiMaxView(piLayoutState)) {
      animationIntervalRef.current = setInterval(() => {
        setRadarFrameIdx((prev) => {
          // Advance from the resolved current index — which collapses
          // -1 (uninitialised) and out-of-range values into a valid one
          // — so a fresh play after a scrub or a frame-list reload
          // always picks up at the right position.
          const start = prev < 0 || prev >= mapTimestamps.length ? lastPastIdx : prev;
          return start + 1 >= mapTimestamps.length ? 0 : start + 1;
        });
      }, MAP_CYCLE_RATE / radarSpeed);
    }

    return () => {
      if (animationIntervalRef.current) {
        clearInterval(animationIntervalRef.current);
        animationIntervalRef.current = null;
      }
    };
    // radarFrameIdx is intentionally NOT in the deps — the function
    // updater inside setInterval reads the latest value via React's
    // closure over `prev`, so we don't need to recreate the interval
    // on every frame tick. Including it would clear and re-create the
    // interval every second, which previously starved button clicks.
  }, [animateWeatherMap, mapTimestamps, radarSpeed, lastPastIdx, piLayoutState]);

  // Initial mount: anchor the playhead at the most recent past frame
  // once the timestamps load, so the first paint shows current radar
  // (not the 90-min-old first historical frame). One-shot — once the
  // user scrubs or starts animation, radarFrameIdx is no longer < 0.
  useEffect(() => {
    if (mapTimestamps && radarFrameIdx < 0) {
      setRadarFrameIdx(lastPastIdx);
    }
  }, [mapTimestamps, lastPastIdx, radarFrameIdx]);

  // When the timeline overlay is hidden, snap the playhead back to the
  // most recent past frame so the user is never left looking at a stale
  // historical frame or a forecast frame they had been scrubbing
  // through. The toggleRadarTimelineVisible callback in AppContext also
  // pauses any running animation, so the combination is "hide the bar
  // and show me current radar."
  useEffect(() => {
    if (!radarTimelineVisible && mapTimestamps) {
      setRadarFrameIdx(lastPastIdx);
    }
  }, [radarTimelineVisible, mapTimestamps, lastPastIdx]);

  // ── Referentially-stable props for the react-leaflet layers ─────────
  // react-leaflet v4 compares props by reference: a fresh array/object
  // every render triggers setLatLng/setStyle on the underlying Leaflet
  // layers even when the values are identical — at 1-4 Hz during radar
  // animation that's constant no-op SVG work on Pi hardware. These memos
  // pin the identities to the actual inputs. (Declared before the
  // early-return below — hooks must run unconditionally.)
  // Keyed on the coordinates, not the mapGeo object identity — pollers
  // may hand back fresh-but-equal objects.
  const markerLat = mapGeo ? mapGeo.latitude : null;
  const markerLon = mapGeo ? mapGeo.longitude : null;
  const markerPosition = useMemo(
    () => (markerLat != null && markerLon != null ? [markerLat, markerLon] : null),
    [markerLat, markerLon]
  );
  const radiusRingOptions = useMemo(
    () => buildRadiusRingOptions(dark, nightRed),
    [dark, nightRed]
  );
  // The sampling grid is pure geodesic math over (centre, radius, unit) —
  // 161 points (481 extended) of offsetLatLon per call. Rebuilding it in
  // the render body recomputed the whole grid on every WeatherMap render.
  // Gated on the layer's visibility toggles too, so the grid isn't even
  // computed while the dots layer is hidden (the zoom gate stays in the
  // JSX — zoom changes often and the markers behind it are memoized).
  const samplingPoints = useMemo(
    () => (markerPosition && radarAnalysisEnabled && showSamplingPoints
      ? buildSamplingPoints(markerPosition, extendedRadarRadius, distanceUnit)
      : []),
    [markerPosition, radarAnalysisEnabled, showSamplingPoints, extendedRadarRadius, distanceUnit]
  );
  // Rendered markers memoized as a block: the per-dot pathOptions
  // literals get stable identities tied to the inputs that actually
  // change their colour (sample intensities, palette).
  const samplingPointMarkers = useMemo(() => samplingPoints.map(
    ({ position, key }, idx) => {
      // Each dot picks its colour from the sample's own intensity.
      // Clear (intensity 0 or unknown) keeps the neutral default
      // — same colour the dots had before this change. Coloured
      // tiers reuse RING_RISK_STYLE so the dots and the dashed
      // circle they belong to speak the same visual language.
      const intensity = riskSamples.get(key);
      const tier = tierForIntensity(intensity);
      const fillColor = tier
        ? DOT_COLOR_BY_TIER[dark ? "dark" : "light"][tier]
        : (dark ? "#f6f6f4" : "#3a3938");
      // Light-mode dots get a slightly larger radius and a solid
      // fill — the cream basemap eats thin strokes and low-opacity
      // fills. For coloured tiers in light mode, also wrap a
      // darker outline around the fill so an orange dot sitting on
      // an orange radar tile (same hue!) still reads as a marker
      // and not as part of the underlying band. Dark mode keeps
      // the original subtler look — the dark basemap provides
      // enough contrast that no separate outline is needed.
      const outlineNeeded = !dark && tier;
      return (
        <CircleMarker
          key={`sp-${idx}`}
          center={position}
          radius={dark ? 3 : 4}
          pathOptions={{
            color: outlineNeeded ? "#3a3938" : fillColor,
            fillColor,
            weight: outlineNeeded ? 1.5 : 1,
            opacity: 0.85,
            fillOpacity: dark ? 0.5 : 1,
          }}
        />
      );
    }
  ), [samplingPoints, riskSamples, dark]);

  if (!hasVal(latitude) || !hasVal(longitude) || !zoom || !mapApiKey) {
    return (
      <div className={`${styles.noMap} ${dark ? styles.dark : styles.light}`}>
        <div>Cannot retrieve map data.</div>
        <div>Did you enter an API key?</div>
      </div>
    );
  }

  // `withTimeline` re-anchors the legend/chip and the attribution strip
  // above the full-width timeline bar; without the bar they drop back
  // to the bottom edge (legend-without-timeline state). `withLegend`
  // does the mirror job for the MOBILE timeline: the design pins it at
  // 78px to clear the compact legend strip below, but with the legend
  // toggled off the strip isn't rendered and the bar must drop to the
  // bottom edge instead of floating over a hole (maintainer-reported;
  // the mock always showed the strip, so this combo wasn't specced).
  // v3.3 priority: the scrubber is a fullscreen-radar (MIN) tool, opened via the
  // ephemeral `piScrubberOpen` flag (the dock timeline button sets it + maximizes
  // to MIN) — never the shared persisted `radarTimelineVisible` pref, and never on
  // the cramped MID half-pane. Outside the priority model (desktop / mobile —
  // piLayoutState null or flag off) it falls back to the persisted pref exactly as
  // before. ONE boolean drives BOTH the wrapper padding AND the actual render
  // below, so they can't desync (no half-pane flash on a MIN→MID exit).
  const priorityActive = priorityViewsEnabled() && piLayoutState != null;
  const timelineShown = Boolean(mapTimestamps && mapTimestamps.length > 0)
    && radarSource === "rainviewer"
    && (priorityActive
      ? (piLayoutState === "min" && piScrubberOpen)
      : (radarTimelineVisible && !isPiMaxView(piLayoutState)));
  const legendShown = Boolean(mapTimestamps) && radarSource === "rainviewer" && !hideRadarLegend;

  return (
    <div className={`${styles.mapWrapper} ${timelineShown ? styles.withTimeline : ""} ${legendShown ? styles.withLegend : ""}`}>
      <MapContainer
        center={[latitude, longitude]}
        zoom={zoom}
        /* Raised 16 → 18 (2026-06) after the AppContext slice split:
         * the May-2026 step-function degradation (slowdown at z=11,
         * 1 s at z=13, 5-7 s at z=15, frozen white-screen at z=17 on
         * an M4 iPad Pro) turned out to be largely REACT-RENDER churn
         * — every zoom step re-rendered the whole app through the
         * monolithic context — which the split fixed (zoom now only
         * re-renders radar-slice consumers; field-confirmed smooth at
         * max zoom on the kiosk). The OTHER half of that incident was
         * Safari's tile-cache memory pressure, which is mitigated by
         * `keepBuffer: 2` + `updateWhenIdle` below (kept) — but NOT
         * eliminated: re-test a sustained z=9→18 zoom/pan on the
         * original iPad before any further raise toward 20. streets-
         * v12 has genuine building-level detail at 17-18. The radar
         * overlays keep their own tighter caps (z=12 — that one is a
         * DATA-resolution bound, not a perf cap; see below). */
        maxZoom={18}
        style={{ width: "100%", height: "100%" }}
        attributionControl={false}
        /* Default zoom control replaced by an explicit <ZoomControl>
         * below so the +/- titles go through i18n (v3.1 Phase 3 —
         * the 40 px restyle itself lives in ui/reset.css). */
        zoomControl={false}
        touchZoom={true}
        dragging={true}
        fadeAnimation={false}
      >
        {!isPiMaxView(piLayoutState) && (
          <ZoomControl
            key={`zoom-${i18n.language}`}
            position="topleft"
            zoomInTitle={t("radar.zoomIn", { defaultValue: "Zoom in" })}
            zoomOutTitle={t("radar.zoomOut", { defaultValue: "Zoom out" })}
          />
        )}
        <MapClickHandler onClick={mapClickHandler} />
        <PanHandler panToCoords={panToCoords} setPanToCoords={setPanToCoords} railOffset={railOffset} />
        <InitialOffsetCentering railOffset={railOffset} markerPosition={markerPosition} />
        <RailOffsetTracker railOffset={railOffset} markerPosition={markerPosition} />
        <MapZoomTracker onZoomChange={setCurrentMapZoom} />
        <ZoomLevelHandler zoomToLevel={zoomToLevel} setZoomToLevel={setZoomToLevel} />
        <ZoomAnchorOffset railOffset={railOffset} />
        <MapResizer
          mobileRadarMaximized={mobileRadarMaximized}
          desktopRadarMaximized={desktopRadarMaximized}
          piRadarMaximized={piRadarMaximized}
          piLayoutState={piLayoutState}
          latitude={latitude}
          longitude={longitude}
          zoom={zoom}
        />
        {/* RadarFocusControl moved OUT of the MapContainer with v3.1
         * Phase 3 — it's now a standalone overlay button (rendered
         * after the map alongside RadarLegend/RadarTimeline), no
         * longer a Leaflet bar control. */}
        {/* ArrowToggleControl lived here pre-2.14.15 as an imperative
         * Leaflet control at the topleft. Moved to BottomDock so the
         * top-left of the map stays uncluttered (and the dock has
         * plenty of room for related radar toggles now that v3 gives
         * it a dedicated slab). See ControlButtons for the new entry,
         * gated on the same `radarAnalysisEnabled` flag. */}
        {/* v2.14.66: the Ukrainian flag (added by Leaflet v1.9.3 as a
         * humanitarian gesture) stays visible in every palette except
         * nightRed — its yellow stripe disrupts the dark-red basemap.
         * Earlier (v2.14.65) we toggled the `prefix` prop with a
         * `key`, which forced a remount and duplicated the tile-
         * layer attribution strings on every palette switch. Replaced
         * the React-side toggle with a pure CSS rule that hides
         * `.leaflet-attribution-flag` only when `data-palette` on
         * `.ambientRoot` resolves to `nightRed`. See ui/reset.css.
         * No remount, no duplicated attributions. */}
        {/* bottomright since v3.1 Phase 3: the timeline is now a
         * full-width bottom bar, so the strip docks above its right
         * end (offset in styles.css, rail-aware). The legal Mapbox +
         * RainViewer attribution stays visible in every state —
         * including the mobile mini-card. */}
        <AttributionControl position="bottomright" />
        <TileLayer
          attribution={MAPBOX_ATTRIBUTION}
          url={`/api/tiles/${dark ? darkModeStyle : lightModeStyle}/{z}/{x}/{y}`}
          tileSize={512}
          zoomOffset={-1}
          maxZoom={18}
          /* `keepBuffer: 2` (Leaflet default, was 4 in v2.15.4) —
           * the wider buffer made zoom-out seamless on desktop but
           * doubled the resident tile count, which combined with
           * the 512px @2x tiles to balloon Safari iPad's tile-cache
           * memory at high zoom (the freeze trigger in May 2026
           * reports). 2 trades a brief white flash on rapid zoom-
           * out for ~half the memory footprint — acceptable since
           * the Mapbox tile proxy caches server-side and re-fetches
           * are essentially free. */
          keepBuffer={2}
          /* `updateWhenIdle: true` defers tile re-rendering until
           * the user finishes panning / zooming. Safari iOS's
           * default redraw-on-every-move was the dominant cost
           * during a sustained pan at z=14+: every touchmove
           * fired tile checks, transforms, and decode. Idle-mode
           * defers all that until the gesture ends. Lower CPU
           * on Pi kiosk too. */
          updateWhenIdle={true}
        />
        {radarSource === "eccc" ? (
          // Environment Canada radar (RADAR_1KM_RRAI = rain precipitation rate
          // at 1 km, NA composite). 6-min update cadence vs RainViewer's ~10
          // min, dedicated authority for the Canadian fleet. No time-dimension
          // here — Phase A surfaces only the current frame; the timeline
          // scrubber and animation are hidden when this source is active.
          // Attribution per ECCC terms of use: "Canadian radar data was
          // provided courtesy of Environment Canada".
          <WMSTileLayer
            attribution='Radar courtesy <a href="https://www.canada.ca/en/environment-climate-change.html">Environment Canada</a>'
            url="https://geo.weather.gc.ca/geomet"
            params={{
              layers: "RADAR_1KM_RRAI",
              format: "image/png",
              transparent: true,
              version: "1.3.0",
            }}
            opacity={dark ? radarOpacityDark : radarOpacityLight}
            /* Radar has no useful resolution beyond z=12 (~1 km
             * per pixel native). Capping here also stops Safari
             * from upscaling the WMS PNG response via CSS transform
             * past ~z=15, which is the iPad freeze trigger. The
             * basemap keeps zooming up to z=18; only radar disappears. */
            maxZoom={12}
          />
        ) : mapTimestamp ? (
          <TileLayer
            attribution='<a href="https://www.rainviewer.com/">RainViewer</a>'
            url={`https://tilecache.rainviewer.com${mapTimestamp.path}/512/{z}/{x}/{y}/6/1_1.png`}
            opacity={dark ? radarOpacityDark : radarOpacityLight}
            tileSize={512}
            zoomOffset={-1}
            maxNativeZoom={8}
            /* Radar tiles disappear at z=13+. RainViewer's native
             * zoom maxes at 8; the previous config inherited the
             * map's maxZoom (20), so Leaflet upscaled z=8 tiles by
             * up to 4096× via CSS transform — which crashed Safari
             * iPad Pro M4 and earlier on extended street-level
             * zoom. Capping at 12 keeps the radar useful (still
             * showing 1 km resolution at city blocks) without the
             * extreme upscale that iOS's tile compositor can't
             * keep up with. The basemap below keeps zooming up to
             * 18; only the radar overlay disappears past z=12. */
            maxZoom={12}
            /* `updateWhenIdle: true` defers tile re-rendering until
             * the user finishes panning / zooming — easier on
             * Safari iOS's GPU than the default continuous redraw
             * on every move event. Side benefit: lower CPU on the
             * Pi kiosk too. */
            updateWhenIdle={true}
            /* keepBuffer matched to the basemap (2, default) so the
             * cache footprint stays bounded. */
            keepBuffer={2}
          />
        ) : null}
        {markerIsVisible && markerPosition ? (
          /* v2.14.65: custom target icon only in nightRed mode. In every
           * other palette the default Leaflet blue teardrop pin stays —
           * it's a familiar map idiom and reads cleanly on the day /
           * dusk / night basemaps. nightRed is the one palette where
           * a bright blue clashes hard with the deep-red background,
           * so we swap to the palette-aware target marker there. The
           * `key` forces the marker DOM to be recreated when nightRed
           * flips so Leaflet picks up the new icon. */
          nightRed ? (
            <Marker
              key="target"
              position={markerPosition}
              icon={LOCATION_MARKER_ICON}
              opacity={1}
            />
          ) : (
            <Marker
              key="default"
              position={markerPosition}
              opacity={0.65}
            />
          )
        ) : null}
        {/* Radar-analysis overlays — only visible when the AI summary feature
            is configured AND the radar analysis is enabled in advanced
            settings. Inner circle marks the default analysis zone (50 km or
            30 mi depending on distanceUnit); when extendedRadius is on, a
            second outer circle (100 km or 60 mi) joins it with the same
            dashed style. Sampling-point dots opt-in via a separate toggle
            so curious users can see exactly what the analyzer reads. Inner
            ring is always 16 directions × 10 distances; outer ring is 32
            directions × 10 distances when extendedRadius is on. */}
        {radarAnalysisEnabled && markerPosition && currentMapZoom < RING_HIDE_ZOOM ? (
          <RiskRing center={markerPosition} radius={innerRadiusMeters} risk={innerRisk} dark={dark} aiOff={!aiSummaryAvailable} nightRed={nightRed} />
        ) : null}
        {radarAnalysisEnabled && markerPosition && extendedRadarRadius && currentMapZoom < RING_HIDE_ZOOM ? (
          <RiskRing center={markerPosition} radius={outerRadiusMeters} risk={outerRisk} dark={dark} aiOff={!aiSummaryAvailable} nightRed={nightRed} />
        ) : null}
        {/* On-map radius chips ("50 km" / "100 km") at the rings' SE
            intersection (v3.1 Phase 3 — audit F7/F20). Same gates as
            the rings so the labels never outlive their circles; the
            mobile layout hides them in CSS. */}
        {radarAnalysisEnabled && markerPosition && currentMapZoom < RING_HIDE_ZOOM ? (
          <RingLabels
            center={markerPosition}
            distanceUnit={distanceUnit}
            extendedRadarRadius={extendedRadarRadius}
          />
        ) : null}
        {/* Nearby-alerts radius ring (Phase 2) — the user's survey extent,
            persistent while the layer is on. A cool-blue dotted circle
            (red dash-dot in nightRed) kept distinct from the radar risk
            rings. Hidden when zoomed in past the radar rings' threshold,
            same as them, since a 50-100 km circle is off-screen there.
            Independently gated on showAlertRing: a user can keep the alert
            polygons while hiding the ring (the ring is a round proxy for the
            survey radius; the polygon is the alert's real geometry). */}
        {showWeatherAlerts && showAlertRing && markerPosition && currentMapZoom < RING_HIDE_ZOOM ? (
          <Circle
            center={markerPosition}
            radius={alertRingMeters}
            pathOptions={radiusRingOptions}
          />
        ) : null}
        {radarAnalysisEnabled && markerPosition && showSamplingPoints && currentMapZoom < RING_HIDE_ZOOM
          ? samplingPointMarkers
          : null}
        {radarAnalysisEnabled && markerPosition && showDirectionArrows
          ? [
              ...innerDirectionVectors.map((v) => ({ ...v, _ring: "inner" })),
              ...outerDirectionVectors.map((v) => ({ ...v, _ring: "outer" })),
            ].map((v, idx) => {
              const bearingMap = v._ring === "inner" ? DIR_INNER_TO_BEARING : DIR_OUTER_TO_BEARING;
              const bearing = bearingMap[v.direction];
              if (bearing == null) return null;
              const path = buildArrowPath(
                markerPosition, bearing, v.peakDistance, v.magnitude, v.trend,
                KM_PER_UNIT[distanceUnit],
              );
              const baseColor = (ARROW_COLOR[v.trend] || ARROW_COLOR.approaching)[dark ? "dark" : "light"];
              // Opacity reflects confidence — the user sees at a glance which
              // arrows are well-supported by the data and which are tentative.
              // Floor at 0.25 so even low-confidence arrows stay visible
              // (they're already filtered to non-stable directions, so we
              // want to surface them; we just want them visually "softer").
              const opacity = Math.max(0.25, Math.min(1, (v.confidence || 0) / 100));
              // Stroke weight scales gently with peak intensity so heavier
              // bands read as thicker arrows. Cap at 4 px to avoid clutter.
              const weight = Math.min(4, 1.5 + (v.peakIntensity || 0) * 0.4);
              return (
                <Polyline
                  key={`arrow-${v._ring}-${v.direction}-${idx}`}
                  positions={path}
                  pathOptions={{
                    color: baseColor,
                    weight,
                    opacity,
                    lineCap: "round",
                    lineJoin: "round",
                  }}
                />
              );
            })
          : null}
        {/* Phase 4d (2026-05-28): polygon overlay of the alert zone
          * the user picked via the AlertBanner "Voir sur la carte"
          * button. Renders nothing when highlightedAlertId is null
          * or the matching alert has no geometry. The component
          * fitBounds-zooms on mount via useMap so the polygon is
          * actually visible after the user taps. */}
        <AlertGeometryOverlay
          highlightedAlertId={highlightedAlertId}
          govAlerts={govAlerts}
          nightRed={nightRed}
          dark={dark}
        />
        {/* Nearby-alerts survey polygons (Phase 2) — every active alert
            within the radius, painted tier-coloured. Display-only; gated
            on the layer toggle (OFF by default until the Phase 3 dock
            button). Never moves the map. */}
        {showWeatherAlerts ? <NearbyAlertsOverlay alerts={nearbyAlerts} nightRed={nightRed} dark={dark} /> : null}
        {/* Survey tap popup (Phase 3b): opens at the tapped point when it
            landed inside one or more alert polygons. Lightweight subject +
            a single "Re-center here" that re-activates the point-based path. */}
        {showWeatherAlerts && surveyPopup ? (
          <Popup
            position={surveyPopup.latlng}
            className={styles.surveyPopupWrapper}
            eventHandlers={{ remove: () => setSurveyPopup(null) }}
          >
            <SurveyAlertContent alerts={surveyPopup.alerts} onRecenter={handleSurveyRecenter} />
          </Popup>
        ) : null}
      </MapContainer>
      {/* Radar-focus toggle — standalone overlay button under the zoom
          stack (v3.1 Phase 3; formerly a Leaflet bar control inside the
          MapContainer). Rendered when LayoutDesktop OR LayoutPi is the
          active layout (one of the two sentinels is non-null); tapping
          it hides HeroBand + rail so the radar fills the viewport, and
          a short toast confirms the toggle. LayoutMobile has its own
          maximize button on the inset card (same icon pair). */}
      {!isPiMaxView(piLayoutState)
        && ((desktopRadarMaximized !== null && desktopRadarMaximized !== undefined)
        || (piRadarMaximized !== null && piRadarMaximized !== undefined)) && (
        <RadarFocusControl
          active={Boolean(piRadarMaximized != null ? piRadarMaximized : desktopRadarMaximized)}
          onToggle={() => {
            if (piRadarMaximized != null) {
              setPiRadarMaximized(!piRadarMaximized);
            } else {
              setDesktopRadarMaximized(!desktopRadarMaximized);
            }
          }}
          titleOn={t("controls.restorePanels", { defaultValue: "Restore panels" })}
          titleOff={t("controls.focusRadar", { defaultValue: "Focus radar" })}
        />
      )}
      {/* Legend + timeline are RainViewer-specific (the legend's colour
          scale matches RainViewer's intensity-encoded palette, and the
          timeline drives RainViewer's frame URLs). Hidden entirely when
          radarSource is ECCC — Phase A doesn't bring scrubbing across.

          Short screens (≤ 520 px height) with the timeline open get the
          legend as a compact "(i)" chip instead of the card — the Q5
          mutual-exclusion rule from the Phase 3 design: both can't fit
          in the 7" kiosk's vertical budget, but the legend stays one
          tap away instead of vanishing. */}
      {mapTimestamps && radarSource === "rainviewer" && !hideRadarLegend && !isPiMaxView(piLayoutState) && (
        <RadarLegend dark={dark} chipMode={radarTimelineVisible && isSmallScreen} />
      )}
      {timelineShown && (
        <RadarTimeline
          frames={mapTimestamps}
          currentIdx={currentMapTimestampIdx}
          onScrub={setRadarFrameIdx}
          timezone={mapTimezone}
          dark={dark}
          compact={isSmallScreen || isNarrow}
          sourceStale={timestampsStale}
        />
      )}
    </div>
  );
};

WeatherMap.propTypes = {
  zoom: PropTypes.number.isRequired,
  dark: PropTypes.bool,
};


/**
 * Fetches the RainViewer frame index and returns past + nowcast frames as
 * a single time-ordered array, with each frame tagged `kind: "past" | "nowcast"`.
 * The nowcast frames (3 entries, every 10 min into the future) are RainViewer's
 * short-range precipitation forecast — surfacing them in the timeline lets the
 * user scrub past the present moment to see what's expected to drift in next.
 *
 * @returns {Promise<Array<{time: number, path: string, kind: "past"|"nowcast"}>>} Combined past + nowcast frames in time order.
 */
function getMapTimestamps() {
  return new Promise((resolve, reject) => {
    axios
      .get("https://api.rainviewer.com/public/weather-maps.json")
      .then((res) => {
        const past = (res.data?.radar?.past ?? []).map((f) => ({ ...f, kind: "past" }));
        const nowcast = (res.data?.radar?.nowcast ?? []).map((f) => ({ ...f, kind: "nowcast" }));
        resolve([...past, ...nowcast]);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

export default WeatherMap;
