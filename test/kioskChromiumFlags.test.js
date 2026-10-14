// Kiosk-only removal of --force-renderer-accessibility.
//
// Raspberry Pi OS's rpi-chromium-mods adds that flag to EVERY Chromium launch
// (/etc/chromium.d/00-rpi-vars). It makes each renderer keep the page's
// accessibility tree up to date: 14-36 ms in every view-opening frame on the
// kiosks, 12-26 % more missed frames during view switches (2026-10-14). A
// desktop screen reader still needs it, so it is dropped for the kiosk only:
//
//  - deploy/chromium.d/99-pi-weather-station-kiosk, sourced by the Chromium
//    wrapper's /bin/sh, filters CHROMIUM_FLAGS when PI_WEATHER_STATION_KIOSK=1;
//  - deploy/start-server exports that variable before it launches the kiosk;
//  - deploy/install.sh installs the file in /etc/chromium.d, uninstall.sh
//    removes it;
//  - deploy/check-kiosk-browser-flags.sh reads the running kiosk's effective
//    command line.
//
// The filter runs for real here (under /bin/sh, the way the wrapper sources
// it), and so does the check script, against a fake /proc. The rest is a
// text-level guard, like kioskBrowserLists.test.js: nothing runs install.sh
// in CI.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEPLOY_DIR = path.join(__dirname, "..", "deploy");
const FILTER = path.join(DEPLOY_DIR, "chromium.d", "99-pi-weather-station-kiosk");
const CHECK = path.join(DEPLOY_DIR, "check-kiosk-browser-flags.sh");
const INSTALL_SH = fs.readFileSync(path.join(DEPLOY_DIR, "install.sh"), "utf8");
const UNINSTALL_SH = fs.readFileSync(path.join(DEPLOY_DIR, "uninstall.sh"), "utf8");
const START_SERVER = fs.readFileSync(path.join(DEPLOY_DIR, "start-server"), "utf8");
const RELAUNCH_KIOSK = fs.readFileSync(path.join(DEPLOY_DIR, "relaunch-kiosk.sh"), "utf8");

const A11Y = "--force-renderer-accessibility";
const INSTALLED_NAME = "/etc/chromium.d/99-pi-weather-station-kiosk";

// A shell-safe single-quoted literal.
const sq = (s) => `'${s.replace(/'/g, "'\\''")}'`;

/**
 * Source the filter the way the Chromium wrapper does — inside a /bin/sh that
 * already holds positional parameters (the kiosk's own arguments) and an
 * exported CHROMIUM_FLAGS — then print what the wrapper would exec with.
 *
 * @param {string} flags CHROMIUM_FLAGS before the filter
 * @param {boolean} kiosk whether PI_WEATHER_STATION_KIOSK=1 is exported
 * @param {string} [shellOpts] options set before sourcing (e.g. "-u", "-f")
 * @param {string} [shell] the shell standing in for the wrapper's /bin/sh
 * @returns {{status: number, filterOut: string, flags: string, args: string, opts: string, leaked: string}}
 *   exit status, the filter's own output, the resulting flags, the wrapper's
 *   "$@" afterwards, its `$-`, and any _pws_ variable left behind
 */
