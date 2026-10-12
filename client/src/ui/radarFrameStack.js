// Radar frame window — which RainViewer frames keep a mounted TileLayer.
//
// Swapping one TileLayer's `url` per timeline step makes Leaflet drop and
// re-create every visible tile for the new frame: the map blanks between
// frames and storms pop in and out instead of moving. The classic radar-
// loop fix is one layer per frame, kept mounted, with playback flipping
// `opacity`. Technique adapted from the Sweep fork (github.com/Aryeh95,
// commits 7e27e15 and 2b0d0d1).
//
// The fork mounts every frame. Here only a small window around the
// playhead is mounted, because every mounted layer is a full Leaflet
// TileLayer, hidden or not:
//   - Each one fetches its whole viewport when it mounts, the newly
//     exposed tiles on every pan, and its whole viewport again on a zoom.
//     Leaflet's GridLayer never checks opacity, and a programmatic view
//     change (recenter, radar-focus resize) loads tiles synchronously,
//     before React could unmount anything.
//   - RainViewer rate-limits per public IP (500 requests/min, 300 in a
//     burst, shared by every kiosk behind the same router and by their
//     servers' radar analysis). A 34" panel shows ~30 tiles per frame, so
//     13 mounted frames would overrun the burst on one zoom.
//   - Leaflet never retries a failed tile while its layer stays mounted
//     (WeatherMap/RadarTileLayer.js holds a refused tile's URL past
//     RainViewer's 60 s window, then retries it).
//   - Memory on a 1 GB Pi 3B.
// So:
//   - Inactive (timeline closed, open but paused on "now" — the newest
//     past frame — or the Pi MAX view): only the displayed frame, exactly
//     as before (plus, for a few seconds after a frame-list refresh, the
//     frame it replaces: see "Refresh hold" below). Opening the bar costs
//     nothing (it is open by default on the non-priority layouts, so a
//     preload there would be a standing cost).
//   - Active (timeline shown and either playing or parked off "now"): the
//     displayed frame plus RADAR_PRELOAD_REACH frames on each side,
//     wrapping like playback. In playback and frame-by-frame scrubbing,
//     each step brings in the frame entering the window, which has
//     RADAR_PRELOAD_REACH steps to load before it shows, and lets go of
//     the one leaving it: the step itself is an opacity flip onto a loaded
//     layer, and the network and tile work per step equal the old url
//     swap (one frame, from the browser's HTTP cache after the first
//     pass: RainViewer sends max-age=172800).
//   - Slots (assignSlots): the frames live in a fixed set of
//     RADAR_SLOT_COUNT layers. The frame entering the window takes the
//     slot of the one leaving it, so the step retargets a hidden layer
//     (a url change) instead of destroying one layer and creating
//     another. Creating and destroying a Leaflet layer per step cost a
//     second, forced layout per step (a new GridLayer reads offsetWidth
//     when it creates its zoom level) and ~35 % more main-thread time
//     than the url swap; with slots, a headless-Chrome benchmark (800×480,
//     4×, 60 s)
//     measured the url swap's one layout per step, ~11 % more
//     main-thread time and ~9 % less renderer + GPU time overall.
//   - Entering the window mounts up to 2 × reach new frames at once:
//     pressing play mounts them at the press, so the first tick lands on
//     frame +1, requested a tick earlier (first, being nearest); the first
//     scrub step off "now" lands on a frame that is not loaded yet, as the
//     url swap always did. A jump of more than RADAR_PRELOAD_REACH frames
//     (a tap on the track, a fast drag) also lands cold and mounts up to
//     2 × reach + 1 frames. The window is returned nearest-first, so the
//     displayed frame's layer is added, and its tiles requested, before
//     the preloads. A pan, zoom or resize costs at most 2 × reach + 1
//     frames.
//   - Refresh hold (shouldHoldRadarFrame, keepsRadarHold, withHeldFrame).
//     The 10-minute refresh of RainViewer's frame index makes a new frame
//     the displayed one, usually while the window is inactive. Handing it
//     the old frame's slot changed the url of the VISIBLE layer, and
//     Leaflet's setUrl removes every tile before it requests the new
//     frame's: the radar went blank, then refilled tile by tile from the
//     network (this browser has never fetched the new frame). So the
//     displayed frame is held instead: it keeps its slot and stays on
//     screen, and the new frame takes a free slot as a NEW layer at
//     opacity 0, which loads its tiles all the same (Leaflet ignores
//     opacity). WeatherMap flips the two (new layer opaque, held frame
//     unmounted, in one effect flush) once the new layer has fired
//     `load` with no failed tile outstanding, RADAR_HOLD_SETTLE_MS later;
//     or at RADAR_HOLD_DEADLINE_MS, loaded or not. Sequence: ["f12"] →
//     ["f12", "f13"] → [null, "f13"] → ["f14", "f13"], 2 layers at most.
//     The rule is narrow on purpose: a new frame list, a displayed frame
//     that changed to one not already mounted, a frame shown before (not
//     the first load), an inactive window, the RainViewer source, and a
//     zoom at which the radar is drawn (RADAR_MAX_ZOOM). A timeline step
//     never holds: a scrub 11 → 12 lands on a frame that is already
//     loaded, and hiding the timeline while parked off "now" must show
//     "now" at once, not keep a frame up to 2 h old with no time label.
//     The hold ends early when the window turns active or the source or
//     the zoom no longer draws RainViewer radar. Request cost in the
//     normal case: the new frame's tiles once, as the url change fetched
//     them; the held layer requests nothing more unless the view moves
//     (or one of its refused tiles comes due for its cooldown retry).
//     Not covered: a refresh while playback sits on "now" shows the new
//     frame cold, as before (the window is active).
//
// MODULE FORMAT: CommonJS on purpose, like ui/autoTabSelector.js, so
// test/radarFrameStack.test.js runs the real module under `node --test`.

