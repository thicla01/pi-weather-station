// Regression tests for how GET /api/display-scale finds the scale APPLIED to
// the running kiosk (`applied`), via the `__test` helpers of
// displayScaleCtrl: findKioskProcesses, chromiumScaleFromArgs and
// parseAppliedFromPs.
//
// Run: `npm test` (Node's built-in `node --test` runner, no deps).
//
// The original matcher (`--kiosk` + /chrom/i anywhere on the line) missed
// every Chromium-family kiosk whose binary isn't spelled "chrom…" — Brave
// (/opt/brave.com/brave/brave) and Edge (/opt/microsoft/msedge/msedge) — so
// `applied` came back null and the Settings UI could never tell whether a
// relaunch was needed. These fixtures are shaped like real `ps -eo args`
// output on each browser start-server can launch: the main process with
// start-server's exact flags, plus the crashpad handler and the
// zygote/GPU/utility/renderer helpers that share its install dir.
//
// Firefox is the deliberate exception: its scale is a profile pref
// (user.js `layout.css.devicePixelRatio`), not a flag, so `applied` stays
// null — "unknown", never a false "1".

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { __test } = require("../server/displayScaleCtrl");
const { findKioskProcesses, chromiumScaleFromArgs, parseAppliedFromPs } = __test;

const KIOSK_URL = "https://localhost:8443";

// Unrelated processes every listing carries (ps prints a COMMAND header).
const SYSTEM_NOISE = [
  "COMMAND",
  "/sbin/init splash",
  "[kthreadd]",
  "[kworker/u8:2-events_unbound]",
  "/usr/lib/systemd/systemd --user",
  "/usr/bin/labwc -m",
  "/usr/bin/wf-panel-pi",
  "node server/index.js",
  "/bin/bash /home/pi/.local/bin/start-server",
];

/**
 * The argv start-server gives a Chromium-family kiosk on Wayland (section 3
 * of deploy/start-server), with the scale flag only when one is applied.
 *
 * @param {string} exe argv[0] as `ps` shows it
 * @param {string|null} scale applied factor, or null for no flag
 * @param {string[]} [wrapperFlags] flags a distro wrapper prepends
 *   (Raspberry Pi OS / Debian CHROMIUM_FLAGS)
 * @returns {string} one `ps -eo args` line
 */
const chromiumMainLine = (exe, scale, wrapperFlags = []) => [
  exe, ...wrapperFlags,
  "--kiosk", "--noerrdialogs", "--disable-infobars", "--no-first-run",
  "--ignore-certificate-errors", "--touch-events=enabled",
  "--ozone-platform=wayland", "--enable-features=OverlayScrollbar", "--start-maximized",
  ...(scale ? [`--force-device-scale-factor=${scale}`] : []),
  KIOSK_URL,
].join(" ");

/**
 * A full Chromium-family process tree as `ps -eo args` lists it: system
 * noise, the main kiosk process, then its crashpad handler and helpers.
 *
 * @param {object} o tree description
 * @param {string} o.main argv[0] of the main process as `ps` shows it
 * @param {string} o.bin the real browser binary (what helpers run)
 * @param {string} o.crashpad the crashpad handler binary
 * @param {string} o.profile the profile dir (crash database lives under it)
 * @param {string} o.prod the crashpad `prod` annotation
 * @param {string|null} o.scale applied factor, or null for no flag
 * @param {string[]} [o.wrapperFlags] distro wrapper flags on the main line
 * @returns {string} the listing
 */