const runFilter = (flags, kiosk, shellOpts = "", shell = "/bin/sh") => {
  const script = [
    shellOpts ? `set ${shellOpts}` : "",
    `CHROMIUM_FLAGS=${sq(flags)}`,
    "export CHROMIUM_FLAGS",
    "set -- --kiosk https://localhost:8443",
    `filter_out=$(. ${sq(FILTER)} 2>&1; echo "rc=$?")`,
    `. ${sq(FILTER)}`,
    'printf "OUT[%s]\\n" "$filter_out"',
    'printf "FLAGS[%s]\\n" "$CHROMIUM_FLAGS"',
    'printf "ARGS[%s]\\n" "$*"',
    'printf "OPTS[%s]\\n" "$-"',
    'printf "LEAK[%s]\\n" "$(set | grep "^_pws_" || true)"',
    'printf "EXPORTED[%s]\\n" "$(sh -c \'printf %s "$CHROMIUM_FLAGS"\')"',
  ].filter(Boolean).join("\n");
  const env = { PATH: process.env.PATH };
  if (kiosk) env.PI_WEATHER_STATION_KIOSK = "1";
  const r = spawnSync(shell, ["-c", script], { env, encoding: "utf8" });
  const grab = (tag) => {
    const m = r.stdout.match(new RegExp(`^${tag}\\[([\\s\\S]*?)\\]$`, "m"));
    assert.ok(m, `missing ${tag} in output:\n${r.stdout}\n${r.stderr}`);
    return m[1];
  };
  return {
    status: r.status,
    stderr: r.stderr,
    filterOut: grab("OUT"),
    flags: grab("FLAGS"),
    exported: grab("EXPORTED"),
    args: grab("ARGS"),
    opts: grab("OPTS"),
    leaked: grab("LEAK"),
  };
};

// The Pi's /bin/sh is dash; macOS's is bash in POSIX mode. Run both when
// dash is installed (macOS ships /bin/dash; Debian and Raspberry Pi OS too).
const DASH = spawnSync("/bin/sh", ["-c", "command -v dash"], { encoding: "utf8" }).stdout.trim();
const SHELLS = ["/bin/sh", ...(DASH ? [DASH] : [])];

const RPI_FLAGS =
  ` --disable-pings ${A11Y} --enable-remote-extensions --password-store=basic ${A11Y}=complete`;

test("filter: with the kiosk variable, every --force-renderer-accessibility goes and the rest stays in order", () => {
  const cases = [
    // [before, expected after]
    [`${A11Y}`, ""],
    [` ${A11Y} --enable-remote-extensions`, "--enable-remote-extensions"], // 00-rpi-vars, verbatim
    [`--a ${A11Y}`, "--a"],
    [`${A11Y} --a --b`, "--a --b"],
    [`--a ${A11Y} --b`, "--a --b"],
    [`${A11Y} --a ${A11Y} --b ${A11Y}`, "--a --b"], // several times, every position
    [RPI_FLAGS, "--disable-pings --enable-remote-extensions --password-store=basic"],
    // Lookalikes are not the flag.
    [`--force-renderer-accessibility-x --xforce-renderer-accessibility`,
      "--force-renderer-accessibility-x --xforce-renderer-accessibility"],
    // A flag with a glob character must not be expanded.
    [`--a=* ${A11Y} --b=?`, "--a=* --b=?"],
    ["", ""],
  ];
  for (const shell of SHELLS) {
    for (const [before, after] of cases) {
      const r = runFilter(before, true, "", shell);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.flags, after, `${shell}: CHROMIUM_FLAGS=${JSON.stringify(before)}`);
      assert.equal(r.exported, after, `${shell}: CHROMIUM_FLAGS must stay exported`);
    }
  }
});

test("filter: without the kiosk variable, CHROMIUM_FLAGS is untouched (desktop launches keep the flag)", () => {
  for (const shell of SHELLS) {
    for (const before of [RPI_FLAGS, `${A11Y}`, "", "--a   --b"]) {
      const r = runFilter(before, false, "", shell);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.flags, before, shell);
    }
  }
});

test("filter: silent, exit 0, and leaves the wrapper's shell as it found it", () => {
  for (const shell of SHELLS) {
    for (const kiosk of [true, false]) {
      for (const opts of ["", "-u", "-f", "-e", "-eu"]) {
        const what = `${shell} ${opts} kiosk=${kiosk}`;
        const r = runFilter(RPI_FLAGS, kiosk, opts, shell);
        assert.equal(r.status, 0, `${what}: ${r.stderr}`);
        assert.equal(r.stderr, "", what);
        assert.equal(r.filterOut, "rc=0", `${what}: the filter printed something`);
        assert.equal(r.args, "--kiosk https://localhost:8443", `${what}: the wrapper's "$@" must survive`);
        assert.equal(r.leaked, "", `${what}: helper variables must be unset`);
        // Globbing restored as found: still on, or still off under -f.
        assert.equal(r.opts.includes("f"), opts.includes("f"), `${what}: set -f state changed`);
      }
    }
  }
});