const { RADAR_TILE_COOLDOWN_MS } = require("./radarTileCooldown");

/** Frames mounted on each side of the playhead while the window is active. */
const RADAR_PRELOAD_REACH = 2;

/**
 * Highest map zoom at which the RainViewer layers draw: their `maxZoom`.
 * WeatherMap passes it to each layer as the literal 12, which
 * test/rainViewerTiles.test.js pins and checks against this constant.
 */
const RADAR_MAX_ZOOM = 12;

/**
 * Delay between the new frame's clean `load` and the end of a refresh
 * hold. Leaflet's GridLayer#_updateOpacity, run by the opacity change
 * that reveals the new layer, sets each tile to
 * min(1, (now − tile.loaded) / 200 ms) and fades the rest in, even with
 * fadeAnimation off: flipping at `load` would fade in the last tiles to
 * arrive, over a map the held frame has already left.
 */
const RADAR_HOLD_SETTLE_MS = 250;

/**
 * Longest refresh hold: the new frame is shown after this whatever its
 * state. Past the tile cooldown, so a tile of the new frame refused once
 * gets its first retry before the flip; holes left after that fill in
 * as later retries succeed, as they did before the hold.
 */
const RADAR_HOLD_DEADLINE_MS = RADAR_TILE_COOLDOWN_MS + 5_000;

/**
 * Frames that get a mounted TileLayer: the displayed frame alone when
 * inactive, else the displayed frame and `reach` frames on each side of
 * it, wrapping around the end of the list like playback does. Ordered
 * nearest-first (displayed, +1, −1, +2, −2): react-leaflet adds new
 * layers in render order and Leaflet requests a layer's tiles as soon as
 * it is added, so the displayed frame's tiles go out first.
 *
 * @param {Array<{path: string}>|null} frames - Frames in time order.
 * @param {number} currentIdx - Resolved index of the displayed frame.
 * @param {boolean} active - True while the timeline is shown and either playing or parked off "now".
 * @param {number} [reach] - Frames to mount on each side of the playhead.
 * @returns {Array<{path: string}>} The frames to mount, nearest-first (empty without frames).
 */
function framesToMount(frames, currentIdx, active, reach = RADAR_PRELOAD_REACH) {
  if (!Array.isArray(frames) || frames.length === 0) return [];
  const n = frames.length;
  const idx = ((Math.trunc(currentIdx) % n) + n) % n;
  if (!active) return [frames[idx]];
  const span = Math.min(Math.max(0, Math.trunc(reach)), n);
  const order = [idx];
  for (let k = 1; k <= span; k += 1) {
    for (const i of [(idx + k) % n, (((idx - k) % n) + n) % n]) {
      if (!order.includes(i)) order.push(i);
    }
  }
  return order.map((i) => frames[i]);
}

/** Layer slots: the largest window framesToMount can return. */
const RADAR_SLOT_COUNT = 2 * RADAR_PRELOAD_REACH + 1;

/** Shared "no slots yet" identity. Never mutated. */
const NO_SLOTS = Object.freeze([]);

/**
 * Places the frames to mount into a fixed set of layer slots, so a layer
 * is retargeted (its url changes) instead of being destroyed and created
 * (see the header: one layout per step instead of two).
 * A frame already in a slot keeps it; a slot whose frame left the window
 * is freed and handed to the next new frame, nearest-first. Returns
 * `prevSlots` itself when nothing changes, so a caller that stores the
 * result in state and writes it back only on a new reference converges.
 *
 * @param {ReadonlyArray<?string>} prevSlots - Previous slot contents (frame paths, or null for a free slot).
 * @param {Array<string>} paths - Frame paths to mount, nearest-first (framesToMount order).
 * @param {number} [slotCount] - Number of slots.
 * @returns {ReadonlyArray<?string>} Slot contents: `prevSlots` when unchanged, else a new array.
 */