const chromiumTree = ({ main, bin, crashpad, profile, prod, scale, wrapperFlags }) => {
  const scaleArg = scale ? ` --force-device-scale-factor=${scale}` : "";
  return [
    ...SYSTEM_NOISE,
    chromiumMainLine(main, scale, wrapperFlags),
    `${crashpad} --monitor-self --monitor-self-annotation=ptype=crashpad-handler `
      + `--database=${profile}/Crash Reports --annotation=channel= `
      + "--annotation=lsb-release=Debian GNU/Linux 13 (trixie) --annotation=plat=Linux "
      + `--annotation=prod=${prod} --annotation=ver=141.0.7390.65 --initial-client-fd=4 --shared-client-connection`,
    `${bin} --type=zygote --no-zygote-sandbox --crashpad-handler-pid=1187 --enable-crash-reporter=, --change-stack-guard-on-fork=enable`,
    `${bin} --type=zygote --crashpad-handler-pid=1187 --enable-crash-reporter=, --change-stack-guard-on-fork=enable`,
    `${bin} --type=gpu-process --ozone-platform=wayland --crashpad-handler-pid=1187 --enable-crash-reporter=, `
      + "--change-stack-guard-on-fork=enable --gpu-preferences=UAAAAAAAAAAgAAAEAAAAAAAAAAAAAAAAAABgAAEAAAA4AAAAAAAAAA== "
      + "--shared-files --field-trial-handle=3,i,4386519736117466133,1517301424934776497,262144 --variations-seed-version",
    `${bin} --type=utility --utility-sub-type=network.mojom.NetworkService --lang=en-US --service-sandbox-type=none `
      + "--ignore-certificate-errors --crashpad-handler-pid=1187 --enable-crash-reporter=, --change-stack-guard-on-fork=enable "
      + "--shared-files=v8_context_snapshot_data:100 --field-trial-handle=3,i,4386519736117466133,1517301424934776497,262144",
    `${bin} --type=renderer --crashpad-handler-pid=1187 --enable-crash-reporter=, --touch-events=enabled${scaleArg} `
      + "--change-stack-guard-on-fork=enable --lang=en-US --num-raster-threads=2 --enable-main-frame-before-activation "
      + "--renderer-client-id=7 --time-ticks-at-unix-epoch=-1728460800000000 --launch-time-ticks=5231874 "
      + "--shared-files=v8_context_snapshot_data:100 --field-trial-handle=3,i,4386519736117466133,1517301424934776497,262144",
  ].join("\n");
};

// One entry per Chromium-family browser start-server can launch, with the
// real install layout of each.
const BROWSERS = {
  "Raspberry Pi OS / Debian chromium": {
    main: "/usr/lib/chromium/chromium",
    bin: "/usr/lib/chromium/chromium",
    crashpad: "/usr/lib/chromium/chrome_crashpad_handler",
    profile: "/home/pi/.config/chromium",
    prod: "Chrome_Linux",
    // CHROMIUM_FLAGS the distro wrapper (/usr/bin/chromium) prepends.
    wrapperFlags: [
      "--show-component-extension-options", "--enable-gpu-rasterization", "--no-default-browser-check",
      "--disable-pings", "--media-router=0", "--enable-remote-extensions", "--load-extension=",
    ],
  },
  "Raspberry Pi OS Bullseye chromium-browser (armhf)": {
    main: "/usr/lib/chromium-browser/chromium-browser-v7",
    bin: "/usr/lib/chromium-browser/chromium-browser-v7",
    crashpad: "/usr/lib/chromium-browser/chrome_crashpad_handler",
    profile: "/home/pi/.config/chromium",
    prod: "Chrome_Linux",
    wrapperFlags: ["--enable-pinch", "--enable-crashpad"],
  },
  "Ubuntu chromium snap": {
    main: "/snap/chromium/3235/usr/lib/chromium-browser/chrome",
    bin: "/snap/chromium/3235/usr/lib/chromium-browser/chrome",
    crashpad: "/snap/chromium/3235/usr/lib/chromium-browser/chrome_crashpad_handler",
    profile: "/home/pi/snap/chromium/common/chromium",
    prod: "Chrome_Linux",
    wrapperFlags: ["--password-store=basic"],
  },
  "Google Chrome": {
    main: "/opt/google/chrome/chrome",
    bin: "/opt/google/chrome/chrome",
    crashpad: "/opt/google/chrome/chrome_crashpad_handler",
    profile: "/home/pi/.config/google-chrome",
    prod: "Chrome_Linux",
  },
  "Google Chrome titled by its wrapper's exec -a \"$0\"": {
    main: "/usr/bin/google-chrome-stable",
    bin: "/opt/google/chrome/chrome",
    crashpad: "/opt/google/chrome/chrome_crashpad_handler",
    profile: "/home/pi/.config/google-chrome",
    prod: "Chrome_Linux",
  },
  "Microsoft Edge": {
    main: "/opt/microsoft/msedge/msedge",
    bin: "/opt/microsoft/msedge/msedge",
    crashpad: "/opt/microsoft/msedge/msedge_crashpad_handler",
    profile: "/home/pi/.config/microsoft-edge",
    prod: "Edge_Linux",
  },
  "Microsoft Edge titled by its wrapper's exec -a \"$0\"": {
    main: "/usr/bin/microsoft-edge-stable",
    bin: "/opt/microsoft/msedge/msedge",
    crashpad: "/opt/microsoft/msedge/msedge_crashpad_handler",
    profile: "/home/pi/.config/microsoft-edge",
    prod: "Edge_Linux",
  },
  "Brave": {
    main: "/opt/brave.com/brave/brave",
    bin: "/opt/brave.com/brave/brave",
    // Brave ships Chromium's crashpad binary under its own install dir.
    crashpad: "/opt/brave.com/brave/chrome_crashpad_handler",
    profile: "/home/pi/.config/BraveSoftware/Brave-Browser",
    prod: "Brave_Linux",
  },
  "Brave titled by its wrapper's exec -a \"$0\"": {
    main: "/usr/bin/brave-browser",
    bin: "/opt/brave.com/brave/brave",
    crashpad: "/opt/brave.com/brave/chrome_crashpad_handler",
    profile: "/home/pi/.config/BraveSoftware/Brave-Browser",
    prod: "Brave_Linux",
  },
};

