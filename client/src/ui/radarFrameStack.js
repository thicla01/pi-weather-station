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
//     as before. Opening the bar costs nothing (it is open by default on
//     the non-priority layouts, so a preload there would be a standing
//     cost).
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
//
// MODULE FORMAT: CommonJS on purpose, like ui/autoTabSelector.js, so
// test/radarFrameStack.test.js runs the real module under `node --test`.

/** Frames mounted on each side of the playhead while the window is active. */
const RADAR_PRELOAD_REACH = 2;

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

module.exports = {
  RADAR_PRELOAD_REACH,
  RADAR_SLOT_COUNT,
  NO_SLOTS,
  framesToMount,
  assignSlots,
};
