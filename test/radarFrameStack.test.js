// Regression tests for the radar frame window in
// `client/src/ui/radarFrameStack.js` — which RainViewer frames keep a
// mounted TileLayer while the timeline plays or scrubs, which layer slot
// each one uses, and the refresh hold (the frame on screen kept in its
// slot while a frame a refresh brought in loads in another). The module
// is CommonJS so these tests exercise the real code. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { RADAR_PRELOAD_REACH, framesToMount } = require("../client/src/ui/radarFrameStack");

// 13 past frames, like RainViewer's index (2 h at 10-min steps).
const frames = (n = 13, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ path: `/v2/radar/f${from + i}`, kind: "past" }));
const idxOf = (list) => list.map((f) => Number(f.path.slice("/v2/radar/f".length)));

test("reach default is 2 frames on each side (5 layers at most)", () => {
  assert.equal(RADAR_PRELOAD_REACH, 2);
  assert.equal(framesToMount(frames(), 6, true).length, 5);
});

test("inactive: the displayed frame alone, wherever the playhead is", () => {
  const f = frames();
  assert.deepEqual(framesToMount(f, 12, false), [f[12]]);
  assert.deepEqual(framesToMount(f, 0, false), [f[0]]);
  assert.deepEqual(framesToMount(f, 5, false), [f[5]]);
});

test("no frames: nothing to mount, active or not", () => {
  assert.deepEqual(framesToMount(null, 0, true), []);
  assert.deepEqual(framesToMount([], 0, true), []);
  assert.deepEqual(framesToMount(undefined, 0, false), []);
});

test("active mounts the playhead ± reach, wrapping like playback, nearest-first", () => {
  // 12 is "now": playback goes 12 → 0 → 1, a scrub goes 12 → 11 → 10.
  // Displayed first, so its layer is added and its tiles requested first.
  assert.deepEqual(idxOf(framesToMount(frames(), 12, true)), [12, 0, 11, 1, 10]);
  assert.deepEqual(idxOf(framesToMount(frames(), 0, true)), [0, 1, 12, 2, 11]);
  assert.deepEqual(idxOf(framesToMount(frames(), 6, true)), [6, 7, 5, 8, 4]);
});

test("the window never exceeds 2 × reach + 1 frames, however long playback runs", () => {
  const f = frames();
  for (let loop = 0; loop < 3; loop += 1) {
    for (let idx = 0; idx < f.length; idx += 1) {
      const mounted = framesToMount(f, idx, true);
      assert.equal(mounted.length, 2 * RADAR_PRELOAD_REACH + 1);
      assert.ok(mounted.includes(f[idx]), "the displayed frame is always mounted");
    }
  }
});

test("each playback step mounts exactly one new frame and drops exactly one", () => {
  const f = frames();
  for (let idx = 0; idx < f.length; idx += 1) {
    const before = new Set(framesToMount(f, idx, true).map((x) => x.path));
    const after = new Set(framesToMount(f, (idx + 1) % f.length, true).map((x) => x.path));
    const added = [...after].filter((p) => !before.has(p));
    const dropped = [...before].filter((p) => !after.has(p));
    assert.equal(added.length, 1, `step ${idx} → ${idx + 1} mounts one frame`);
    assert.equal(dropped.length, 1, `step ${idx} → ${idx + 1} drops one frame`);
    // The frame a step lands on was already mounted `reach` steps before.
    assert.ok(before.has(f[(idx + 1) % f.length].path));
  }
});

test("after the 10-minute frame refresh the window follows the new list", () => {
  const refreshed = frames(13, 1); // f0 dropped, f13 appended
  const mounted = framesToMount(refreshed, 12, true).map((x) => x.path);
  assert.ok(!mounted.includes("/v2/radar/f0"));
  assert.ok(mounted.includes("/v2/radar/f13"));
});

test("reach is clamped and short lists mount each frame once", () => {
  const f = frames(3);
  assert.deepEqual(idxOf(framesToMount(f, 0, true, 50)), [0, 1, 2]);
  assert.deepEqual(idxOf(framesToMount(frames(4), 0, true, 2)), [0, 1, 3, 2]);
  assert.deepEqual(idxOf(framesToMount(f, 1, true, 0)), [1]);
  assert.deepEqual(idxOf(framesToMount(f, 1, true, -3)), [1]);
  assert.deepEqual(idxOf(framesToMount(frames(1), 0, true)), [0]);
});

