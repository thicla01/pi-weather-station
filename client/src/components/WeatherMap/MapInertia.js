import { useEffect } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";

import { prefersReducedMotion, subscribeReducedMotion } from "~/ui/systemPrefs";
import { mapInertia } from "~/ui/mapMotion";

/**
 * Turns Leaflet's drag inertia off while the OS asks for reduced motion,
 * and back on when it stops asking, live (no reload). Inertia is the
 * glide that carries the map on after a fast drag is released, a
 * PosAnimation run in JavaScript, which the CSS reduced-motion rule in
 * styles/main.css cannot reach.
 *
 * Leaflet's Map.Drag reads `map.options.inertia` at every drag start,
 * move and end, so writing the option (`L.setOptions`) when the
 * preference changes is enough: the next release follows it. A change in
 * the middle of a drag is harmless: Map.Drag keeps its position history
 * from the moment dragging is enabled and prunes it to the last 50 ms, so
 * that release glides, or not, by the value it reads then.
 *
 * The map's own option at mount (Leaflet's default, `true`) is what the
 * preference turns back on, and what the cleanup restores.
 *
 * @returns {null} renders nothing
 */
const MapInertia = () => {
  const map = useMap();
  useEffect(() => {
    const baseInertia = map.options.inertia;
    const apply = () => {
      L.setOptions(map, { inertia: mapInertia(baseInertia, prefersReducedMotion()) });
    };
    apply();
    const unsubscribe = subscribeReducedMotion(apply);
    return () => {
      unsubscribe();
      L.setOptions(map, { inertia: baseInertia });
    };
  }, [map]);
  return null;
};

export default MapInertia;