// ───────────────────────────────────────────────────────────────────────
// Every Chromium-family kiosk — flag read off the MAIN process
// ───────────────────────────────────────────────────────────────────────

for (const [name, layout] of Object.entries(BROWSERS)) {
  test(`${name}: reads the applied factor off the kiosk's main process`, () => {
    assert.equal(parseAppliedFromPs(chromiumTree({ ...layout, scale: "1.25" })), "1.25");
    assert.equal(parseAppliedFromPs(chromiumTree({ ...layout, scale: "1.75" })), "1.75");
  });

  test(`${name}: kiosk launched without the flag ⇒ "1"`, () => {
    assert.equal(parseAppliedFromPs(chromiumTree({ ...layout, scale: null })), "1");
  });

  test(`${name}: exactly one kiosk process found — helpers and crashpad excluded`, () => {
    const kiosks = findKioskProcesses(chromiumTree({ ...layout, scale: "1.5" }));
    assert.equal(kiosks.length, 1);
    assert.equal(kiosks[0].family, "chromium");
    assert.equal(kiosks[0].args[0], layout.main);
  });
}

// ───────────────────────────────────────────────────────────────────────
// Lockstep with deploy/install.sh — every offered Chromium-family name
// ───────────────────────────────────────────────────────────────────────
//
// Covers the launcher spelling of each name install.sh offers (the argv[0]
// a bare BROWSER_CMD or a wrapper's `exec -a "$0"` leaves in ps). A new
// browser added to KNOWN_BROWSERS fails here until CHROMIUM_KIOSK_EXE (or
// FIREFOX_KIOSK_EXE) learns it — and its real binary name, which this text
// parse can't know, needs a BROWSERS entry above.

const INSTALL_SH = fs.readFileSync(path.join(__dirname, "..", "deploy", "install.sh"), "utf8");

/**
 * Executable name → family, per install.sh's KNOWN_BROWSERS array and
 * classify_browser_family case arms.
 *
 * @returns {Map<string, string>} offered browser name → "chromium"|"firefox"|""
 */
const offeredBrowsers = () => {
  const known = INSTALL_SH.match(/KNOWN_BROWSERS=\(([\s\S]*?)\)/);
  const classify = INSTALL_SH.match(/^classify_browser_family\(\) \{[\s\S]*?^\}/m);
  assert.ok(known && classify, "KNOWN_BROWSERS / classify_browser_family not found in deploy/install.sh");
  const family = new Map();
  for (const [, names, fam] of classify[0].matchAll(/^\s*([a-z0-9|._-]+)\)\s*\n\s*echo "(\w+)"/gm)) {
    for (const n of names.split("|")) family.set(n, fam);
  }
  return new Map(known[1].split(/\s+/).filter(Boolean).map((n) => [n, family.get(n) || ""]));
};

test("install.sh parse found both families (guards against a silent no-match)", () => {
  const families = new Set(offeredBrowsers().values());
  assert.ok(families.has("chromium") && families.has("firefox"), [...families].join(","));
});

