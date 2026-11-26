// Tests for the style warm-up of the alert view's switch under LayoutPi's
// overlay shell, in `client/src/ui/styleWarmup.js`: one synchronous task
// that writes what the switch's commits write (the list a MutationObserver
// recorded on a production bundle), forces style after each step by a
// non-layout read, then puts every attribute back and forces style once
// more — bracketed by two user-timing marks; nothing when something is in
// the way (not in MID, a warm frame or a switch under way, no alert
// mounted, the focus where the opening makes it inert). The module is
// CommonJS so these tests run the real task against stand-in elements; the
// scheduling is pinned in test/sheetWarmup.test.js and the wiring in
// test/piShellGeometry.test.js. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  STYLE_WARM_STATE,
  STYLE_WARM_TOKEN,
  STYLE_WARM_START_MARK,
  STYLE_WARM_END_MARK,
  STYLE_FORCE_PROPERTY,
  VIEW_SWITCH_KIND,
  ALERT_SWITCH_STEPS,
  styleWarmupBlocker,
  runStyleWarmup,
  createStyleWarmup,
  FONT_DONE_EVENTS,
  fontGateOpen,
  whenFontGateOpens,
} = require("../client/src/ui/styleWarmup");

/**
 * A stand-in element: attributes in a Map, every write logged on a shared
 * journal (`<name> @attr=value` / `<name> -attr`), children for the root.
 *
 * @param {string} name - Its name in the journal.
 * @param {object} journal - The shared journal ({ log: string[] }).
 * @param {object} [attrs] - Its attributes at the start.
 * @returns {object} the element
 */
const element = (name, journal, attrs = {}) => {
  const map = new Map(Object.entries(attrs));
  const el = {
    name,
    children: [],
    parent: null,
    className: "",
    firstElementChild: null,
    getAttribute: (k) => (map.has(k) ? map.get(k) : null),
    hasAttribute: (k) => map.has(k),
    setAttribute: (k, v) => {
      map.set(k, String(v));
      journal.log.push(`${name} @${k}=${v}`);
    },
    removeAttribute: (k) => {
      map.delete(k);
      journal.log.push(`${name} -${k}`);
    },
    attrs: () => Object.fromEntries(map),
    contains: (other) => other === el || el.children.includes(other),
    insertBefore: (child, ref) => {
      const i = el.children.indexOf(ref);
      el.children.splice(i < 0 ? el.children.length : i, 0, child);
      child.parent = el;
      journal.log.push(`${name} +child ${child.name}${ref ? ` before ${ref.name}` : ""}`);
    },
    remove: () => {
      const p = el.parent;
      if (!p) return;
      p.children.splice(p.children.indexOf(el), 1);
      el.parent = null;
      journal.log.push(`${p.name} -child ${name}`);
    },
  };
  return el;
};

/**
 * The shell at rest in MID, as it stands before an opening.
 *
 * @param {object} [o] - Options.
 * @param {boolean} [o.alertMounted] - Content at the alert host's top.
 * @returns {object} the elements, the journal and the task's options
 */
const shell = ({ alertMounted = true } = {}) => {
  const journal = { log: [] };
  const root = element("root", journal, { "data-pi-state": "mid", "data-pi-shell": "d1", "data-pi-form": "1", "data-pi-map": "mid", "data-pi-switch": "slide", "data-pi-warmed": "conditions alert ai max" });
  const dockShield = element("dockShield", journal, { "data-pi-dock-shield": "", "data-active": "false" });
  root.children.push(dockShield);
  dockShield.parent = root;
  const e = {
    root,
    rail: element("rail", journal),
    sheet: element("sheet", journal, { inert: "" }),
    dockCell: element("dockCell", journal, { "data-pi-dock-cell": "" }),
    dockShield,
    dockGuard: element("dockGuard", journal, { "data-pi-dock-guard": "", "data-active": "false" }),
    alertHost: element("alertHost", journal),
    viewChrome: [element("focusBtn", journal)],
    zoomBar: element("zoomBar", journal),
    shieldClassName: "LayoutPi-styles__shield--abcde",
  };
  if (alertMounted) e.alertHost.firstElementChild = element("alertView", journal);
  const marks = [];
  const forced = [];
  const created = [];
  let doneAt = null;
  const opts = {
    elements: e,
    createElement: (tag) => {
      const el = element(`stand-in ${tag}`, journal);
      created.push(el);
      return el;
    },
    activeElement: null,
    forceStyle: (el) => {
      forced.push({ el: el.name, at: journal.log.length });
      journal.log.push("FORCE");
    },
    mark: (name) => {
      marks.push(name);
      journal.log.push(`MARK ${name}`);
    },
    done: () => {
      doneAt = journal.log.length;
      journal.log.push("DONE");
    },
  };
  const snapshot = () => Object.fromEntries([e.root, e.rail, e.sheet, e.dockCell, e.dockShield, e.dockGuard, e.alertHost, ...e.viewChrome, e.zoomBar].map((x) => [x.name, x.attrs()]));
  return { e, journal, marks, forced, created, opts, snapshot, doneAt: () => doneAt };
};

