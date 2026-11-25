// Tests for client/src/ui/shellElements.js, the registry through which the
// timing of LayoutPi's overlay shell reads the map overlays and Leaflet's
// attribution corner without DOM queries, and through which it sets the
// kept-mounted map chrome's `inert` at each chrome change without rendering
// it (the chrome presentation); guards that every overlay of the shell
// registers with it. CommonJS module, so these run the real code against
// stand-in elements. Run: `npm test`.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { OVERLAY_ATTRIBUTE, SCRUBBER_OVERLAY, LEGEND_OVERLAYS, createShellElements } = require("../client/src/ui/shellElements");
const { VIEW_STATES, overlayPresentation } = require("../client/src/ui/piShellGeometry");

const SRC_DIR = path.join(__dirname, "..", "client", "src");
const read = (rel) => fs.readFileSync(path.join(SRC_DIR, rel), "utf8");

/**
 * A stand-in element with attributes. `writes` counts the attribute changes
 * (toggleAttribute, like the DOM's, changes nothing where the attribute is
 * already as asked).
 *
 * @param {object} [attrs] - Its attributes.
 * @returns {object} the element
 */
const element = (attrs = {}) => {
  const a = new Map(Object.entries(attrs));
  const el = {
    writes: 0,
    getAttribute: (name) => (a.has(name) ? a.get(name) : null),
    hasAttribute: (name) => a.has(name),
    setAttribute: (name, value) => { el.writes += 1; a.set(name, value); },
    removeAttribute: (name) => { if (a.delete(name)) el.writes += 1; },
    toggleAttribute: (name, force) => {
      const on = force === undefined ? !a.has(name) : force;
      if (on && !a.has(name)) { el.writes += 1; a.set(name, ""); }
      if (!on && a.has(name)) { el.writes += 1; a.delete(name); }
      return on;
    },
  };
  return el;
};

test("shellElements: the overlay ref callback adds an element and its cleanup removes it (React 19: the cleanup replaces the null call)", () => {
  const reg = createShellElements();
  const chip = element({ [OVERLAY_ATTRIBUTE]: "chip" });
  const card = element({ [OVERLAY_ATTRIBUTE]: "card" });
  const cleanChip = reg.overlayRef(chip);
  const cleanCard = reg.overlayRef(card);
  assert.deepEqual(reg.overlays(), [chip, card]);
  assert.equal(typeof cleanChip, "function");
  cleanChip();
  assert.deepEqual(reg.overlays(), [card]);
  cleanCard();
  assert.deepEqual(reg.overlays(), []);
  assert.equal(reg.overlayRef(null), undefined, "a null attach (no cleanup case) changes nothing");
  // overlays() is a copy: the caller can't change the registry.
  reg.overlayRef(chip);
  reg.overlays().length = 0;
  assert.deepEqual(reg.overlays(), [chip]);
});

test("shellElements: liveScrubber is true while a registered overlay named \"scrubber\" is not inert — a scrubber that takes input", () => {
  const reg = createShellElements();
  assert.equal(reg.liveScrubber(), false, "nothing mounted (ECCC radar, or before the frame list)");
  const banner = element({ [OVERLAY_ATTRIBUTE]: "banner" });
  reg.overlayRef(banner);
  assert.equal(reg.liveScrubber(), false, "another overlay");
  const bar = element({ [OVERLAY_ATTRIBUTE]: SCRUBBER_OVERLAY, inert: "" });
  const clean = reg.overlayRef(bar);
  assert.equal(reg.liveScrubber(), false, "mounted but inert (outside MIN with the scrubber open)");
  bar.removeAttribute("inert");
  assert.equal(reg.liveScrubber(), true, "live: React updated its attribute in the commit's mutation phase");
  clean();
  assert.equal(reg.liveScrubber(), false, "unmounted");
});

