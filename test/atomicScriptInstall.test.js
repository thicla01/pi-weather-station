// install.sh must replace installed scripts atomically, never rewrite them in
// place.
//
// A plain `cp` onto an existing file truncates and rewrites it under the same
// inode, and bash reads a script incrementally. install.sh copies
// ~/.local/bin/start-server while the previous start-server is still running
// (it waits on the kiosk browser until the relaunch or reboot that follows the
// update), so when the browser exited, that bash resumed at its old byte
// offset in the NEW file and ran whatever fragment sat there:
// `start-server: line 215: ue: command not found` in kiosk.log on every kiosk
// checked after the 2026-10-14 rollout. Harmless that time; in general an
// arbitrary slice of the new script.
//
// install.sh's `install_script` copies to a temp file in the destination's
// directory and renames it over the old copy: a new inode, while the running
// bash keeps reading the one it opened. The helper runs for real here (the
// hazard is reproduced with a plain `cp` as a control); the rest is a
// text-level guard over install.sh, like kioskBrowserLists.test.js — nothing
// runs install.sh in CI.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEPLOY_DIR = path.join(__dirname, "..", "deploy");
const INSTALL_SH = fs.readFileSync(path.join(DEPLOY_DIR, "install.sh"), "utf8");

// The helper's definition, extracted verbatim so the test runs install.sh's
// own code rather than a copy of it.
const HELPER = INSTALL_SH.match(/^install_script\(\) \{\n[\s\S]*?\n\}$/m)?.[0];