test("styleWarmup: constants — the alert's switch, the « style » token, the two marks, a non-layout read (visibility), the switch kind « view »", () => {
  assert.equal(STYLE_WARM_STATE, "alert");
  assert.equal(STYLE_WARM_TOKEN, "style");
  assert.equal(STYLE_WARM_START_MARK, "pi-k6-start");
  assert.equal(STYLE_WARM_END_MARK, "pi-k6-end");
  // Blink's getComputedStyle brings style and the layout tree up to date for a property that is not
  // layout-dependent, and runs a layout only for the layout-dependent ones (transform, width…).
  assert.equal(STYLE_FORCE_PROPERTY, "visibility");
  assert.equal(VIEW_SWITCH_KIND, "view");
});

test("styleWarmup: the steps are the recording — the opening's commit (11 writes), then the close's commit (11), in the recorded order", () => {
  // A MutationObserver on the whole document around a real opening and closing of the alert view on a production
  // bundle, the click's task each time.
  const text = ALERT_SWITCH_STEPS.map((s) => [s.name, s.writes.map(([k, a, v]) => (k === "shield" ? "shield +" : `${k} @${a}=${v === null ? "(removed)" : JSON.stringify(v)}`))]);
  assert.deepEqual(text, [
    ["open", ['rail @inert=""', "shield +", "sheet @inert=(removed)", 'root @data-pi-state="alert"', 'root @data-pi-switch="view"', 'dockCell @inert=""', 'viewChrome @inert=""', 'zoomBar @inert=""', 'root @data-pi-moving="true"', 'dockShield @data-active="false"', 'dockGuard @data-active="false"']],
    ["close", ["rail @inert=(removed)", 'sheet @inert=""', 'root @data-pi-state="mid"', 'root @data-pi-map="mid"', 'dockGuard @data-active="false"', "dockCell @inert=(removed)", "viewChrome @inert=(removed)", "zoomBar @inert=(removed)", 'root @data-pi-moving="true"', 'dockShield @data-active="false"', 'dockGuard @data-active="false"']],
  ]);
  for (const s of ALERT_SWITCH_STEPS) assert.ok(Object.isFrozen(s) && Object.isFrozen(s.writes));
});