test("shellElements: the attribution corner registers once per map, and a stale cleanup never clears a newer map's corner", () => {
  const reg = createShellElements();
  assert.equal(reg.attribution(), null, "before the map exists");
  const first = element();
  const cleanFirst = reg.attributionRef(first);
  assert.equal(reg.attribution(), first);
  const second = element();
  const cleanSecond = reg.attributionRef(second);
  cleanFirst();
  assert.equal(reg.attribution(), second);
  cleanSecond();
  assert.equal(reg.attribution(), null);
  assert.equal(reg.attributionRef(null), undefined);
});

test("shellElements: the ref callbacks are stable (React never re-attaches them on a re-render) and each registry is its own", () => {
  const a = createShellElements();
  const b = createShellElements();
  const { overlayRef, attributionRef } = a;
  assert.equal(a.overlayRef, overlayRef);
  assert.equal(a.attributionRef, attributionRef);
  a.overlayRef(element({ [OVERLAY_ATTRIBUTE]: "chip" }));
  assert.equal(b.overlays().length, 0);
});

test("shellElements: leaving the registry hands a legend presentation's and the view chrome's `inert` back, never the scrubber's or the banner's", () => {
  // The shell turning off under a mounted LayoutPi (defensive: the compiled
  // LayoutPi reads the shell variant once per mount): the elements stay mounted,
  // their refs go from the registry's to none, and the components render no
  // `inert`, which React, whose last render may have written none while the
  // registry set it, would never clear.
  const reg = createShellElements();
  const chip = element({ [OVERLAY_ATTRIBUTE]: "chip" });
  const raised = element({ [OVERLAY_ATTRIBUTE]: "chip-raised", inert: "" });
  const card = element({ [OVERLAY_ATTRIBUTE]: "card", inert: "" });
  const bar = element({ [OVERLAY_ATTRIBUTE]: SCRUBBER_OVERLAY, inert: "" });
  const banner = element({ [OVERLAY_ATTRIBUTE]: "banner", inert: "" });
  const focus = element();
  const cleanups = [chip, raised, card, bar, banner].map((el) => reg.overlayRef(el));
  cleanups.push(reg.viewChromeRef(focus));
  reg.present("conditions", false);
  for (const el of [chip, raised, card, focus]) assert.equal(el.hasAttribute("inert"), true, "set by the registry in the view");
  const scrubberWrites = bar.writes;
  const bannerWrites = banner.writes;
  for (const clean of cleanups) clean();
  for (const el of [chip, raised, card, focus]) assert.equal(el.hasAttribute("inert"), false, "handed back");
  assert.equal(bar.hasAttribute("inert"), true, "the scrubber's `inert` is React's");
  assert.equal(banner.hasAttribute("inert"), true, "the banner's `inert` is React's");
  assert.deepEqual([bar.writes, banner.writes], [scrubberWrites, bannerWrites]);
  assert.deepEqual(reg.overlays(), []);
});

test("shellElements: whether an overlay's `inert` is the registry's is read when it registers, not when it leaves", () => {
  // React detaches a ref before it applies the element's new props, but the
  // registry doesn't rely on that order: an overlay attribute React removes
  // in the same commit doesn't keep its `inert` stuck.
  const reg = createShellElements();
  const chip = element({ [OVERLAY_ATTRIBUTE]: "chip" });
  const clean = reg.overlayRef(chip);
  reg.present("max", false);
  assert.equal(chip.hasAttribute("inert"), true);
  chip.removeAttribute(OVERLAY_ATTRIBUTE);
  clean();
  assert.equal(chip.hasAttribute("inert"), false);
  // An element registered as the scrubber stays React's even if its
  // attribute changed meanwhile.
  const bar = element({ [OVERLAY_ATTRIBUTE]: SCRUBBER_OVERLAY, inert: "" });
  const cleanBar = reg.overlayRef(bar);
  bar.setAttribute(OVERLAY_ATTRIBUTE, "chip");
  cleanBar();
  assert.equal(bar.hasAttribute("inert"), true);
});

// ------------------------------------------------------------- wiring

