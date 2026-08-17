import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";

// The real constraint is a ROW budget, not a favorite count: the Places
// popover fits 7 rows and no more. An 8th row of 44 px touch targets cannot
// fit the fleet's 480 px-tall panels under any cap value (measured
// 2026-08-16; the popover portals outside the rail's font-size zoom, so font
// L does not change this budget). Rows are:
//
//     rows = favorites.length + (home pinned ? 0 : 1)
//
// — the `⌂` pseudo-row occupies a slot exactly when no favorite sits on the
// home coordinates. So the list may hold 7 favorites when one of them IS
// home, and 6 otherwise, and both cases render 7 rows. Pinning home is
// therefore always row-neutral: it converts the pseudo-row into a stored row.
//
// This replaced a flat cap of 6 on 2026-08-17, after the flat version charged
// a slot for pinning home — spending one of six on a place that had been
// displayed for free. Quota agrees: the extra entry can only ever be the home
// location, which is where the kiosk boots and where Recenter returns, so its
// weather is effectively always cached and the marginal upstream cost is nil.
// Measurements and the row arithmetic in
// docs/favorite-locations-design.md §4 (amended).
const MAX_ROWS = 7;
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
 * Edit affordances are gated on `isLocal` by the caller, where they render;
 * the server enforces the real boundary. The one thing the hook does need
 * from outside is the home coordinates, because the cap is a row budget and
 * the `⌂` pseudo-row only occupies a row when no favorite sits on home.
 *
 * @param {object} [options]
 * @param {{latitude: number, longitude: number}|null} [options.home] the
 *   default location (`browserGeo`). Omitted or null → the pseudo-row is
 *   assumed present, i.e. the stricter 6-favorite cap applies.
 * @returns {{
 *   favorites: Array<{id: string, label: string, lat: number, lon: number}>,
 *   canPin: boolean,
 *   canPinHome: boolean,
 *   maxFavorites: number,
 *   isPinned: (coords: {latitude: number, longitude: number}) => boolean,
 *   hydrate: (list: unknown) => void,
 *   pin: (entry: {label: string, lat: number, lon: number}) => Promise<boolean>,
 *   remove: (id: string) => Promise<boolean>,
 *   rename: (id: string, label: string) => Promise<boolean>
 * }} the list plus its actions
 */
export default function useFavoriteLocations({ home = null } = {}) {
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

  // Same mirroring for the home coordinates, so `pin` can enforce the row
  // budget without listing `home` as a dependency (which would mint a new
  // `pin` identity on every geolocation update). Written in an effect, never
  // during render — react-hooks/refs.
  const homeRef = useRef(home);
  useEffect(() => {
    homeRef.current = home;
  }, [home]);

  /**
   * How many favorites may be stored right now.
   *
   * The `⌂` pseudo-row costs a row exactly when no favorite sits on the home
   * coordinates, so the list may hold one more entry when home IS pinned —
   * both cases render `MAX_ROWS` rows. See the MAX_ROWS comment above.
   *
   * @param {Array} list current favorites
   * @param {{latitude: number, longitude: number}|null} homeCoords
   * @returns {number} the effective cap
   */
  const capFor = (list, homeCoords) => {
    const homePinned = !!homeCoords
      && homeCoords.latitude != null
      && list.some((f) => sameSpot(f, { lat: homeCoords.latitude, lon: homeCoords.longitude }));
    return homePinned ? MAX_ROWS : MAX_ROWS - 1;
  };

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
    // Trim to the hard row budget; the finer home-aware cap is a UX gate,
    // not a storage guarantee, and hydration must never widen the list.
    commit(clean.slice(0, MAX_ROWS));
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
    // Budget the RESULTING list, not the current one. Pinning home raises the
    // cap by suppressing the pseudo-row, so a pre-add check reads the old,
    // stricter cap and silently refuses the very action that would relax it —
    // which is exactly what it did before this was caught in the browser.
    const candidate = [...current, next];
    if (candidate.length > capFor(candidate, homeRef.current)) return Promise.resolve(false);
    return persist(candidate);
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

  // No device gate on rename (removed 2026-08-17). It used to be
  // `navigator.maxTouchPoints === 0`, which answers "is a toucher present",
  // not "can the user type" — so it hid rename from any touch-capable client
  // that does have a keyboard, and the web platform offers no reliable way to
  // detect an attached one (`navigator.keyboard` reports layout, not
  // presence). Rather than swap one unreliable proxy for another, the
  // affordance is always offered and the Enter/Esc contract is stated under
  // the input; on a keyboard-less kiosk the field simply cannot be filled and
  // blurring it commits nothing, because the draft still equals the current
  // label. Reaching it takes a deliberate tap into Edit mode, so it is never
  // hit by accident. Full rationale in
  // docs/favorite-locations-design.md §5.1.1 (amended).
  const maxFavorites = capFor(favorites, home);

  return useMemo(() => ({
    favorites,
    canPin: favorites.length < maxFavorites,
    // Pinning home is row-neutral — the stored row replaces the pseudo-row it
    // suppresses — so it is allowed right up to the row budget, even when
    // `canPin` has already closed for ordinary places. This is the case that
    // motivated the change: at 6 favorites plus the pseudo-row you are already
    // showing 7 rows, and pinning home still shows 7.
    canPinHome: favorites.length < MAX_ROWS,
    maxFavorites,
    isPinned,
    hydrate,
    pin,
    remove,
    rename,
  }), [favorites, maxFavorites, isPinned, hydrate, pin, remove, rename]);
}
