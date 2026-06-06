// Regression tests for `detectSenseHatHardware` in server/sensehatModeCtrl.js.
//
// The bug these guard against: the original availability probe ran
// `python3 -c "import sense_hat"`, which checks the MODULE not the HARDWARE.
// The `sense_hat` package imports fine on any host where it's apt-installed
// (deploy/install.sh installs it during setup) even with no HAT attached, so
// the Settings panel rendered the Sense HAT block on HAT-less Pis. The fix
// scans sysfs for the LED-matrix framebuffer (name/driver contains "sense")
// and deliberately excludes the /dev/fb0 fallback the daemon uses, because
// fb0 is the HDMI/DSI framebuffer present on every Pi.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { detectSenseHatHardware, detectSenseHatVersion } = require("../server/sensehatModeCtrl").__test;

// Build a fake /sys/class/graphics tree under a temp dir.
// spec: { fbName: { name?: string, driver?: string } }
function makeGraphicsDir(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sensehat-sysfs-"));
  for (const [fb, cfg] of Object.entries(spec)) {
    const base = path.join(root, fb);
    fs.mkdirSync(base, { recursive: true });
    if (cfg.name !== undefined) fs.writeFileSync(path.join(base, "name"), cfg.name);
    if (cfg.driver !== undefined) {
      const devDir = path.join(base, "device");
      fs.mkdirSync(devDir, { recursive: true });
      // Mirror sysfs: device/driver is a symlink whose basename is the driver.
      const driverTarget = path.join(root, "_drivers", cfg.driver);
      fs.mkdirSync(driverTarget, { recursive: true });
      fs.symlinkSync(driverTarget, path.join(devDir, "driver"));
    }
  }
  return root;
}

test("detects the HAT by framebuffer name (RPi-Sense FB)", () => {
  const dir = makeGraphicsDir({ fb0: { name: "RPi-Sense FB\n" } });
  assert.equal(detectSenseHatHardware(dir), true);
});

test("detects the HAT by driver symlink (rpisense-fb)", () => {
  const dir = makeGraphicsDir({ fb1: { name: "soft\n", driver: "rpisense-fb" } });
  assert.equal(detectSenseHatHardware(dir), true);
});

test("HAT alongside the HDMI framebuffer is still detected", () => {
  const dir = makeGraphicsDir({
    fb0: { name: "BCM2708 FB\n" },     // HDMI/DSI — must not, on its own, count
    fb1: { name: "RPi-Sense FB\n" },   // the actual HAT
  });
  assert.equal(detectSenseHatHardware(dir), true);
});

test("no HAT: only the HDMI framebuffer → false (the core regression)", () => {
  // This is the exact HAT-less-Pi case the old `import sense_hat` probe
  // got wrong. fb0 exists on every Pi with a display; it must NOT count.
  const dir = makeGraphicsDir({ fb0: { name: "BCM2708 FB\n", driver: "vc4-drm" } });
  assert.equal(detectSenseHatHardware(dir), false);
});

test("no sysfs (non-Linux dev host) → false", () => {
  assert.equal(detectSenseHatHardware(path.join(os.tmpdir(), "does-not-exist-xyz")), false);
});

test("ignores entries whose name doesn't start with 'fb'", () => {
  // A non-fb sysfs entry (e.g. "console") must not be scanned, even if it
  // somehow carries a "sense"-bearing name file.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sensehat-sysfs-"));
  fs.mkdirSync(path.join(root, "console"), { recursive: true });
  fs.writeFileSync(path.join(root, "console", "name"), "RPi-Sense FB\n");
  assert.equal(detectSenseHatHardware(root), false);
});

// === detectSenseHatVersion: HAT board revision from the ID-EEPROM ===
// Confirmed empirically across the fleet: v1 product_ver=0x0001, v2=0x0002.
// The device-tree node stores the value as a NUL-terminated ASCII hex string.

function writeProductVer(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sensehat-hat-"));
  const p = path.join(dir, "product_ver");
  fs.writeFileSync(p, content);
  return p;
}

test("detectSenseHatVersion: 0x0001 → v1", () => {
  assert.equal(detectSenseHatVersion(writeProductVer("0x0001\0")), "v1");
});

test("detectSenseHatVersion: 0x0002 → v2", () => {
  assert.equal(detectSenseHatVersion(writeProductVer("0x0002\0")), "v2");
});

test("detectSenseHatVersion: unrecognised revision surfaces the raw value", () => {
  assert.equal(detectSenseHatVersion(writeProductVer("0x0003\0")), "0x0003");
});

test("detectSenseHatVersion: no HAT EEPROM (missing file) → null", () => {
  assert.equal(detectSenseHatVersion(path.join(os.tmpdir(), "no-such-product_ver")), null);
});