test("an out-of-range playhead index is wrapped instead of throwing", () => {
  assert.deepEqual(idxOf(framesToMount(frames(), 14, true, 0)), [1]);
  assert.deepEqual(idxOf(framesToMount(frames(), -1, true, 0)), [12]);
  assert.deepEqual(idxOf(framesToMount(frames(), 13, false)), [0]);
});

// ── assignSlots: fixed layer slots, retargeted instead of remounted ──

const { RADAR_SLOT_COUNT, NO_SLOTS, assignSlots } = require("../client/src/ui/radarFrameStack");

const pathsAt = (idx, active = true) => framesToMount(frames(), idx, active).map((f) => f.path);

test("slot count is the largest window (2 × reach + 1)", () => {
  assert.equal(RADAR_SLOT_COUNT, 2 * RADAR_PRELOAD_REACH + 1);
});

test("first activation fills slots nearest-first; unchanged input keeps the same array", () => {
  const s1 = assignSlots(NO_SLOTS, pathsAt(12));
  assert.deepEqual(s1, ["/v2/radar/f12", "/v2/radar/f0", "/v2/radar/f11", "/v2/radar/f1", "/v2/radar/f10"]);
  assert.equal(assignSlots(s1, pathsAt(12)), s1);
});

test("a playback step retargets exactly one slot: the leaving frame's slot gets the entering frame", () => {
  let slots = assignSlots(NO_SLOTS, pathsAt(12));
  for (let step = 0; step < 26; step += 1) {
    const idx = step % 13;
    const next = assignSlots(slots, pathsAt(idx));
    const changed = next.map((p, i) => (p !== slots[i] ? i : -1)).filter((i) => i >= 0);
    assert.equal(next.length, RADAR_SLOT_COUNT);
    assert.ok(changed.length <= 1, `step to ${idx} changes at most one slot (changed ${changed})`);
    assert.ok(next.includes(frames()[idx].path), "the displayed frame is in a slot");
    // Frames still in the window never move to another slot.
    for (let i = 0; i < slots.length; i += 1) {
      if (slots[i] && next.includes(slots[i])) assert.equal(next[i], slots[i]);
    }
    slots = next;
  }
});

test("deactivating keeps the displayed frame in its slot and frees the others", () => {
  const active = assignSlots(NO_SLOTS, pathsAt(12));
  const inactive = assignSlots(active, pathsAt(12, false));
  assert.deepEqual(inactive, ["/v2/radar/f12"]);
  // Displayed frame in a middle slot: the slot index is kept, earlier ones are freed.
  let slots = assignSlots(NO_SLOTS, pathsAt(12));
  slots = assignSlots(slots, pathsAt(11));
  const parked = assignSlots(slots, pathsAt(11, false));
  assert.equal(parked.indexOf("/v2/radar/f11"), slots.indexOf("/v2/radar/f11"));
  assert.equal(parked.filter(Boolean).length, 1);
  assert.equal(parked[parked.length - 1], "/v2/radar/f11", "trailing free slots are dropped");
});

test("a jump frees every slot and refills them nearest-first, displayed frame first", () => {
  const slots = assignSlots(NO_SLOTS, pathsAt(12));
  const jumped = assignSlots(slots, pathsAt(5));
  assert.equal(jumped[0], "/v2/radar/f5");
  assert.deepEqual([...jumped].sort(), pathsAt(5).sort());
});

test("no frames: no slots", () => {
  assert.deepEqual(assignSlots(NO_SLOTS, []), []);
  assert.deepEqual(assignSlots(["/v2/radar/f1"], []), []);
});

// ── Refresh hold: the frame on screen stays until the new one has loaded ──

const {
  RADAR_MAX_ZOOM,
  RADAR_HOLD_SETTLE_MS,
  RADAR_HOLD_DEADLINE_MS,
  withHeldFrame,
  onlyMountedPath,
  radarDrawnAtZoom,
  shouldHoldRadarFrame,
  keepsRadarHold,
} = require("../client/src/ui/radarFrameStack");
const { RADAR_TILE_COOLDOWN_MS } = require("../client/src/ui/radarTileCooldown");

