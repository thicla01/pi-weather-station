// Regression tests for the radar frame window in
// `client/src/ui/radarFrameStack.js` — which RainViewer frames keep a
// mounted TileLayer while the timeline plays or scrubs, and which layer
// slot each one uses. The module is
// CommonJS so these tests exercise the real code. Run: `npm test`.

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
