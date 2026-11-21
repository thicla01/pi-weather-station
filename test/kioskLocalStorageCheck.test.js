// Guards for tools/check-kiosk-localstorage.py, the read-only integrity check
// of a kiosk's Chromium localStorage (leveldb log, tables, manifest).
//
// The tool is Python (it travels over SSH to a Pi on stdin, where python3 is
// always present and node may not be on the PATH). Its parser is tested by its
// own `--selftest`, on hand-made files: a clean and a torn log, split records,
// snappy, a table with a damaged block. This suite runs that self-test when
// python3 is available (it is on CI) and skips it otherwise.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const TOOL = path.join(ROOT, "tools", "check-kiosk-localstorage.py");
const hasPython = spawnSync("python3", ["--version"]).status === 0;

test("the tool's own self-test passes", { skip: hasPython ? false : "python3 not found" }, () => {
  const run = spawnSync("python3", ["-I", TOOL, "--selftest"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /selftest: ok/);
});

test("no leveldb directory: says so and exits 2", { skip: hasPython ? false : "python3 not found" }, () => {
  const run = spawnSync("python3", ["-I", TOOL, "--dir", path.join(ROOT, "no-such-leveldb")], { encoding: "utf8" });
  assert.equal(run.status, 2);
  assert.match(run.stdout, /No Chromium-family Local Storage directory found/);
});

test("the tool looks in the same browser profiles as relaunch-kiosk.sh", () => {
  const sh = fs.readFileSync(path.join(ROOT, "deploy", "relaunch-kiosk.sh"), "utf8");
  const body = sh.slice(sh.indexOf("kiosk_profile_dir() {"), sh.indexOf("KIOSK_SWEEP_NAMES="));
  const fromShell = [...body.matchAll(/echo "\$HOME\/([^"]+)"/g)].map((m) => m[1]).sort();
  assert.ok(fromShell.length >= 4, "kiosk_profile_dir() not found in relaunch-kiosk.sh");

  const py = fs.readFileSync(TOOL, "utf8");
  const tuple = py.slice(py.indexOf("PROFILE_DIRS = ("), py.indexOf(")", py.indexOf("PROFILE_DIRS = (")));
  const fromTool = [...tuple.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(fromTool, fromShell);
});

test("the tool only reads: no write, delete or move call outside its self-test", () => {
  const py = fs.readFileSync(TOOL, "utf8");
  const live = py.slice(0, py.indexOf("# Self-test: hand-made files"));
  assert.ok(live.length > 1000, "self-test marker not found");
  for (const forbidden of ['"w"', '"wb"', '"a"', "os.remove", "os.unlink", "os.rename", "shutil", "subprocess"]) {
    assert.ok(!live.includes(forbidden), `the checking code must not use ${forbidden}`);
  }
});