test("filter: end to end through a wrapper modelled on Raspberry Pi OS's /usr/bin/chromium", () => {
  // The wrapper's shape: reset CHROMIUM_FLAGS, source every file of the
  // directory in glob order (README and dpkg leftovers skipped), exec the
  // browser with $CHROMIUM_FLAGS "$@". `printf` stands in for the browser.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pws-chromium-d-"));
  try {
    const confDir = path.join(dir, "chromium.d");
    fs.mkdirSync(confDir);
    fs.writeFileSync(
      path.join(confDir, "00-rpi-vars"),
      `export CHROMIUM_FLAGS="$CHROMIUM_FLAGS ${A11Y} --enable-remote-extensions"\n`
    );
    fs.copyFileSync(FILTER, path.join(confDir, "99-pi-weather-station-kiosk"));
    const wrapper = path.join(dir, "chromium");
    fs.writeFileSync(wrapper, [
      "#!/bin/sh",
      'CHROMIUM_FLAGS=""',
      `for file in ${sq(confDir)}/*; do`,
      '  case "$file" in */README|*.dpkg*) continue ;; esac',
      '  [ -f "$file" ] && . "$file"',
      "done",
      'exec printf "%s\\n" $CHROMIUM_FLAGS "$@"',
      "",
    ].join("\n"));
    for (const shell of SHELLS) {
      const run = (kiosk) => {
        const env = { PATH: process.env.PATH };
        if (kiosk) env.PI_WEATHER_STATION_KIOSK = "1";
        const r = spawnSync(shell, [wrapper, "--kiosk", "https://localhost:8443"], { env, encoding: "utf8" });
        assert.equal(r.status, 0, `${shell}: ${r.stderr}`);
        assert.equal(r.stderr, "", shell);
        return r.stdout.trim().split("\n");
      };
      assert.deepEqual(run(true), ["--enable-remote-extensions", "--kiosk", "https://localhost:8443"], shell);
      assert.deepEqual(run(false), [A11Y, "--enable-remote-extensions", "--kiosk", "https://localhost:8443"], shell);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("filter: sorts after Raspberry Pi OS's 00-rpi-vars and is plain sourced sh", () => {
  assert.ok("99-pi-weather-station-kiosk" > "00-rpi-vars");
  const src = fs.readFileSync(FILTER, "utf8");
  assert.ok(!src.startsWith("#!"), "sourced, not executed: no shebang");
  // No bashisms the wrapper's /bin/sh (dash) would choke on, and no `set --`,
  // which would replace the kiosk's own arguments.
  const code = src.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.doesNotMatch(code, /\[\[|\blocal\b|\bset --|\becho\b|\bprintf\b|function\s/);
  for (const shell of SHELLS) {
    const r = spawnSync(shell, ["-n", FILTER], { encoding: "utf8" });
    assert.equal(r.status, 0, `${shell}: ${r.stderr}`);
  }
});

test("start-server exports PI_WEATHER_STATION_KIOSK=1 in the Chromium branch, before the kiosk launch", () => {
  const chromiumArm = START_SERVER.match(/^\s{4}chromium\)\n([\s\S]*?)^\s{8};;/m);
  assert.ok(chromiumArm, "chromium) arm of the launch case not found in start-server");
  const body = chromiumArm[1];
  const exportAt = body.search(/^\s*export PI_WEATHER_STATION_KIOSK=1\s*$/m);
  const launchAt = body.search(/"\$BROWSER_CMD" --kiosk/);
  assert.ok(exportAt >= 0, "export PI_WEATHER_STATION_KIOSK=1 missing from the chromium) arm");
  assert.ok(launchAt >= 0, "kiosk launch not found in the chromium) arm");
  assert.ok(exportAt < launchAt, "the variable must be exported BEFORE the browser starts");
});

test("relaunch-kiosk.sh relaunches through start-server, so a relaunched kiosk gets the variable too", () => {
  assert.match(RELAUNCH_KIOSK, /^LAUNCHER="\$HOME\/\.local\/bin\/start-server"$/m);
  assert.match(RELAUNCH_KIOSK, /systemd-run --user --scope[\s\S]*?"\$LAUNCHER"/);
});

test("install.sh installs the filter as root:root 0644, guarded, only for a wrapper that reads /etc/chromium.d", () => {
  assert.match(INSTALL_SH, /CHROMIUM_D_SRC="\$REPO_DIR\/deploy\/chromium\.d\/99-pi-weather-station-kiosk"/);
  assert.ok(INSTALL_SH.includes(`CHROMIUM_D_DEST="${INSTALLED_NAME}"`));
  // The install itself sits in an `if` so a refused sudo can't abort the
  // `set -e` script (same pattern as the logrotate step).
  assert.match(
    INSTALL_SH,
    /elif sudo install -o root -g root -m 0644 "\$CHROMIUM_D_SRC" "\$CHROMIUM_D_DEST"; then/
  );
  // Gates: kiosk on, Chromium family, /etc/chromium.d present, and the
  // browser command is a script that sources it.
  assert.match(
    INSTALL_SH,
    /if \[ "\$KIOSK_MODE" = "yes" \] && \[ "\$KIOSK_BROWSER_FAMILY" = "chromium" \] && \[ -d \/etc\/chromium\.d \]; then/
  );
  assert.match(INSTALL_SH, /grep -qs '\/etc\/chromium\.d' "\$KIOSK_BROWSER_REAL"/);
  // Idempotent: an identical copy is not reinstalled (no needless sudo prompt).
  assert.match(INSTALL_SH, /if cmp -s "\$CHROMIUM_D_SRC" "\$CHROMIUM_D_DEST"; then/);
  // The source file the installer copies exists.
  assert.ok(fs.statSync(FILTER).isFile());
});

test("uninstall.sh removes the installed filter with a guarded sudo", () => {
  assert.ok(UNINSTALL_SH.includes(`CHROMIUM_D_FILE="${INSTALLED_NAME}"`));
  assert.match(UNINSTALL_SH, /sudo rm -f "\$CHROMIUM_D_FILE" \\\n\s*&& echo .*\\\n\s*\|\| echo/);
});

// ---------------------------------------------------------------------------
// check-kiosk-browser-flags.sh against a fake /proc
// ---------------------------------------------------------------------------

const CHROMIUM_MAIN = [
  "/usr/lib/chromium/chromium", "--kiosk", "--noerrdialogs", "--disable-infobars",
  "--no-first-run", "--ignore-certificate-errors", "--touch-events=enabled",
  "--ozone-platform=wayland", "https://localhost:8443",
];

/**
 * Build a fake /proc with one directory per process.
 *
 * @param {Object<string, string[]|string>} procs pid → argv (NUL-joined with a
 *   trailing NUL, as the kernel writes it) or a raw cmdline string
 * @returns {string} the fake /proc directory
 */
const fakeProc = (procs) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pws-proc-"));
  for (const [pid, argv] of Object.entries(procs)) {
    fs.mkdirSync(path.join(dir, pid));
    const raw = Array.isArray(argv) ? argv.map((a) => `${a}\0`).join("") : argv;
    fs.writeFileSync(path.join(dir, pid, "cmdline"), raw);
  }
  // Non-PID entries a real /proc also has.
  fs.mkdirSync(path.join(dir, "self"));
  fs.writeFileSync(path.join(dir, "uptime"), "1 1\n");
  return dir;
};

/**
 * Run the check script against a fake /proc.
 *
 * @param {Object<string, string[]|string>} procs see fakeProc
 * @returns {{status: number, stdout: string}} exit status and output
 */
const runCheck = (procs) => {
  const dir = fakeProc(procs);
  try {
    const r = spawnSync("bash", [CHECK], {
      env: { PATH: process.env.PATH, KIOSK_CHECK_PROC_DIR: dir },
      encoding: "utf8",
    });
    assert.equal(r.stderr, "", r.stderr);
    return { status: r.status, stdout: r.stdout };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// Processes around a real kiosk: helpers carrying --type= (one of them also
// with the flag and --kiosk, as Chromium passes switches down), a title-
// rewritten renderer, relaunch-kiosk.sh's pkill, start-server, a desktop
// Chromium window WITH the flag (not the kiosk), and an unrelated process.
const NEIGHBOURS = {
  210: ["/usr/lib/chromium/chromium", "--type=zygote", "--kiosk", A11Y],
  211: `/usr/lib/chromium/chromium --type=renderer --kiosk ${A11Y} --lang=en-US`,
  212: ["/usr/lib/chromium/chromium", "--type=gpu-process", A11Y],
  220: ["pkill", "-TERM", "-f", "--", "--kiosk"],
  221: ["/usr/bin/pgrep", "-f", "--kiosk"],
  230: ["/bin/bash", "/home/pi/.local/bin/start-server"],
  240: ["/usr/lib/chromium/chromium", A11Y, "--enable-remote-extensions"],
  250: ["node", "server/index.js"],
};

test("check: kiosk without the flag → exit 0, prints the kiosk command line only", () => {
  const r = runCheck({ ...NEIGHBOURS, 200: CHROMIUM_MAIN });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^PID 200: \/usr\/lib\/chromium\/chromium --kiosk .* https:\/\/localhost:8443$/m);
  assert.doesNotMatch(r.stdout, /PID 2[1-5]\d:/, "helpers, pkill, the launcher and other windows are not the kiosk");
  assert.match(r.stdout, /^OK:/m);
});

test("check: kiosk with the flag (anywhere, or with a value) → exit 1", () => {
  const variants = [
    [CHROMIUM_MAIN[0], A11Y, ...CHROMIUM_MAIN.slice(1)],
    [...CHROMIUM_MAIN.slice(0, 4), A11Y, ...CHROMIUM_MAIN.slice(4)],
    [...CHROMIUM_MAIN, A11Y],
    [...CHROMIUM_MAIN, `${A11Y}=complete`],
  ];
  for (const argv of variants) {
    const r = runCheck({ ...NEIGHBOURS, 200: argv });
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, /^PID 200: /m);
    assert.match(r.stdout, /^FAIL:/m);
  }
});

test("check: no kiosk browser → exit 2, even with helpers, pkill and a desktop window carrying --kiosk or the flag", () => {
  assert.equal(runCheck(NEIGHBOURS).status, 2);
  assert.equal(runCheck({}).status, 2);
});

test("check: a title-rewritten kiosk (one space-joined string, no NULs) is still read", () => {
  const r = runCheck({ 200: CHROMIUM_MAIN.join(" ") });
  assert.equal(r.status, 0, r.stdout);
  const flagged = runCheck({ 200: [...CHROMIUM_MAIN, A11Y].join(" ") });
  assert.equal(flagged.status, 1, flagged.stdout);
});

test("check: a Firefox kiosk is found and reported flag-free", () => {
  const r = runCheck({ 300: ["/usr/lib/firefox/firefox", "--kiosk", "--no-remote", "-P", "pi-weather-station", "https://localhost:8443"] });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^PID 300: /m);
});

test("check: no /proc → exit 2", () => {
  const r = spawnSync("bash", [CHECK], {
    env: { PATH: process.env.PATH, KIOSK_CHECK_PROC_DIR: path.join(os.tmpdir(), "pws-no-such-proc") },
    encoding: "utf8",
  });
  assert.equal(r.status, 2);
});

test("check script is read-only and executable", () => {
  const src = fs.readFileSync(CHECK, "utf8");
  const code = src.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.doesNotMatch(code, /\b(kill|rm|sudo|mv|cp|tee|chmod)\b/, "must not change anything");
  // No output redirection other than to /dev/null or stderr.
  assert.doesNotMatch(code.replace(/\d?>\s*\/dev\/null|>&2|<<</g, ""), />/, "must not write files");
  assert.ok(fs.statSync(CHECK).mode & 0o111, "must be executable");
});