test("shellElements: every map overlay of the overlay shell registers through `overlayRef`, which only that shell hands down", () => {
  // Every element carrying the overlay attribute in client/src, with the
  // ref on the same element.
  const legend = read("components/WeatherMap/RadarLegend.js");
  const timeline = read("components/WeatherMap/RadarTimeline.js");
  const banner = read("components/ambient/FloatingMiniBanner/index.js");
  const tagWith = (src, needle) => {
    const at = src.indexOf(needle);
    assert.ok(at >= 0, needle);
    const open = src.lastIndexOf("<", at);
    return src.slice(open, src.indexOf(">", at));
  };
  for (const tag of [
    tagWith(legend, "data-pi-overlay-el={overlayEl}\n      inert"),
    tagWith(legend, "data-pi-overlay-el={overlayEl} inert"),
  ]) assert.match(tag, /ref=\{overlayEl \? overlayRef : undefined\}/);
  assert.match(tagWith(timeline, 'data-pi-overlay-el={shellLive === undefined ? undefined : "scrubber"}'), /ref=\{overlayRef\}/);
  assert.match(tagWith(banner, 'data-pi-overlay-el={shellLive === undefined ? undefined : "banner"}'), /ref=\{overlayRef\}/);
  // No other JSX element in client/src carries the attribute.
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return p.endsWith(".js") ? [p] : [];
  });
  const carriers = walk(SRC_DIR).filter((f) => /data-pi-overlay-el=\{/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(SRC_DIR, f)).sort();
  assert.deepEqual(carriers, [
    "components/WeatherMap/RadarLegend.js",
    "components/WeatherMap/RadarTimeline.js",
    "components/ambient/FloatingMiniBanner/index.js",
  ]);
  // Handed down under the overlay shell only: RadarTimeline's beside
  // `shellLive`; RadarLegend takes the whole registry and its
  // `overlayRef` from it.
  const map = read("components/WeatherMap/index.js");
  assert.equal((map.match(/shellOverlays && shellElements \? shellElements\.overlayRef : undefined/g) || []).length, 1, "RadarTimeline");
  assert.match(map, /const scrubberOverlayRef = shellOverlays && shellElements \? shellElements\.overlayRef : undefined;/);
  assert.match(map, /overlayRef=\{scrubberOverlayRef\}/);
  assert.match(map, /chipMode=\{legendChipMode\}\s*shell=\{shellElements\}/);
  assert.match(legend, /const overlayRef = shell \? shell\.overlayRef : undefined;/);
  assert.match(map, /\{shellElements && <ShellAttributionCorner register=\{shellElements\.attributionRef\} \/>\}/);
  const layout = read("components/ambient/LayoutPi/index.js");
  assert.match(layout, /shellLive=\{focused\} overlayRef=\{shellElements\.overlayRef\} \/>/);
  assert.match(layout, /: focused && <FloatingMiniBanner guardTaps=\{priority\} onExpand=\{\(\) => setPiLayoutState\("mid"\)\} \/>\}/, "the grid shell's banner: no ref");
});