// A 10-minute refresh while the window is inactive: f12 on screen, the
// new list's newest past frame is f13, which no layer has loaded.
const refresh = (overrides = {}) => ({
  framesChanged: true,
  shownPath: "/f12",
  targetPath: "/f13",
  mountedPaths: ["/f12"],
  windowActive: false,
  source: "rainviewer",
  zoom: 8,
  ...overrides,
});

test("without a hold the new frame takes the old frame's slot (a url change on the visible layer)", () => {
  // What the hold exists to avoid: the same layer, setUrl, Leaflet blanks it.
  assert.deepEqual(assignSlots(["/f12"], ["/f13"]), ["/f13"]);
});

test("constants: the hold's deadline is past the tile cooldown, the flip waits out Leaflet's 200 ms tile fade", () => {
  assert.equal(RADAR_HOLD_DEADLINE_MS, RADAR_TILE_COOLDOWN_MS + 5_000);
  assert.equal(RADAR_HOLD_DEADLINE_MS, 70_000);
  assert.ok(RADAR_HOLD_SETTLE_MS > 200, "Leaflet fades in tiles loaded < 200 ms before an opacity change");
  assert.ok(RADAR_HOLD_SETTLE_MS < 1_000);
  assert.equal(RADAR_MAX_ZOOM, 12);
});

test("withHeldFrame appends the held frame last, and leaves the list alone otherwise", () => {
  const paths = ["/f13"];
  assert.equal(withHeldFrame(paths, null), paths);
  assert.equal(withHeldFrame(paths, "/f13"), paths);
  assert.deepEqual(withHeldFrame(paths, "/f12"), ["/f13", "/f12"]);
  assert.deepEqual(paths, ["/f13"], "input not mutated");
});

test("hold sequence: [f12] → [f12, f13] → [null, f13] → [f14, f13]", () => {
  const s0 = assignSlots(NO_SLOTS, ["/f12"]);
  assert.deepEqual(s0, ["/f12"]);
  // Refresh: f12 held in its slot, f13 in a free slot (a new layer).
  const s1 = assignSlots(s0, withHeldFrame(["/f13"], "/f12"));
  assert.deepEqual(s1, ["/f12", "/f13"]);
  // f13 loaded: the hold ends, f12's slot is freed, f13 keeps its slot.
  const s2 = assignSlots(s1, withHeldFrame(["/f13"], null));
  assert.deepEqual(s2, [null, "/f13"]);
  // Next refresh: f13 held, f14 takes the free slot 0.
  const s3 = assignSlots(s2, withHeldFrame(["/f14"], "/f13"));
  assert.deepEqual(s3, ["/f14", "/f13"]);
  const s4 = assignSlots(s3, withHeldFrame(["/f14"], null));
  assert.deepEqual(s4, ["/f14"]);
  for (const s of [s0, s1, s2, s3, s4]) assert.ok(s.length <= RADAR_SLOT_COUNT);
  // The frame on screen never changes slot while it is on screen.
  assert.equal(s1.indexOf("/f12"), s0.indexOf("/f12"));
  assert.equal(s2.indexOf("/f13"), s1.indexOf("/f13"));
  assert.equal(s3.indexOf("/f13"), s2.indexOf("/f13"));
  assert.equal(s4.indexOf("/f14"), s3.indexOf("/f14"));
});

test("hold sequence after playback stopped on 'now' with the frame in a later slot", () => {
  // Only trailing free slots are dropped, so the shown frame can sit in slot 2.
  const parked = [null, null, "/f12"];
  const held = assignSlots(parked, withHeldFrame(["/f13"], "/f12"));
  assert.deepEqual(held, ["/f13", null, "/f12"]);
  assert.deepEqual(assignSlots(held, ["/f13"]), ["/f13"]);
});

test("many refreshes in a row never mount more than 2 layers", () => {
  let slots = assignSlots(NO_SLOTS, ["/f0"]);
  for (let i = 1; i < 40; i += 1) {
    slots = assignSlots(slots, withHeldFrame([`/f${i}`], `/f${i - 1}`));
    assert.equal(slots.filter(Boolean).length, 2);
    slots = assignSlots(slots, [`/f${i}`]);
    assert.equal(slots.filter(Boolean).length, 1);
    assert.ok(slots.length <= 2);
  }
});