test("styleWarmup: the task — between its two marks, each step's writes then one forced read on the root, then everything put back and read once more; nothing left set", () => {
  const s = shell();
  const before = s.snapshot();
  const r = runStyleWarmup(s.opts);
  assert.deepEqual(r, { ran: true, why: null, steps: ["open", "close", "restore"], restored: 2 });
  assert.deepEqual(s.marks, ["pi-k6-start", "pi-k6-end"]);
  assert.equal(s.journal.log[0], "MARK pi-k6-start");
  assert.equal(s.journal.log[s.journal.log.length - 1], "MARK pi-k6-end");
  assert.deepEqual(s.forced.map((f) => f.el), ["root", "root", "root"], "three reads, each on the root");
  // The journal, step by step.
  const log = s.journal.log.slice(1, -1);
  const cut = log.reduce((acc, l, i) => (l === "FORCE" ? [...acc, i] : acc), []);
  const [openW, closeW, restoreW] = [log.slice(0, cut[0]), log.slice(cut[0] + 1, cut[1]), log.slice(cut[1] + 1, cut[2])];
  assert.deepEqual(openW, ["rail @inert=", "stand-in div @aria-hidden=true", "root +child stand-in div before dockShield", "sheet -inert", "root @data-pi-state=alert", "root @data-pi-switch=view", "dockCell @inert=", "focusBtn @inert=", "zoomBar @inert=", "root @data-pi-moving=true", "dockShield @data-active=false", "dockGuard @data-active=false"]);
  assert.deepEqual(closeW, ["rail -inert", "sheet @inert=", "root @data-pi-state=mid", "root @data-pi-map=mid", "dockGuard @data-active=false", "dockCell -inert", "focusBtn -inert", "zoomBar -inert", "root @data-pi-moving=true", "dockShield @data-active=false", "dockGuard @data-active=false"]);
  // The restore: the stand-in shield out, then each attribute that differs from its value before the task (as
  // read at its first write) put back — data-pi-switch and data-pi-moving here; an unchanged one not rewritten.
  // The close's writes already gave the rest back every inert, data-active and data-pi-map (posed on the opening's
  // commit, its data-pi-map write sets the "mid" the root holds): only data-pi-switch and data-pi-moving differ.
  assert.deepEqual(restoreW, ["root -child stand-in div", "root @data-pi-switch=slide", "root -data-pi-moving"]);
  assert.equal(restoreW.filter((l) => !/^root -child/.test(l)).length, r.restored);
  assert.deepEqual(s.snapshot(), before, "every attribute as it was");
  assert.equal(s.e.root.children.length, 1, "the stand-in shield gone");
  assert.equal(s.created.length, 1);
  assert.equal(s.created[0].className, "LayoutPi-styles__shield--abcde");
  assert.deepEqual(s.created[0].attrs(), { "aria-hidden": "true" });
  // done (the scheduler's token) after the last read, before the end mark.
  assert.ok(s.doneAt() > s.forced[2].at && s.doneAt() < s.journal.log.length - 1);
});

test("styleWarmup: an attribute the task finds already at its restored value is not rewritten; one it found absent is removed", () => {
  const s = shell();
  s.e.root.setAttribute("data-pi-switch", "view");
  s.journal.log.length = 0;
  const before = s.snapshot();
  const r = runStyleWarmup(s.opts);
  assert.equal(r.ran, true);
  assert.deepEqual(s.snapshot(), before);
  const restore = s.journal.log.slice(s.journal.log.lastIndexOf("FORCE", s.journal.log.length - 4) + 1);
  assert.ok(!restore.some((l) => /data-pi-switch/.test(l)), "data-pi-switch was already « view »: not written back");
  assert.ok(restore.includes("root -data-pi-moving"));
});

test("styleWarmup: the blockers — not in MID, a warm frame, a switch under way, no alert mounted, the focus in what goes inert, an element missing: nothing written, read or marked", () => {
  const cases = [
    ["not in MID", (s) => s.e.root.setAttribute("data-pi-state", "min")],
    ["a warm frame or a switch under way", (s) => s.e.root.setAttribute("data-pi-warm", "alert")],
    ["a warm frame or a switch under way", (s) => s.e.root.setAttribute("data-pi-moving", "true")],
    ["the focus is in what the opening makes inert", (s) => { s.opts.activeElement = s.e.viewChrome[0]; }],
    ["the focus is in what the opening makes inert", (s) => { s.opts.activeElement = s.e.zoomBar; }],
    ["the focus is in what the opening makes inert", (s) => { const b = { name: "dockButton" }; s.e.dockCell.children.push(b); s.opts.activeElement = b; }],
    ["an element is not mounted", (s) => { s.e.rail = null; }],
    ["no shield class", (s) => { s.e.shieldClassName = ""; }],
  ];
  for (const [why, arrange] of cases) {
    const s = shell();
    arrange(s);
    s.journal.log.length = 0;
    const r = runStyleWarmup(s.opts);
    assert.deepEqual(r, { ran: false, why, steps: [], restored: 0 }, why);
    assert.deepEqual(s.journal.log, [], `${why}: nothing written, forced or marked`);
  }
  const empty = shell({ alertMounted: false });
  assert.equal(runStyleWarmup(empty.opts).why, "no alert mounted");
  // The focus elsewhere (the body, or a control outside what goes inert) does not block.
  const ok = shell();
  ok.opts.activeElement = { name: "body" };
  assert.equal(styleWarmupBlocker(ok.e, ok.opts.activeElement), null);
});

