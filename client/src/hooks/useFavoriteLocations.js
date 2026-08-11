import { useCallback, useMemo, useRef, useState } from "react";
import axios from "axios";

// Hard ceiling on the list. Mirrors MAX_FAVORITES in server/settingsCtrl.js,
// which is the actual guarantee — this one is the UX affordance that disables
// the pin action before the user hits a silent server-side truncation.
//
// Six is not arbitrary: it is the largest list that renders without scrolling
// in the Places popover on the 7" rail at font size L (the tightest layout
// budget on the fleet), and visiting all six inside one weather-cache window
// stays under the 25 req/h Tomorrow.io ceiling that two Pis share.
// Rationale in docs/favorite-locations-design.md §4.
const MAX_FAVORITES = 6;
const MAX_LABEL_LEN = 40;

// Shared empty list. Module-scope and frozen so the "no favorites" case keeps
// ONE stable reference across renders — a fresh `[]` would mint a new
// `locationSlice` context value on every AppContext render (favorites is one
// of its useMemo deps) and re-render every location consumer in the tree, on
// a 1 GB Pi 3, forever. Same contract as NO_ALERTS in WeatherMap/index.js.
const NO_FAVORITES = Object.freeze([]);

/**
 * Round a coordinate to 4 decimals.
 *
 * Mirrors `round4` in server/settingsCtrl.js. Applied at pin time so a
 * favorite's coordinates are frozen at the precision of the weather proxy's
 * cache key (`type:fieldsHash:lat(4dp):lon(4dp)`) — returning to a favorite
 * then re-uses its cached weather instead of costing three fresh Tomorrow.io
 * calls. See docs/favorite-locations-design.md §6.1.
 *
 * @param {number} n coordinate value
 * @returns {number} the value rounded to 4 decimal places
 */
const round4 = (n) => Math.round(n * 1e4) / 1e4;

/**
 * True when two points are the same favorite spot, compared at the stored
 * 4-decimal precision rather than by float equality.
 *
 * @param {{lat: number, lon: number}} a first point
 * @param {{lat: number, lon: number}} b second point
 * @returns {boolean} true when both points round to the same stored coordinates
 */
const sameSpot = (a, b) => round4(a.lat) === round4(b.lat) && round4(a.lon) === round4(b.lon);

/**
 * Favorite locations — a bounded, server-persisted list of places the user
 * can jump back to.
 *
 * Storage is `settings.json` (key `favorites`), not localStorage: the list
 * survives a kiosk browser-profile reset, is backed up with the rest of the
 * configuration, and sits next to `startingLat`/`startingLon`, which the
 * "set as default" action writes. Every mutation is a `PATCH /setting`, which
 * is `localhostOnly` — a remote client can read and navigate the list but not
 * change it, exactly like the coordinates it lives beside.
 *
 * Writes are optimistic: React state updates first so the touchscreen feels
 * immediate, and a failed PATCH rolls the state back and resolves `false` so
 * the caller can show the failure. A silent failure on a kiosk nobody is
 * watching is worse than a visible one.
 *
 * Seeding is deliberately NOT done here with an effect. The caller hydrates
 * from the boot `GET /settings` response it already fetches (see `hydrate`) —
 * one fewer `set-state-in-effect` site for the React Compiler readiness pass
 * to revisit. See docs/favorite-locations-design.md §8.6.
 *
 * @param {object} [options]
 * @param {boolean} [options.isLocal] whether the client is on localhost;
 *   gates the edit affordances (the server enforces the real boundary)
 * @returns {{
 *   favorites: Array<{id: string, label: string, lat: number, lon: number, zoom?: number}>,
 *   canPin: boolean,
 *   canRename: boolean,
 *   maxFavorites: number,
 *   isPinned: (coords: {latitude: number, longitude: number}) => boolean,
 *   hydrate: (list: unknown) => void,
 *   pin: (entry: {label: string, lat: number, lon: number, zoom?: number}) => Promise<boolean>,
 *   remove: (id: string) => Promise<boolean>,
 *   rename: (id: string, label: string) => Promise<boolean>
 * }} the list plus its actions
 */