test("shellElements: no DOM query on a view switch's path in the shell's timing, press tint and zoom-bar code", () => {
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const rel of ["components/ambient/LayoutPi/useShellTiming.js", "components/ambient/LayoutPi/usePressTint.js", "ui/pressTint.js"]) {
    assert.doesNotMatch(code(read(rel)), /querySelector/, rel);
  }
  // ShellZoomInert looks its bar up once (after the mount, or when the bar
  // it found is gone), never in each switch's commit; it sets the bar's
  // `inert` from the registry's change signal, not from a
  // prop, so a switch doesn't render it.
  const map = read("components/WeatherMap/index.js");
  const body = map.slice(map.indexOf("const ShellZoomInert = "), map.indexOf("ShellZoomInert.propTypes"));
  // A bar found takes the chrome's `inert` at once, and the lookup runs
  // again after a language change (ZoomControl's key), so a bar rebuilt in
  // a view stays hidden.
  assert.match(body, /if \(!barRef\.current \|\| !barRef\.current\.isConnected\) \{\s*barRef\.current = map\.getContainer\(\)\.querySelector\("\.leaflet-control-zoom"\);\s*if \(barRef\.current\) barRef\.current\.toggleAttribute\("inert", shell\.viewHidden\(\)\);\s*\}/);
  assert.match(body, /\}, \[map, shell\]\);/);
  assert.match(body, /useEffect\(\(\) => \{\s*zoomBar\(\);\s*\}, \[zoomBar, lang\]\);/);
  assert.match(map, /key=\{`zoom-\$\{i18n\.language\}`\}/, "the key the `lang` prop follows");
  // Unmounted, it gives the bar back without its `inert` (the shell
  // turning off with the page running).
  assert.match(body, /useLayoutEffect\(\(\) => \{\s*const unsubscribe = shell\.subscribe\(\(\) => \{\s*const bar = zoomBar\(\);\s*if \(bar\) bar\.toggleAttribute\("inert", shell\.viewHidden\(\)\);\s*\}\);\s*return \(\) => \{\s*unsubscribe\(\);\s*if \(barRef\.current\) barRef\.current\.removeAttribute\("inert"\);\s*\};\s*\}, \[shell, zoomBar\]\);/);
  assert.equal((body.match(/querySelector/g) || []).length, 1);
});

// ------------------------------------------------- chrome presentation

test("shellElements: the chrome presentation starts in MID, LayoutPi's mount state — the chip live, nothing hidden", () => {
  const reg = createShellElements();
  assert.equal(reg.presentation(), overlayPresentation("mid", false), "the frozen MID object (a stable snapshot)");
  assert.equal(reg.presentation().legend, "chip");
  assert.equal(reg.viewHidden(), false);
  assert.deepEqual([...LEGEND_OVERLAYS.keys()], ["chip", "chip-raised", "card"]);
});

test("shellElements: present sets the legend presentations' `inert` from overlayPresentation, every state and scrubber flag", () => {
  const reg = createShellElements();
  const chip = element({ [OVERLAY_ATTRIBUTE]: "chip" });
  const raised = element({ [OVERLAY_ATTRIBUTE]: "chip-raised", inert: "" });
  const card = element({ [OVERLAY_ATTRIBUTE]: "card", inert: "" });
  for (const el of [chip, raised, card]) reg.overlayRef(el);
  const live = { chip: chip, chipRaised: raised, card };
  for (const state of ["min", "mid", ...VIEW_STATES, "mid", "min", "mid"]) {
    for (const scrubber of [true, false]) {
      reg.present(state, scrubber);
      const expected = overlayPresentation(state, scrubber).legend;
      assert.equal(reg.presentation().legend, expected, `${state} ${scrubber}`);
      for (const [name, el] of Object.entries(live)) {
        assert.equal(el.hasAttribute("inert"), name !== expected, `${state} ${scrubber}: ${name}`);
      }
    }
  }
});

test("shellElements: present leaves the scrubber and the banner to React, and hides the view chrome in the views only", () => {
  const reg = createShellElements();
  const bar = element({ [OVERLAY_ATTRIBUTE]: SCRUBBER_OVERLAY, inert: "" });
  const banner = element({ [OVERLAY_ATTRIBUTE]: "banner", inert: "" });
  const focus = element();
  reg.overlayRef(bar);
  reg.overlayRef(banner);
  const cleanFocus = reg.viewChromeRef(focus);
  for (const state of ["min", ...VIEW_STATES, "mid"]) {
    reg.present(state, true);
    assert.equal(focus.hasAttribute("inert"), VIEW_STATES.includes(state), state);
    assert.equal(reg.viewHidden(), VIEW_STATES.includes(state), state);
  }
  assert.equal(bar.writes, 0, "the scrubber's inert is React's (it renders on its own changes)");
  assert.equal(banner.writes, 0, "the banner's inert is React's");
  cleanFocus();
  reg.present("conditions", false);
  assert.equal(focus.hasAttribute("inert"), false, "an unmounted button is left alone");
  assert.equal(reg.viewChromeRef(null), undefined);
});