test("onlyMountedPath: the frame of the only occupied slot, else null", () => {
  assert.equal(onlyMountedPath(NO_SLOTS), null);
  assert.equal(onlyMountedPath(["/f12"]), "/f12");
  assert.equal(onlyMountedPath([null, null, "/f12"]), "/f12");
  assert.equal(onlyMountedPath(["/f12", "/f13"]), null);
  assert.equal(onlyMountedPath(assignSlots(NO_SLOTS, pathsAt(12))), null);
});

test("radarDrawnAtZoom follows Leaflet: rounded zoom against maxZoom 12", () => {
  assert.equal(radarDrawnAtZoom(12), true);
  assert.equal(radarDrawnAtZoom(12.4), true);
  assert.equal(radarDrawnAtZoom(12.5), false);
  assert.equal(radarDrawnAtZoom(13), false);
  assert.equal(radarDrawnAtZoom(3), true);
  assert.equal(radarDrawnAtZoom(undefined), true, "unknown zoom: a hold costs at worst its deadline");
  assert.equal(radarDrawnAtZoom(NaN), true);
});

test("shouldHoldRadarFrame: a refresh that brings a new frame while the window is inactive holds", () => {
  assert.equal(shouldHoldRadarFrame(refresh()), true);
  // Timeline open, paused on "now", same answer: the window is inactive.
  const f = frames(13, 0);
  const g = frames(13, 1);
  const before = assignSlots(NO_SLOTS, framesToMount(f, 12, false).map((x) => x.path));
  assert.equal(shouldHoldRadarFrame(refresh({
    shownPath: onlyMountedPath(before),
    targetPath: framesToMount(g, 12, false)[0].path,
    mountedPaths: before,
  })), true);
});

test("shouldHoldRadarFrame: each condition alone prevents the hold", () => {
  assert.equal(shouldHoldRadarFrame(refresh({ framesChanged: false })), false, "same frame list");
  assert.equal(shouldHoldRadarFrame(refresh({ targetPath: "/f12" })), false, "refresh with no new frame");
  assert.equal(shouldHoldRadarFrame(refresh({ shownPath: null, mountedPaths: [] })), false, "first load");
  assert.equal(shouldHoldRadarFrame(refresh({ targetPath: null })), false, "no frame to show");
  assert.equal(shouldHoldRadarFrame(refresh({ mountedPaths: ["/f12", "/f13"] })), false, "new frame already mounted");
  assert.equal(shouldHoldRadarFrame(refresh({ windowActive: true })), false, "playback / parked off now");
  assert.equal(shouldHoldRadarFrame(refresh({ source: "eccc" })), false, "ECCC source");
  assert.equal(shouldHoldRadarFrame(refresh({ zoom: 13 })), false, "radar not drawn above zoom 12");
  assert.equal(shouldHoldRadarFrame(refresh({ zoom: 12 })), true, "zoom 12 still draws radar");
});

test("no hold on a scrub step 11 → 12: the window turns inactive on a frame already loaded", () => {
  const f = frames();
  const scrubbing = assignSlots(NO_SLOTS, framesToMount(f, 11, true).map((x) => x.path));
  const input = {
    shownPath: f[11].path,
    targetPath: f[12].path,
    mountedPaths: scrubbing,
    windowActive: false,
    source: "rainviewer",
    zoom: 8,
  };
  assert.equal(shouldHoldRadarFrame({ ...input, framesChanged: false }), false);
  // Even on a pass that also saw a new list, f12 is mounted: no hold.
  assert.equal(shouldHoldRadarFrame({ ...input, framesChanged: true }), false);
});

test("no hold when the timeline is hidden while parked off 'now'", () => {
  // Parked on frame 5 (window active), then the bar is closed: the display
  // jumps to "now" (f12), which is not mounted. It must show at once, not
  // keep a frame 70 min old with no time label: the frame list didn't change.
  const f = frames();
  const parked = assignSlots(NO_SLOTS, framesToMount(f, 5, true).map((x) => x.path));
  assert.ok(!parked.includes(f[12].path));
  assert.equal(shouldHoldRadarFrame({
    framesChanged: false,
    shownPath: f[5].path,
    targetPath: f[12].path,
    mountedPaths: parked,
    windowActive: false,
    source: "rainviewer",
    zoom: 8,
  }), false);
});