test("every Chromium-family browser install.sh offers is detected, by path or bare name", () => {
  const missed = [];
  for (const [name, fam] of offeredBrowsers()) {
    if (fam !== "chromium") continue;
    for (const argv0 of [`/usr/bin/${name}`, name]) {
      if (parseAppliedFromPs(chromiumMainLine(argv0, "1.5")) !== "1.5") missed.push(argv0);
    }
  }
  assert.deepEqual(missed, [], "applied would be null for these kiosks");
});

test("every Firefox-family browser install.sh offers is detected as firefox (applied stays null)", () => {
  for (const [name, fam] of offeredBrowsers()) {
    if (fam !== "firefox") continue;
    const line = `/usr/bin/${name} --kiosk --no-remote -P pi-weather-station ${KIOSK_URL}`;
    assert.deepEqual(findKioskProcesses(line).map((k) => k.family), ["firefox"], name);
    assert.equal(parseAppliedFromPs(line), null, name);
  }
});

// ───────────────────────────────────────────────────────────────────────
// Firefox — scale is a profile pref, so applied is honestly unknown
// ───────────────────────────────────────────────────────────────────────

const FIREFOX_ESR_TREE = [
  ...SYSTEM_NOISE,
  `/usr/lib/firefox-esr/firefox-esr --kiosk --no-remote -P pi-weather-station ${KIOSK_URL}`,
  "/usr/lib/firefox-esr/firefox-esr -contentproc -parentBuildID 20250930000000 -prefsLen 31544 -prefMapSize 244643 "
    + "-appDir /usr/lib/firefox-esr/browser {5b6d7f2e-0c1a-4e8f-9a3b-2d4c6e8f0a1b} 2214 true socket",
  "/usr/lib/firefox-esr/firefox-esr -contentproc -childID 1 -isForBrowser -prefsLen 31652 -prefMapSize 244643 "
    + "-jsInitLen 231800 -parentBuildID 20250930000000 -greomni /usr/lib/firefox-esr/omni.ja "
    + "-appomni /usr/lib/firefox-esr/browser/omni.ja -appDir /usr/lib/firefox-esr/browser "
    + "{0e3c1b5a-7d2f-4a6e-8b9c-1f3e5a7c9d2b} 2214 true tab",
].join("\n");

const FIREFOX_SNAP_TREE = [
  ...SYSTEM_NOISE,
  `/snap/firefox/7084/usr/lib/firefox/firefox --kiosk --no-remote -P pi-weather-station ${KIOSK_URL}`,
  "/snap/firefox/7084/usr/lib/firefox/firefox -contentproc -childID 2 -isForBrowser -prefsLen 30211 "
    + "-prefMapSize 251912 -parentBuildID 20251001000000 -appDir /snap/firefox/7084/usr/lib/firefox/browser "
    + "{9a8b7c6d-5e4f-4a3b-2c1d-0e9f8a7b6c5d} 3170 true tab",
];

test("Firefox kiosk (deb + snap) is FOUND as firefox, not silently ignored", () => {
  for (const tree of [FIREFOX_ESR_TREE, FIREFOX_SNAP_TREE.join("\n")]) {
    const kiosks = findKioskProcesses(tree);
    assert.equal(kiosks.length, 1, "content processes (-contentproc) must not count");
    assert.equal(kiosks[0].family, "firefox");
  }
});

test("Firefox kiosk ⇒ applied null, never a false \"1\" (scale lives in user.js, not argv)", () => {
  assert.equal(parseAppliedFromPs(FIREFOX_ESR_TREE), null);
  assert.equal(parseAppliedFromPs(FIREFOX_SNAP_TREE.join("\n")), null);
});

test("Firefox kiosk + a flagged NON-kiosk desktop Chromium ⇒ still null", () => {
  const listing = [
    FIREFOX_ESR_TREE,
    "/usr/lib/chromium/chromium --force-device-scale-factor=2 https://example.org",
  ].join("\n");
  assert.equal(parseAppliedFromPs(listing), null);
});

// ───────────────────────────────────────────────────────────────────────
// Processes that are NOT the kiosk
// ───────────────────────────────────────────────────────────────────────

test("no kiosk running: an SSH diagnostic mentioning chromium + --kiosk is not the kiosk", () => {
  const listing = [
    ...SYSTEM_NOISE,
    "-bash",
    "pgrep -af chromium.*--kiosk",
    "grep --color=auto -- --kiosk /home/pi/.local/state/pi-weather-station/kiosk.log",
  ].join("\n");
  assert.equal(parseAppliedFromPs(listing), null);
  assert.deepEqual(findKioskProcesses(listing), []);
});