test("shellElements: present writes and tells nothing when neither snapshot changes, and touches only what changes", () => {
  const reg = createShellElements();
  const chip = element({ [OVERLAY_ATTRIBUTE]: "chip" });
  const card = element({ [OVERLAY_ATTRIBUTE]: "card", inert: "" });
  const focus = element();
  reg.overlayRef(chip);
  reg.overlayRef(card);
  reg.viewChromeRef(focus);
  let told = 0;
  const unsubscribe = reg.subscribe(() => { told += 1; });
  reg.present("mid", false);
  reg.present("mid", true);
  assert.equal(told, 0, "MID with or without the scrubber flag: the same presentation");
  reg.present("conditions", false);
  assert.equal(told, 1);
  assert.deepEqual([chip.writes, card.writes, focus.writes], [1, 0, 1], "the chip goes inert, the card already was");
  reg.present("alert", true);
  reg.present("ai", false);
  assert.equal(told, 1, "a view to another view changes nothing");
  assert.deepEqual([chip.writes, card.writes, focus.writes], [1, 0, 1]);
  reg.present("mid", false);
  assert.equal(told, 2);
  unsubscribe();
  reg.present("min", false);
  assert.equal(told, 2, "unsubscribed");
});

test("shellElements: a subscriber reads the new snapshots when told, after the registered elements are set", () => {
  const reg = createShellElements();
  const chip = element({ [OVERLAY_ATTRIBUTE]: "chip" });
  reg.overlayRef(chip);
  const seen = [];
  reg.subscribe(() => seen.push([reg.presentation().legend, reg.viewHidden(), chip.hasAttribute("inert")]));
  reg.present("min", true);
  reg.present("max", false);
  reg.present("mid", false);
  assert.deepEqual(seen, [["chipRaised", false, true], ["none", true, true], ["chip", false, false]]);
  // A listener that unsubscribes while being told doesn't stop the others.
  const reg2 = createShellElements();
  const calls = [];
  const off = reg2.subscribe(() => { calls.push("a"); off(); });
  reg2.subscribe(() => calls.push("b"));
  reg2.present("min", false);
  reg2.present("mid", false);
  assert.deepEqual(calls, ["a", "b", "b"]);
});

test("shellElements: the components read the presentation in render and subscribe only while their surface is open", () => {
  // RadarLegend: subscribed only while its detail sheet is open.
  const legend = read("components/WeatherMap/RadarLegend.js");
  assert.match(legend, /useSyncExternalStore\(\s*shell && overlayOpen \? shell\.subscribe : subscribeNothing,/);
  // RadarFocusControl: only while its toast is pending; its button
  // registers as view chrome.
  const focus = read("components/WeatherMap/RadarFocusControl.js");
  assert.match(focus, /useSyncExternalStore\(\s*shell && toast != null \? shell\.subscribe : subscribeNothing,/);
  assert.match(focus, /ref=\{shell \? shell\.viewChromeRef : undefined\}/);
  // Both getSnapshot functions are stable (the registry's, or a module
  // constant), and the no-shell reads are constants.
  assert.match(legend, /const readNoShell = \(\) => NO_SHELL_PRESENTATION;/);
  assert.match(focus, /const readNotHidden = \(\) => false;/);
  // The shell's timing presents each chrome change in its commit.
  const timing = read("components/ambient/LayoutPi/useShellTiming.js");
  assert.equal((timing.match(/shellElements\.present\(/g) || []).length, 1);
  assert.match(timing, /shellElements\.present\(chromeState, scrubberOpen\);\s*\}, \[active, chromeState, scrubberOpen, dockCellRef, shellElements\]\);/);
});
