import { useEffect } from "react";
import PropTypes from "prop-types";
import { useMap } from "react-leaflet";

import { hasVal } from "./geometry";

const RESIZE_SETTLE_MS = 50;
const MOBILE_INVALIDATE_LIVE_MS = 50;
const MOBILE_INVALIDATE_FINAL_MS = 350;

/**
 * Keeps Leaflet's cached map size in step with its container, and (on
 * LayoutMobile only) re-pans to the user's coordinates when the mini card
 * is maximized or restored.
 *
 * 1. Container size. Leaflet caches the container size (`map.getSize()`)
 *    and uses it for every pan, recenter and tile range; it only re-reads
 *    it on a window resize or an explicit `invalidateSize()`. The container
 *    changes size without a window resize on the LayoutPi MIN / MID / MAX
 *    and full-rail morphs (a 200 ms grid transition) and the LayoutMobile
 *    card maximize. (The LayoutDesktop radar focus toggle doesn't resize
 *    the full-bleed map: only the overlays hide, and RailOffsetTracker
 *    re-pans for the zeroed rail offset.) A ResizeObserver on the
 *    container calls `invalidateSize` whenever that size actually changes:
 *    on every frame of a transition, the last one included. Until
 *    2026-10-09 this was two timers fired 50 ms and 250 ms after a layout
 *    flag changed. A CSS transition only gets its start time
 *    at the next rendered frame, so on a slow Pi 3B (and in a hidden
 *    browser pane) both reads could land before the transition ended and
 *    Leaflet kept a stale width. After leaving the fullscreen radar, the
 *    map centre, and the recenter button's target, then sat right of the
 *    visible centre. `invalidateSize` keeps the same geographic point at
 *    the centre; `debounceMoveend` keeps it from firing `moveend` (tile
 *    loading, SVG overlay re-clip) on every frame. Leaflet's own debounced
 *    `moveend` only fires 200 ms after the last resize, so a `moveend` is
 *    fired RESIZE_SETTLE_MS after the last frame that changed the size:
 *    the tiles of a newly exposed strip and the rings / alert polygons
 *    catch up as soon as the morph ends (Leaflet's later one is a cheap
 *    no-op). On a slow device whose frames are more than RESIZE_SETTLE_MS
 *    apart it can also fire between frames: a few refreshes per morph
 *    (3-4 measured at CPU ×20), about as cheap as the two the old timers
 *    fired.
 *
 * 2. LayoutMobile mapCard maximize / minimize — `mobileRadarMaximized`
 *    flips false ↔ true. Leaflet keeps the same geographic centre across a
 *    container resize, so when the 220 px mini-card pops up to fill the
 *    scroll (and back), the marker drifted to the top edge of the new
 *    viewport on iOS. Brackets get the invalidate + a `setView` recenter
 *    back to the marker.
 *
 * The mobileRadarMaximized effect is gated on `== null` (catches both
 * null and undefined): AppContext seeds the flag to `null`, LayoutMobile
 * flips it to false/true on mount and back to null on unmount. The
 * `=== undefined` check we used before v2.16.x didn't catch the `null`
 * sentinel, so on Pi/Desktop the effect fired on every lat/lng/zoom
 * change with a parasitic invalidate + setView during boot — the marker
 * ended up NE-offset on user-reported screens > 7".
 *
 * @param {object} props
 * @param {boolean} props.mobileRadarMaximized null on non-mobile layouts
 * @param {number} props.latitude Current marker latitude
 * @param {number} props.longitude Current marker longitude
 * @param {number} props.zoom Current map zoom level
 * @returns {null} renders nothing
 */
const MapResizer = ({ mobileRadarMaximized, latitude, longitude, zoom }) => {
  const map = useMap();
  useEffect(() => {
    let settle = null;
    const observer = new ResizeObserver(() => {
      const before = map.getSize();
      map.invalidateSize({ debounceMoveend: true });
      if (before.equals(map.getSize())) return;
      clearTimeout(settle);
      settle = setTimeout(() => map.fire("moveend"), RESIZE_SETTLE_MS);
    });
    observer.observe(map.getContainer());
    return () => {
      observer.disconnect();
      clearTimeout(settle);
    };
  }, [map]);

  useEffect(() => {
    if (mobileRadarMaximized == null) return undefined;
    const live = setTimeout(() => {
      map.invalidateSize();
      if (hasVal(latitude) && hasVal(longitude) && zoom) {
        map.setView([latitude, longitude], zoom, { animate: false });
      }
    }, MOBILE_INVALIDATE_LIVE_MS);
    const final = setTimeout(() => {
      map.invalidateSize();
      if (hasVal(latitude) && hasVal(longitude) && zoom) {
        map.setView([latitude, longitude], zoom, { animate: false });
      }
    }, MOBILE_INVALIDATE_FINAL_MS);
    return () => {
      clearTimeout(live);
      clearTimeout(final);
    };
  }, [mobileRadarMaximized, map, latitude, longitude, zoom]);
  return null;
};

MapResizer.propTypes = {
  mobileRadarMaximized: PropTypes.bool,
  latitude: PropTypes.number,
  longitude: PropTypes.number,
  zoom: PropTypes.number,
};

export default MapResizer;