test("styleWarmup: createStyleWarmup — the alert's step and token; the elements, the document and the window read when it runs; the read is getComputedStyle(root).visibility", () => {
  const s = shell();
  const reads = [];
  const marks = [];
  let elementsCalls = 0;
  const step = createStyleWarmup({
    elements: () => {
      elementsCalls += 1;
      return s.e;
    },
    doc: { activeElement: null, createElement: s.opts.createElement },
    view: { getComputedStyle: (el) => ({ getPropertyValue: (p) => { reads.push(`${el.name}.${p}`); return "visible"; } }) },
    mark: (n) => marks.push(n),
  });
  assert.equal(step.state, "alert");
  assert.equal(step.token, "style");
  assert.equal(elementsCalls, 0, "nothing read before it runs");
  let done = 0;
  const r = step.run(() => { done += 1; });
  assert.equal(r.ran, true);
  assert.equal(elementsCalls, 1);
  assert.equal(done, 1);
  assert.deepEqual(reads, ["root.visibility", "root.visibility", "root.visibility"]);
  assert.deepEqual(marks, ["pi-k6-start", "pi-k6-end"]);
});

/**
 * A stand-in FontFaceSet for the font gate: status as set, `ready` a promise the test settles (or rejects),
 * check() and the faces' iteration counted — forEach and for…of alike (the gate reads neither) —, every
 * property read logged (symbols too), and the loadingdone / loadingerror listeners counted.
 *
 * @param {object} [o] - Options.
 * @param {string} [o.status] - "loading" or "loaded" (FontFaceSetLoadStatus), or another value for the defensive case.
 * @param {object[]} [o.faces] - The set's faces (forEach, for…of).
 * @returns {object} the set (a proxy logging its reads in `reads`), with settle() / reject() and its counters
 */
const fontSet = ({ status = "loading", faces = [] } = {}) => {
  let settle = null;
  let reject = null;
  const listeners = new Map();
  const reads = [];
  const set = {
    status,
    faces,
    forEach: (fn) => { set.iterated += 1; for (const f of set.faces) fn(f); },
    [Symbol.iterator]: function* faceIterator() { set.iterated += 1; yield* set.faces; },
    iterated: 0,
    asked: [],
    ready: new Promise((resolve, no) => { settle = resolve; reject = no; }),
    check: (font) => { set.asked.push(font); return true; },
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn]),
    removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)),
    dispatch: (type) => { for (const fn of [...(listeners.get(type) || [])]) fn(); },
    listening: () => [...listeners.values()].reduce((n, l) => n + l.length, 0),
    settle: () => settle(),
    reject: () => reject(new Error("ready rejected")),
  };
  // The test's own instruments are not FontFaceSet's: their reads are not logged.
  const instruments = new Set(["reads", "iterated", "asked", "faces", "listening", "dispatch", "settle", "reject"]);
  const proxy = new Proxy(set, { get: (t, k) => { if (!instruments.has(k)) reads.push(typeof k === "symbol" ? k.toString() : k); return t[k]; } });
  set.reads = reads;
  return proxy;
};

/**
 * A stand-in FontFace: family, weight and status as given, and its `loaded` promise the test settles (land / fail).
 *
 * @param {string} family - FontFace.family.
 * @param {string} weight - FontFace.weight.
 * @param {string} [status] - FontFace.status.
 * @returns {object} the face
 */
const face = (family, weight, status = "loading") => {
  let ok = null;
  let ko = null;
  const f = { family, weight, status, loaded: new Promise((resolve, reject) => { ok = resolve; ko = reject; }) };
  f.loaded.catch(() => {});
  f.land = () => { f.status = "loaded"; ok(f); };
  f.fail = () => { f.status = "error"; ko(new Error("network")); };
  return f;
};

