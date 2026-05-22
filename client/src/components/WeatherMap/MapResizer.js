import { useEffect } from "react";
import PropTypes from "prop-types";
import { useMap } from "react-leaflet";

import { hasVal } from "./geometry";

const COLLAPSE_INVALIDATE_LIVE_MS = 50;
const COLLAPSE_INVALIDATE_FINAL_MS = 250;
const MOBILE_INVALIDATE_FINAL_MS = 350;

/**
 * Invalidates the Leaflet map size when the surrounding layout shifts,
 * and (on LayoutMobile only) re-pans to the user's coordinates so the
 * marker stays geographically centred across the resize.
 *
 * Three layout shifts that need an invalidate:
 *
 * 1. LayoutPi rail collapse / expand — `infoPanelCollapsed` changes,
 *    grid-template-columns animates over 200 ms. Two `invalidateSize`
 *    calls bracket the transition (one at 50 ms for live feedback as
 *    the rail slides, one at 250 ms to latch the final size for pan
 *    math). Without the late call, Leaflet's internal `_size` cache
 *    keeps a mid-transition value and subsequent pans (e.g. the Reset
 *    Map button) land the marker off-centre.
 *
 * 2. LayoutDesktop radar focus toggle — `desktopRadarMaximized` flips
 *    on/off, HeroBand + rail hide/show. Reuses the same 50 + 250 ms
 *    bracket since the geometry change is comparable.
 *
 * 3. LayoutMobile mapCard maximize / minimize — `mobileRadarMaximized`
 *    flips false ↔ true. Leaflet keeps the same geographic centre
 *    across a container resize, so when the 220 px mini-card pops up
 *    to fill the scroll (and back), the marker drifted to the top
 *    edge of the new viewport on iOS. Brackets get the invalidate +
 *    a `setView` recenter back to the geometric centre.
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
 * @param {boolean} props.infoPanelCollapsed Pi rail collapse state
 * @param {boolean} props.mobileRadarMaximized null on non-mobile layouts
 * @param {boolean} props.desktopRadarMaximized Desktop focus-mode state
 * @param {number} props.latitude Current marker latitude
 * @param {number} props.longitude Current marker longitude
 * @param {number} props.zoom Current map zoom level
 * @returns {null} renders nothing
 */
const MapResizer = ({ infoPanelCollapsed, mobileRadarMaximized, desktopRadarMaximized, latitude, longitude, zoom }) => {
  const map = useMap();
  useEffect(() => {
    const live = setTimeout(() => map.invalidateSize(), COLLAPSE_INVALIDATE_LIVE_MS);
    const final = setTimeout(() => map.invalidateSize(), COLLAPSE_INVALIDATE_FINAL_MS);
    return () => {
      clearTimeout(live);
      clearTimeout(final);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- desktopRadarMaximized purposely re-triggers the same handler
  }, [infoPanelCollapsed, desktopRadarMaximized, map]);

  useEffect(() => {
    if (mobileRadarMaximized == null) return undefined;
    const live = setTimeout(() => {
      map.invalidateSize();
      if (hasVal(latitude) && hasVal(longitude) && zoom) {
        map.setView([latitude, longitude], zoom, { animate: false });
      }
    }, COLLAPSE_INVALIDATE_LIVE_MS);
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
  infoPanelCollapsed: PropTypes.bool,
  mobileRadarMaximized: PropTypes.bool,
  desktopRadarMaximized: PropTypes.bool,
  latitude: PropTypes.number,
  longitude: PropTypes.number,
  zoom: PropTypes.number,
};

export default MapResizer;