export default function useFavoriteLocations({ isLocal = true } = {}) {
  const [favorites, setFavorites] = useState(NO_FAVORITES);

  // Mirror ref so the mutations can read the current list without listing it
  // as a useCallback dependency — otherwise every pin/remove would mint new
  // action identities and churn the context slice that exposes them.
  const favoritesRef = useRef(favorites);
  const commit = useCallback((next) => {
    const value = next.length === 0 ? NO_FAVORITES : next;
    favoritesRef.current = value;
    setFavorites(value);
    return value;
  }, []);

  /**
   * Hydrate from a `GET /settings` payload. Defensive: anything that is not
   * an array of well-formed entries collapses to the empty list rather than
   * throwing — the server sanitizes on the way out, but a client that trusts
   * a payload shape it did not verify is one bad deploy from a blank kiosk.
   *
   * @param {unknown} list the `favorites` value from the settings response
   */
  const hydrate = useCallback((list) => {
    if (!Array.isArray(list)) {
      commit([]);
      return;
    }
    const clean = list.filter((f) => (
      f && typeof f === "object"
      && typeof f.label === "string" && f.label
      && Number.isFinite(Number(f.lat)) && Number.isFinite(Number(f.lon))
    ));
    commit(clean.slice(0, MAX_FAVORITES));
  }, [commit]);

  /**
   * Persist a candidate list, optimistically. Rolls back on failure.
   *
   * @param {Array} next the list to write
   * @returns {Promise<boolean>} true when the write landed
   */
  const persist = useCallback((next) => {
    const previous = favoritesRef.current;
    commit(next);
    return axios
      .patch("/setting", { key: "favorites", val: next })
      .then(() => true)
      .catch((err) => {
        commit(previous.slice());
        // 403 = remote client hit `localhostOnly`. Expected when someone
        // browses the list over the LAN; not worth a console warning.
        if (!(err && err.response && err.response.status === 403)) {
          console.warn("favorites PATCH failed:", err && err.message);
        }
        return false;
      });
  }, [commit]);

  const pin = useCallback((entry) => {
    const { current } = favoritesRef;
    if (current.length >= MAX_FAVORITES) return Promise.resolve(false);
    const lat = Number(entry && entry.lat);
    const lon = Number(entry && entry.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Promise.resolve(false);
    const label = String((entry && entry.label) || "").trim().slice(0, MAX_LABEL_LEN);
    if (!label) return Promise.resolve(false);
    if (current.some((f) => sameSpot(f, { lat, lon }))) return Promise.resolve(false);
    const next = {
      // Date.now() is unique enough here: two pins cannot be created in the
      // same millisecond by one touchscreen, and the id is opaque.
      id: `fav_${Date.now()}`,
      label,
      lat: round4(lat),
      lon: round4(lon),
    };
    if (Number.isInteger(entry.zoom) && entry.zoom >= 1 && entry.zoom <= 18) {
      next.zoom = entry.zoom;
    }
    return persist([...current, next]);
  }, [persist]);

  const remove = useCallback((id) => {
    const { current } = favoritesRef;
    // No-op when the id is already gone — guards the two-tap confirm against
    // deleting whatever row shifted into place if the list changed between
    // the arming tap and the confirming one.
    if (!current.some((f) => f.id === id)) return Promise.resolve(false);
    return persist(current.filter((f) => f.id !== id));
  }, [persist]);

  const rename = useCallback((id, label) => {
    const { current } = favoritesRef;
    const clean = String(label || "").trim().slice(0, MAX_LABEL_LEN);
    // An empty commit reverts rather than saving a label-less entry — the
    // server sanitizer drops those, so an empty save would read to the user
    // as "renaming deleted my favorite".
    if (!clean) return Promise.resolve(false);
    const target = current.find((f) => f.id === id);
    if (!target || target.label === clean) return Promise.resolve(false);
    return persist(current.map((f) => (f.id === id ? { ...f, label: clean } : f)));
  }, [persist]);

  const isPinned = useCallback((coords) => {
    if (!coords || coords.latitude == null || coords.longitude == null) return false;
    const point = { lat: coords.latitude, lon: coords.longitude };
    return favorites.some((f) => sameSpot(f, point));
  }, [favorites]);

  // Rename needs a keyboard, and the kiosk has none — there is no on-screen
  // keyboard in this project. `maxTouchPoints === 0` separates an HDMI monitor
  // or a desktop browser on the SSH tunnel (0) from the 7" DSI touchscreen
  // (> 0); it is the same discriminator useAutoTabSelector uses to decide
  // whether a reader is present. `isLocal` is required anyway because the
  // write is localhost-gated.
  const canRename = isLocal
    && typeof navigator !== "undefined"
    && navigator.maxTouchPoints === 0;

  return useMemo(() => ({
    favorites,
    canPin: favorites.length < MAX_FAVORITES,
    canRename,
    maxFavorites: MAX_FAVORITES,
    isPinned,
    hydrate,
    pin,
    remove,
    rename,
  }), [favorites, canRename, isPinned, hydrate, pin, remove, rename]);
}