/** Lets the microtask queue run (a promise's then). */
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("styleWarmup: font gate — the round ends on loadingdone or loadingerror; no face-specific check is exported", () => {
  assert.deepEqual(FONT_DONE_EVENTS, ["loadingdone", "loadingerror"]);
  assert.ok(Object.isFrozen(FONT_DONE_EVENTS));
  const mod = require("../client/src/ui/styleWarmup");
  for (const gone of ["STYLE_WARM_FONT", "STYLE_WARM_FACE", "isWarmFace", "loadingWarmFaces"]) assert.equal(mod[gone], undefined, gone);
});

test("styleWarmup: font gate — fontGateOpen: open only when the set is « loaded »; shut while any face loads, Geist 700 in or not; it reads the status alone (no check(), no faces, no ready); no set → open", () => {
  const loading = fontSet({ status: "loading", faces: [face('"Geist"', "700", "loaded"), face('"Geist Mono"', "500")] });
  assert.equal(fontGateOpen(loading), false, "Geist 700 in, another face still loading: shut");
  assert.deepEqual(loading.reads, ["status"], "the status read, nothing else");
  assert.deepEqual(loading.asked, [], "check() never asked");
  assert.equal(loading.iterated, 0, "the faces never read");
  const loaded = fontSet({ status: "loaded" });
  assert.equal(fontGateOpen(loaded), true, "nothing pending (a face never requested, or failed): open");
  assert.deepEqual(loaded.reads, ["status"]);
  assert.equal(fontGateOpen(fontSet({ status: "unloaded" })), false, "defensive: a value outside FontFaceSetLoadStatus is not « loaded », shut");
  assert.equal(fontGateOpen(null), true);
  assert.equal(fontGateOpen(undefined), true);
});

test("styleWarmup: font gate — whenFontGateOpens: once, at ready's resolution or the set's loadingdone / loadingerror, whichever first; its listeners then removed; cancelled, never", async () => {
  const a = fontSet();
  let calls = 0;
  whenFontGateOpens(a, () => { calls += 1; });
  assert.equal(a.listening(), 2, "loadingdone and loadingerror heard");
  a.settle();
  await tick();
  assert.equal(calls, 1, "at ready's resolution");
  assert.equal(a.listening(), 0, "the listeners removed");
  a.dispatch("loadingdone");
  assert.equal(calls, 1, "once");

  const b = fontSet();
  let bCalls = 0;
  whenFontGateOpens(b, () => { bCalls += 1; });
  b.dispatch("loadingerror");
  assert.equal(bCalls, 1, "at the set's loadingerror");
  b.settle();
  await tick();
  assert.equal(bCalls, 1, "ready afterwards: not again");

  const c = fontSet();
  let cCalls = 0;
  const cancel = whenFontGateOpens(c, () => { cCalls += 1; });
  cancel();
  assert.equal(c.listening(), 0);
  c.settle();
  c.dispatch("loadingdone");
  await tick();
  assert.equal(cCalls, 0, "cancelled: never");

  let nCalls = 0;
  const none = whenFontGateOpens(null, () => { nCalls += 1; });
  none();
  await tick();
  assert.equal(nCalls, 0, "no set: nothing to wait on, nothing called");
});

test("styleWarmup: font gate — a ready promise seen resolved is not waited on again (no microtask loop): the next wait takes the set's events only", async () => {
  const s = fontSet();
  let first = 0;
  whenFontGateOpens(s, () => { first += 1; });
  s.settle();
  await tick();
  assert.equal(first, 1);
  // The gate still shut (another round started without a new promise): the same resolved ready is not used again.
  let second = 0;
  whenFontGateOpens(s, () => { second += 1; });
  await tick();
  await tick();
  assert.equal(second, 0, "not called back by the settled promise");
  s.dispatch("loadingdone");
  assert.equal(second, 1, "the next round's loadingdone");
});

