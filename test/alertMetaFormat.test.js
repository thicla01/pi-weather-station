// Regression tests for the alert banner's meta-chip labels in
// `client/src/ui/alertMetaFormat.js` ("Issued N min ago", "Expires …").
// Both helpers take the current time as an argument: compiled by the React
// Compiler, AlertMetaChips used to keep its first "Issued … ago" label while
// the helpers read the clock themselves (cached on [sentAt, t]). The module
// is CommonJS so these tests exercise the real code. Run: `npm test`.
//
// Times are built in local time (`new Date(y, m, d, h, min)`), so the
// same-day / next-day checks hold in any time zone the suite runs in.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  ISSUED_AHEAD_TOLERANCE_MS,
  formatIssued,
  formatExpires,
} = require("../client/src/ui/alertMetaFormat");

// i18next stand-in: echoes the key and its interpolation bag.
const t = (key, opts) => (opts ? `${key} ${JSON.stringify(opts)}` : key);

const MIN = 60 * 1000;
const at = (h, min, day = 19) => new Date(2026, 9, day, h, min);
const iso = (d) => d.toISOString();

test("formatIssued: just issued, minutes, hours, then days", () => {
  const sent = at(10, 0);
  const now = sent.getTime();
  assert.equal(formatIssued(iso(sent), t, now), "alert.issuedJustNow");
  assert.equal(formatIssued(iso(sent), t, now + 20 * 1000), "alert.issuedJustNow");
  assert.equal(formatIssued(iso(sent), t, now + 5 * MIN), 'alert.issuedMinutesAgo {"minutes":5}');
  assert.equal(formatIssued(iso(sent), t, now + 59 * MIN), 'alert.issuedMinutesAgo {"minutes":59}');
  assert.equal(formatIssued(iso(sent), t, now + 60 * MIN), 'alert.issuedHoursAgo {"hours":1}');
  assert.equal(formatIssued(iso(sent), t, now + 35 * 60 * MIN), 'alert.issuedHoursAgo {"hours":35}');
  assert.equal(formatIssued(iso(sent), t, now + 48 * 60 * MIN), 'alert.issuedDaysAgo {"days":2}');
});

test("formatIssued follows the clock it is given (the label advances with `now`)", () => {
  const sent = iso(at(10, 0));
  const labels = [5, 6, 7].map((m) => formatIssued(sent, t, at(10, m).getTime()));
  assert.deepEqual(labels, [
    'alert.issuedMinutesAgo {"minutes":5}',
    'alert.issuedMinutesAgo {"minutes":6}',
    'alert.issuedMinutesAgo {"minutes":7}',
  ]);
});

test("formatIssued: an issue time up to a minute ahead of `now` reads as just issued, further ahead drops the chip", () => {
  assert.equal(ISSUED_AHEAD_TOLERANCE_MS, 60 * 1000);
  const now = at(10, 0).getTime();
  assert.equal(formatIssued(iso(new Date(now + 30 * 1000)), t, now), "alert.issuedJustNow");
  assert.equal(formatIssued(iso(new Date(now + ISSUED_AHEAD_TOLERANCE_MS)), t, now), "alert.issuedJustNow");
  assert.equal(formatIssued(iso(new Date(now + 2 * MIN)), t, now), null);
});

test("formatIssued: missing or unparseable sentAt gives null", () => {
  const now = at(10, 0).getTime();
  assert.equal(formatIssued(null, t, now), null);
  assert.equal(formatIssued("", t, now), null);
  assert.equal(formatIssued("not a date", t, now), null);
});

test("formatExpires: same day, tomorrow, then the weekday", () => {
  const hhmm = (d) => d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  const now = at(10, 0).getTime();
  const sameDay = at(18, 30);
  const nextDay = at(8, 0, 20);
  const later = at(9, 15, 22);
  assert.equal(formatExpires(iso(sameDay), "en", t, now), hhmm(sameDay));
  assert.equal(formatExpires(iso(nextDay), "en", t, now), `alert.tomorrowShort ${hhmm(nextDay)}`);
  const weekday = later.toLocaleDateString("en-US", { weekday: "short" });
  assert.equal(formatExpires(iso(later), "en", t, now), `${weekday} ${hhmm(later)}`);
});

test("formatExpires: 'tomorrow' becomes the plain time once `now` passes midnight", () => {
  const expires = iso(at(8, 0, 20));
  const before = formatExpires(expires, "en", t, at(23, 59).getTime());
  const after = formatExpires(expires, "en", t, at(0, 1, 20).getTime());
  assert.match(before, /^alert\.tomorrowShort /);
  assert.equal(after, before.replace("alert.tomorrowShort ", ""));
});

test("formatExpires: missing or unparseable expiresAt gives null", () => {
  const now = at(10, 0).getTime();
  assert.equal(formatExpires(null, "fr", t, now), null);
  assert.equal(formatExpires("nope", "fr", t, now), null);
});