test("keepsRadarHold: an ongoing hold ends when playback, ECCC or a zoom past the radar takes over", () => {
  const held = { held: "/f12", targetPath: "/f13", windowActive: false, source: "rainviewer", zoom: 8 };
  assert.equal(keepsRadarHold(held), true);
  assert.equal(keepsRadarHold({ ...held, held: null }), false, "no hold");
  assert.equal(keepsRadarHold({ ...held, windowActive: true }), false, "play pressed / scrubbed off now");
  assert.equal(keepsRadarHold({ ...held, source: "eccc" }), false, "switched to ECCC");
  assert.equal(keepsRadarHold({ ...held, zoom: 13 }), false, "zoomed past the radar's range");
  assert.equal(keepsRadarHold({ ...held, targetPath: "/f12" }), false, "back on the held frame");
  assert.equal(keepsRadarHold({ ...held, targetPath: null }), false, "no frame to show");
});

test("a hold cancelled by playback keeps the held frame's loaded layer in its slot", () => {
  // Hold in place ([f12, f13]); play is pressed on the new list's "now" (f13):
  // the window around it includes f12 (now index 11), which keeps slot 0.
  const g = frames(13, 1); // f1 … f13
  const holding = ["/v2/radar/f12", "/v2/radar/f13"];
  const playing = assignSlots(holding, framesToMount(g, 12, true).map((x) => x.path));
  assert.equal(playing[0], "/v2/radar/f12");
  assert.equal(playing[1], "/v2/radar/f13");
});

test("the WeatherMap passes the hold's handlers to the radar layer as a memoised variable", () => {
  // Source-level: test/rainViewerTiles.test.js and test/mapAttribution.test.js
  // cut the <RadarTileLayer> tag at its first "/>", and a new handlers object
  // per render would re-bind the Leaflet events on every render.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(
    path.join(__dirname, "..", "client", "src", "components", "WeatherMap", "index.js"),
    "utf8",
  );
  const start = src.indexOf("<RadarTileLayer");
  const tag = src.slice(start, src.indexOf("/>", start) + 2);
  const m = /eventHandlers=\{([^}]*)\}/.exec(tag);
  assert.ok(m, "eventHandlers prop not found on <RadarTileLayer>");
  assert.doesNotMatch(m[1], /=>|\{|\bfunction\b/, "no inline object or function");
  assert.match(tag, /maxZoom=\{12\}/, "the whole tag is still before the first '/>'");
  assert.match(src, /const radarHoldHandlers = useMemo\(/);
});

test("the WeatherMap wires the hold into the slots and the layer opacity", () => {
  // The helpers above are pure; these lines are what actually keep the old
  // image on screen. Without the first, the unloaded new frame's layer goes to
  // full opacity at a refresh; without the second, the new frame takes the held
  // frame's slot through setUrl. Either brings back the blank-then-refill.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(
    path.join(__dirname, "..", "client", "src", "components", "WeatherMap", "index.js"),
    "utf8",
  );
  const start = src.indexOf("<RadarTileLayer");
  const tag = src.slice(start, src.indexOf("/>", start) + 2);
  assert.match(
    tag,
    /opacity=\{path === \(radarHold \?\? /,
    "the layer shown is the held frame while a hold lasts",
  );
  assert.match(
    src,
    /assignSlots\(radarSlots, withHeldFrame\(/,
    "the held frame is fed to assignSlots so it keeps its slot",
  );
  assert.match(src, /shouldHoldRadarFrame\(\{/, "a refresh can start a hold");
  assert.match(src, /keepsRadarHold\(\{/, "an ongoing hold is re-checked every render");
  // The frame list seen is written with the slots, never in a pass that has
  // just queued a playhead snap (the design's "not updated on a skipped pass").
  const guard = src.indexOf("if (!playheadSnapPending) {");
  assert.ok(guard >= 0, "playhead-snap guard not found");
  const block = src.slice(guard, src.indexOf("}", guard));
  assert.match(block, /setRadarSlots\(nextRadarSlots\)/);
  assert.match(block, /setHeldRadarPath\(radarHold\)/);
  assert.match(block, /setRadarFramesSeen\(mapTimestamps\)/);
});