function assignSlots(prevSlots, paths, slotCount = RADAR_SLOT_COUNT) {
  const wanted = new Set(paths.slice(0, slotCount));
  const next = [];
  for (let i = 0; i < slotCount; i += 1) {
    const p = i < prevSlots.length ? prevSlots[i] : null;
    next.push(p != null && wanted.has(p) ? p : null);
  }
  for (const p of wanted) {
    if (!next.includes(p)) next[next.indexOf(null)] = p;
  }
  // Trailing free slots are dropped so an inactive window renders one slot.
  while (next.length > 0 && next[next.length - 1] === null) next.pop();
  if (next.length === prevSlots.length && next.every((p, i) => p === prevSlots[i])) return prevSlots;
  return next;
}

/**
 * The frame paths to place in slots during a refresh hold: `paths`
 * (framesToMount order) with the held frame appended last, so it stays
 * in the slot it already has (assignSlots keeps a frame's slot while the
 * frame is wanted) and the new frame takes a free slot.
 *
 * @param {Array<string>} paths - Frame paths to mount, nearest-first.
 * @param {?string} held - Path of the frame held on screen, or null.
 * @returns {Array<string>} `paths` itself without a hold (or when it already holds the frame), else a new array.
 */
function withHeldFrame(paths, held) {
  if (held == null || paths.includes(held)) return paths;
  return [...paths, held];
}

/**
 * The frame of the only occupied slot: the frame on screen when the
 * window was inactive and nothing was held. Null when no slot or several
 * slots are occupied (an active window: which frame showed is not known
 * from the slots alone).
 *
 * @param {ReadonlyArray<?string>} slots - Slot contents (assignSlots).
 * @returns {?string} The path of the only mounted frame, or null.
 */
function onlyMountedPath(slots) {
  let found = null;
  for (const p of slots) {
    if (p == null) continue;
    if (found != null) return null;
    found = p;
  }
  return found;
}

/**
 * Whether the RainViewer layers draw at a map zoom. Leaflet rounds the
 * zoom and creates no tile above the layer's maxZoom. An unknown zoom
 * counts as drawn: a hold then costs at worst its deadline.
 *
 * @param {number} zoom - Map zoom (may be fractional during a pinch).
 * @param {number} [maxZoom] - The layers' maxZoom.
 * @returns {boolean} True when radar tiles are drawn at that zoom.
 */
function radarDrawnAtZoom(zoom, maxZoom = RADAR_MAX_ZOOM) {
  return !Number.isFinite(zoom) || Math.round(zoom) <= maxZoom;
}

/**
 * Whether a render starts a refresh hold: keep `shownPath` on screen
 * while the newly displayed frame loads in a layer of its own (see
 * "Refresh hold" in the header). Every condition must hold.
 *
 * @param {object} input - The render's state.
 * @param {boolean} input.framesChanged - The frame list differs from the one the previous decision saw.
 * @param {?string} input.shownPath - Frame on screen before this render (the held one, else onlyMountedPath of the slots); null on the first load.
 * @param {?string} input.targetPath - Frame the playhead now resolves to.
 * @param {ReadonlyArray<?string>} input.mountedPaths - Slot contents before this render.
 * @param {boolean} input.windowActive - The frame window is active (timeline playing or parked off "now").
 * @param {string} input.source - Radar source ("rainviewer" or "eccc").
 * @param {number} input.zoom - Current map zoom.
 * @returns {boolean} True to hold `shownPath`.
 */
function shouldHoldRadarFrame({
  framesChanged,
  shownPath,
  targetPath,
  mountedPaths,
  windowActive,
  source,
  zoom,
}) {
  return Boolean(framesChanged)
    && source === "rainviewer"
    && !windowActive
    && radarDrawnAtZoom(zoom)
    && shownPath != null
    && targetPath != null
    && targetPath !== shownPath
    && !mountedPaths.includes(targetPath);
}

/**
 * Whether a refresh hold already in place goes on in this render. It
 * ends at once when the window turns active (playback or scrubbing takes
 * over), the source is no longer RainViewer, the zoom leaves the range
 * where radar is drawn (nothing to keep on screen), or the playhead is
 * back on the held frame. Its normal ends (the new frame loaded, the
 * deadline) are WeatherMap's timers.
 *
 * @param {object} input - The render's state.
 * @param {?string} input.held - Frame currently held, or null.
 * @param {?string} input.targetPath - Frame the playhead now resolves to.
 * @param {boolean} input.windowActive - The frame window is active.
 * @param {string} input.source - Radar source ("rainviewer" or "eccc").
 * @param {number} input.zoom - Current map zoom.
 * @returns {boolean} True to keep holding `held`.
 */
function keepsRadarHold({ held, targetPath, windowActive, source, zoom }) {
  return held != null
    && targetPath != null
    && targetPath !== held
    && source === "rainviewer"
    && !windowActive
    && radarDrawnAtZoom(zoom);
}

module.exports = {
  RADAR_PRELOAD_REACH,
  RADAR_SLOT_COUNT,
  RADAR_MAX_ZOOM,
  RADAR_HOLD_SETTLE_MS,
  RADAR_HOLD_DEADLINE_MS,
  NO_SLOTS,
  framesToMount,
  assignSlots,
  withHeldFrame,
  onlyMountedPath,
  radarDrawnAtZoom,
  shouldHoldRadarFrame,
  keepsRadarHold,
};