test("relaunch-kiosk.sh's own pkill (kiosk already down) is not the kiosk", () => {
  const listing = [...SYSTEM_NOISE, "bash /home/pi/pi-weather-station/deploy/relaunch-kiosk.sh", "pkill -TERM -f -- --kiosk"].join("\n");
  assert.equal(parseAppliedFromPs(listing), null);
});

test("a desktop (non-kiosk) Chromium window, even with a scale flag ⇒ null", () => {
  const listing = [
    ...SYSTEM_NOISE,
    "/usr/lib/chromium/chromium --force-device-scale-factor=1.5 https://example.org",
    "/usr/lib/chromium/chromium --type=renderer --crashpad-handler-pid=901 --force-device-scale-factor=1.5 --lang=en-US",
  ].join("\n");
  assert.equal(parseAppliedFromPs(listing), null);
});

test("--kiosk inside another argument (URL, pattern) is not the kiosk flag", () => {
  assert.equal(parseAppliedFromPs("/usr/lib/chromium/chromium https://example.org/?mode=--kiosk"), null);
  assert.equal(parseAppliedFromPs("/usr/lib/chromium/chromium --kiosk-printing https://example.org"), null);
});

test("defensive: only the browser binary itself counts, not look-alike executables", () => {
  // Helper binaries that share the install dirs, and a user wrapper script
  // whose name merely contains a browser name — even if one carried --kiosk.
  for (const exe of [
    "/usr/lib/chromium/chrome_crashpad_handler",
    "/opt/microsoft/msedge/msedge_crashpad_handler",
    "/opt/google/chrome/chrome-sandbox",
    "/usr/bin/chromedriver",
    "/home/pi/bin/run-chromium",
    "/usr/bin/firefox-wrapper",
  ]) {
    assert.deepEqual(findKioskProcesses(`${exe} --kiosk ${KIOSK_URL}`), [], exe);
  }
});

test("defensive: a helper (--type=…) line carrying --kiosk is never taken for the main process", () => {
  // Main process already gone mid-relaunch; only a helper line remains.
  const listing = `/usr/lib/chromium/chromium --type=renderer --kiosk --force-device-scale-factor=1.5 --lang=en-US`;
  assert.equal(parseAppliedFromPs(listing), null);
});

// ───────────────────────────────────────────────────────────────────────
// Chromium switch semantics + ambiguity
// ───────────────────────────────────────────────────────────────────────

test("repeated scale switch: the LAST one wins, as in Chromium", () => {
  // e.g. a stale value in /etc/chromium.d (prepended by the wrapper) and
  // start-server's own flag after it.
  const line = chromiumMainLine("/usr/lib/chromium/chromium", "1.25", ["--force-device-scale-factor=1.5"]);
  assert.equal(parseAppliedFromPs(line), "1.25");
});

test("chromiumScaleFromArgs: unparsable value ⇒ \"1\" (Chromium ignores it)", () => {
  assert.equal(chromiumScaleFromArgs(["chromium", "--kiosk", "--force-device-scale-factor=abc"]), "1");
  assert.equal(chromiumScaleFromArgs(["chromium", "--kiosk", "--force-device-scale-factor="]), "1");
  assert.equal(chromiumScaleFromArgs(["chromium", "--kiosk"]), "1");
  assert.equal(chromiumScaleFromArgs(["chromium", "--force-device-scale-factor=2"]), "2");
});

test("two kiosk main processes that disagree (relaunch overlap) ⇒ null, agree ⇒ the value", () => {
  const old = chromiumMainLine("/usr/lib/chromium/chromium", "1.25");
  const fresh = chromiumMainLine("/usr/lib/chromium/chromium", "1.5");
  assert.equal(parseAppliedFromPs([old, fresh].join("\n")), null);
  assert.equal(parseAppliedFromPs([fresh, fresh].join("\n")), "1.5");
  assert.equal(parseAppliedFromPs([old, FIREFOX_ESR_TREE].join("\n")), null);
});

test("unhelpful input ⇒ no kiosk, null", () => {
  assert.deepEqual(findKioskProcesses(undefined), []);
  assert.deepEqual(findKioskProcesses(""), []);
  assert.equal(parseAppliedFromPs(null), null);
  assert.equal(parseAppliedFromPs("COMMAND\n"), null);
});