// Command position: start of line, after a separator, or after a keyword
// that precedes a command (`if sudo cp …`, `then cp …`).
const CMD = String.raw`(?:^|[;&|(]|\bsudo|\bthen|\bdo|\belse)\s*`;
const HOME_BIN = String.raw`["']?(?:~|\$HOME|\$\{HOME\})/\.local/bin/`;
// A copy/write command whose operands name a path under ~/.local/bin.
const COPY_INTO_BIN = new RegExp(`${CMD}(?:cp|dd|tee)\\s[^#]*\\.local/bin/`);
// A shell redirection (`>` / `>>`) onto ~/.local/bin. Tested once quoted
// strings are blanked, except a redirection's own target, so a message such as
// `echo ">> ~/.local/bin/start-server installed."` is not a redirection.
const REDIRECT_INTO_BIN = new RegExp(`>>?\\s*${HOME_BIN}`);
const blankStrings = (line) => line.replace(/(?<!>\s*)(["'])(?:(?!\1).)*\1/g, '""');
// A plain `cp` whose source is a file under deploy/ — the destination may sit
// behind a variable, so a script is caught by its source too.
const COPY_FROM_DEPLOY = new RegExp(
  `${CMD}cp\\s+(?:-\\S+\\s+)*"?\\$(?:REPO_DIR|\\{REPO_DIR\\})/deploy/([^"\\s]+)`
);

/**
 * List the lines of a shell script that write a script in place: a copy or a
 * redirection onto ~/.local/bin, or a plain `cp` of a deploy/ file that starts
 * with a shebang (an executable script, wherever it lands).
 *
 * @param {string} source the shell script's text
 * @returns {string[]} the offending lines, as "<line number>: <text>"
 */
const inPlaceScriptWrites = (source) =>
  source.split("\n").flatMap((line, i) => {
    if (/^\s*#/.test(line)) return [];
    const fromDeploy = line.match(COPY_FROM_DEPLOY);
    const copiesScript =
      fromDeploy &&
      fs.existsSync(path.join(DEPLOY_DIR, fromDeploy[1])) &&
      fs.readFileSync(path.join(DEPLOY_DIR, fromDeploy[1])).subarray(0, 2).toString() === "#!";
    return COPY_INTO_BIN.test(line) || REDIRECT_INTO_BIN.test(blankStrings(line)) || copiesScript
      ? [`${i + 1}: ${line.trim()}`]
      : [];
  });

/**
 * Write the helper to a file the shell can source.
 *
 * @param {string} dir a scratch directory
 * @returns {string} the helper file's path
 */
const writeHelper = (dir) => {
  const file = path.join(dir, "helper.sh");
  fs.writeFileSync(file, `${HELPER}\n`);
  return file;
};

/**
 * Start a bash script that blocks on an external command (as start-server
 * blocks on the browser), replace its file while it waits, then release it.
 *
 * @param {"install_script" | "cp"} replaceWith how the file is replaced
 * @returns {{status: number, stderr: string, out: string, leftovers: string[]}}
 *   the orchestrator's exit status and stderr, what the running script printed
 *   after it was released, and the scratch directory's entries afterwards
 */
const replaceWhileRunning = (replaceWith) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-install-"));
  try {
    const helper = writeHelper(dir);
    // Identical up to the last line, so the byte offset where the running
    // bash resumes is a line boundary in both files: the control prints a
    // clean "new-tail" instead of an unpredictable fragment.
    const body = ["#!/bin/bash", 'echo started > "$MARK"', 'cat "$FIFO" > /dev/null'];
    fs.writeFileSync(path.join(dir, "old"), [...body, "echo old-tail", ""].join("\n"));
    fs.writeFileSync(path.join(dir, "new"), [...body, "echo new-tail", ""].join("\n"));
    const script = [
      "set -e",
      '. "$1"',
      'dir=$2',
      'cp "$dir/old" "$dir/target"',
      'chmod +x "$dir/target"',
      'mkfifo "$dir/fifo"',
      'MARK="$dir/mark" FIFO="$dir/fifo" bash "$dir/target" > "$dir/out" 2>&1 &',
      "pid=$!",
      // Replace only once the script is running (it has opened its file).
      "i=0",
      'until [ -e "$dir/mark" ]; do',
      '  i=$((i + 1)); [ "$i" -le 200 ] || { kill "$pid"; echo "script never started" >&2; exit 1; }',
      "  sleep 0.05",
      "done",
      `${replaceWith} "$dir/new" "$dir/target"`,
      'echo go > "$dir/fifo"',
      'wait "$pid"',
    ].join("\n");
    const r = spawnSync("bash", ["-c", script, "bash", helper, dir], {
      encoding: "utf8",
      timeout: 20_000,
    });
    const outFile = path.join(dir, "out");
    return {
      status: r.status,
      stderr: r.stderr,
      out: fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8").trim() : "",
      leftovers: fs.readdirSync(dir).sort(),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test("install.sh defines the install_script helper", () => {
  assert.ok(HELPER, "install_script() { … } not found at the top level of install.sh");
  assert.match(HELPER, /\bmv -f\b/, "the helper must rename the new copy over the old one");
});

test("install.sh never writes a script in place", () => {
  assert.deepEqual(
    inPlaceScriptWrites(INSTALL_SH),
    [],
    "copy scripts with install_script (temp file + mv -f), not cp/redirection onto the final path"
  );
});

test("the guard catches the pre-fix copy", () => {
  // The lines install.sh carried until 2026-10-15, plus the same copy hidden
  // behind a destination variable — a guard that let them through is vacuous.
  const preFix = [
    '    cp "$REPO_DIR/deploy/start-server" ~/.local/bin/start-server',
    '    cp "$REPO_DIR/deploy/detect-display-scale.sh" ~/.local/bin/detect-display-scale.sh',
    '    cp "$REPO_DIR/deploy/start-server" "$BIN_DIR/start-server"',
    '    cat "$REPO_DIR/deploy/start-server" > "$HOME/.local/bin/start-server"',
  ].join("\n");
  assert.equal(inPlaceScriptWrites(preFix).length, 4);
  // Non-script deploy files and reads of ~/.local/bin are not flagged.
  const allowed = [
    '    cp "$REPO_DIR/deploy/pi-weather-server.service" ~/.config/systemd/user/',
    "    DETECTED_SCALE=$(~/.local/bin/detect-display-scale.sh 2>/dev/null || true)",
    '    echo "   To open the app manually, run: ~/.local/bin/start-server"',
    '    echo ">> ~/.local/bin/start-server installed."',
    '    install_script "$REPO_DIR/deploy/start-server" ~/.local/bin/start-server',
  ].join("\n");
  assert.deepEqual(inPlaceScriptWrites(allowed), []);
});

test("start-server and detect-display-scale.sh are installed through the helper", () => {
  for (const name of ["start-server", "detect-display-scale.sh"]) {
    const call = new RegExp(
      `^\\s*install_script "\\$REPO_DIR/deploy/${name.replace(/\./g, "\\.")}" ~/\\.local/bin/${name.replace(/\./g, "\\.")}$`,
      "m"
    );
    assert.match(INSTALL_SH, call, `${name} is not installed with install_script`);
  }
});

test("install_script installs a byte-identical executable under a new inode", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-install-"));
  try {
    const helper = writeHelper(dir);
    const src = path.join(DEPLOY_DIR, "start-server");
    const dest = path.join(dir, "start-server");
    fs.writeFileSync(dest, "#!/bin/bash\necho previous install\n");
    const before = fs.statSync(dest).ino;
    const r = spawnSync("bash", ["-c", '. "$1" && install_script "$2" "$3"', "bash", helper, src, dest], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(r.status, 0, r.stderr);
    const after = fs.statSync(dest);
    assert.notEqual(after.ino, before, "the destination was rewritten in place");
    assert.ok(after.mode & 0o100, "the installed script is not executable");
    // The in-app updater flags start-server by hashing the installed copy
    // against upstream (updateChecker `changedDeployFiles`): the bytes must
    // not change.
    const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
    assert.equal(sha(dest), sha(src));
    assert.deepEqual(fs.readdirSync(dir).sort(), ["helper.sh", "start-server"], "temp file left behind");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a running script finishes its own copy when install_script replaces it", () => {
  const r = replaceWhileRunning("install_script");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.out, "old-tail");
  assert.ok(!r.leftovers.some((f) => f.startsWith(".target.new.")), "temp file left behind");
});

test("control: a plain cp makes the running script resume in the new file", () => {
  // Proves the harness reaches the hazard: if this ever printed old-tail, the
  // test above would pass vacuously.
  const r = replaceWhileRunning("cp");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.out, "new-tail");
});