test("styleWarmup: font gate — the wait watches no face: Geist 700 landing or another face failing while the round goes on wakes nothing (no check(), no faces read); the round's end does", async () => {
  const g700 = face('"Geist"', "700");
  const mono = face('"Geist Mono"', "500");
  const set = fontSet({ status: "loading", faces: [g700, mono] });
  let woke = 0;
  whenFontGateOpens(set, () => { woke += 1; });
  assert.equal(set.iterated, 0, "the faces never read");
  assert.deepEqual(set.reads.filter((k) => k !== "addEventListener"), ["ready"], "ready read once, then the set's events");
  g700.land();
  await tick();
  assert.equal(woke, 0, "Geist 700 in, Geist Mono still loading: no wake-up");
  assert.equal(fontGateOpen(set), false, "and the gate still shut");
  mono.fail();
  await tick();
  assert.equal(woke, 0, "a face's own failure: no wake-up either");
  set.status = "loaded";
  set.dispatch("loadingdone");
  assert.equal(woke, 1, "the round's loadingdone");
  assert.equal(fontGateOpen(set), true, "no face pending: open");
  assert.deepEqual(set.asked, [], "check() never asked");
});

test("styleWarmup: font gate — a wait cancelled before ready settles does not spoil the next wait on the same ready: it wakes at ready's resolution, no event needed", async () => {
  const s = fontSet();
  const cancel = whenFontGateOpens(s, () => {});
  cancel();
  let woke = 0;
  whenFontGateOpens(s, () => { woke += 1; });
  s.settle();
  await tick();
  assert.equal(woke, 1, "the same pending ready, a new wait: woken by it");
});

test("styleWarmup: font gate — ready rejected is taken as settled: one wake-up, the listeners removed, and that ready not waited on again", async () => {
  const s = fontSet();
  let woke = 0;
  whenFontGateOpens(s, () => { woke += 1; });
  s.reject();
  await tick();
  assert.equal(woke, 1);
  assert.equal(s.listening(), 0);
  let again = 0;
  whenFontGateOpens(s, () => { again += 1; });
  await tick();
  assert.equal(again, 0, "the rejected ready not used again");
  s.dispatch("loadingerror");
  assert.equal(again, 1);
});

test("styleWarmup: font gate — the gate reads the set it is given and nothing else: the document's font set, installed as globalThis.document.fonts, is read only through createStyleWarmup's default document", () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "document");
  const global = fontSet({ status: "loading" });
  try {
    Object.defineProperty(globalThis, "document", { value: { fonts: global, activeElement: null }, configurable: true, writable: true });
    const given = fontSet({ status: "loaded" });
    assert.equal(fontGateOpen(given), true);
    assert.deepEqual(global.reads, [], "fontGateOpen(set): the document's set never read");
    assert.deepEqual(global.asked, [], "and never asked check()");
    const step = createStyleWarmup({ elements: () => ({}), view: {}, mark: () => {} });
    assert.equal(step.gate.open(), false, "the default document: its set read, still loading");
    assert.deepEqual(global.reads, ["status"], "its status alone");
    assert.deepEqual(global.asked, [], "no check()");
  } finally {
    if (prior) Object.defineProperty(globalThis, "document", prior);
    else delete globalThis.document;
  }
});

test("styleWarmup: font gate — createStyleWarmup's gate reads the document's font set each time it is asked; whenOpen waits on it; no document fonts → open", async () => {
  const s = shell();
  const doc = { activeElement: null, createElement: s.opts.createElement, fonts: fontSet({ status: "loading" }) };
  const step = createStyleWarmup({
    elements: () => s.e,
    doc,
    view: { getComputedStyle: () => ({ getPropertyValue: () => "visible" }) },
    mark: () => {},
  });
  assert.equal(step.gate.open(), false, "a face pending");
  doc.fonts.status = "loaded";
  assert.equal(step.gate.open(), true, "read again: nothing pending");
  doc.fonts = fontSet({ status: "loading" });
  assert.equal(step.gate.open(), false, "a new set read at the call (the old one would answer open)");
  const waiting = fontSet();
  doc.fonts = waiting;
  let opened = 0;
  step.gate.whenOpen(() => { opened += 1; });
  waiting.dispatch("loadingdone");
  assert.equal(opened, 1);
  const bare = createStyleWarmup({ elements: () => s.e, doc: { activeElement: null, createElement: s.opts.createElement }, view: {}, mark: () => {} });
  assert.equal(bare.gate.open(), true, "no fonts on the document: open");
  assert.equal(step.run(() => {}).ran, true, "the task itself unchanged");
});
