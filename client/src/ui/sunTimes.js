// Sun times (sunrise / sunset for today and tomorrow) — the request, what a
// failed refresh does to the values on screen, and when to try again.
//
// The page asks `/api/sunrise-sunset` with the hourly poller. Two rules live
// here, both learned on the Pi 3B bench (2026-11-19: day palette at midnight
// after a kiosk relaunch whose first requests failed):
//
//   1. A failed refresh keeps the values on screen when they answer the SAME
//      question — same place, same local day. They are still right. Before,
//      any failure erased them, and without sun times the automatic dark mode
//      does nothing, the hero loses its day / night glyph and the sun rows go
//      blank, until the next hourly tick. Values for another place or another
//      day are dropped, as before: they would be wrong, not just old.
//
//   2. A failed request is tried again after SUN_RETRY_DELAYS_MS (30 s, 2 min,
//      5 min) instead of an hour later. After the third retry the hourly
//      poller takes over again; each of its requests starts a new series.
//
// `createSunTimesFetcher` holds that small state machine with its I/O
// injected (HTTP get, state setter, clock, timers), so
// test/sunTimes.test.js runs every path without React or a network.
// hooks/useSunTimes.js is the thin React side.
//
// MODULE FORMAT: CommonJS on purpose, like ui/radarFrameStack.js, so the
// test runs the real code. Webpack imports it into the ESM client.

/** Delays before the 1st, 2nd and 3rd retry of a failed sun-times request. */
const SUN_RETRY_DELAYS_MS = Object.freeze([30_000, 2 * 60_000, 5 * 60_000]);

/**
 * "No sun times": `key` is the question the values answer (place + local
 * day), `today` / `tomorrow` the sunrise-sunset.org payloads.
 */
const NO_SUN_TIMES = Object.freeze({ key: null, today: null, tomorrow: null });

/**
 * A date's LOCAL calendar day. The request names the user's day, not
 * "today UTC": west of UTC in the evening that is already tomorrow, and the
 * answer would skip today's sunset.
 *
 * @param {Date} date - The moment to name.
 * @returns {string} `YYYY-MM-DD` in the local time zone.
 */
function localDateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The question a sun-times request asks: which place, which local day.
 * Coordinates are compared to 4 decimals (about 11 m).
 *
 * @param {{latitude: number, longitude: number}} coords - The place.
 * @param {Date} date - The moment of the request.
 * @returns {string} A key equal for two requests about the same place and day.
 */
function sunRequestKey(coords, date) {
  return `${Number(coords.latitude).toFixed(4)},${Number(coords.longitude).toFixed(4)}@${localDateKey(date)}`;
}

/**
 * Same-origin URL of the request: today's times plus tomorrow's.
 *
 * @param {{latitude: number, longitude: number}} coords - The place.
 * @param {Date} date - The moment of the request.
 * @returns {string} The `/api/sunrise-sunset` URL.
 */
function sunTimesUrl(coords, date) {
  return `/api/sunrise-sunset?lat=${coords.latitude}&lon=${coords.longitude}&date=${localDateKey(date)}&tomorrow=1`;
}

/**
 * Delay before the next retry.
 *
 * @param {number} failedTries - Failed tries so far in this series, the
 *   one that just failed not counted (0 after the first failure).
 * @returns {?number} Milliseconds to wait, or null when the series is over.
 */
function sunRetryDelay(failedTries) {
  return failedTries < SUN_RETRY_DELAYS_MS.length ? SUN_RETRY_DELAYS_MS[failedTries] : null;
}

/**
 * Build the sun-times fetcher.
 *
 * @param {object} io - Injected I/O.
 * @param {(url: string) => Promise<{data: object}>} io.get - HTTP GET
 *   (axios in the app).
 * @param {(next: object | ((held: object) => object)) => void} io.setSun -
 *   State setter with React's `setState` shape; receives a
 *   `{ key, today, tomorrow }` value or an updater of the held one.
 * @param {() => Date} [io.now] - Clock.
 * @param {(fn: () => void, ms: number) => unknown} [io.setTimer] - `setTimeout`.
 * @param {(id: unknown) => void} [io.clearTimer] - `clearTimeout`.
 * @returns {{request: (coords: ?object) => Promise<object>, dispose: () => void}}
 *   `request` asks for a place's sun times: it resolves with today's payload
 *   and rejects when the request fails, the answer carries no times, or
 *   `coords` is missing (a newer request makes an older one resolve with
 *   null, its answer ignored). It cancels a pending retry and starts a new
 *   retry series. `dispose` cancels the pending retry and makes late answers
 *   harmless (unmount).
 */
function createSunTimesFetcher({
  get,
  setSun,
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let latest = 0;       // the newest request owns the state
  let retry = null;     // pending retry timer
  let failedTries = 0;  // failures in a row in the current series

  const run = (coords, isRetry) => {
    clearTimer(retry);
    retry = null;
    latest += 1;
    const mine = latest;
    if (!isRetry) failedTries = 0;
    if (!coords) {
      setSun(NO_SUN_TIMES);
      return Promise.reject(new Error("No coords"));
    }
    const date = now();
    const key = sunRequestKey(coords, date);

    const onFailure = () => {
      // Rule 1: keep what still answers this question, drop the rest.
      setSun((held) => (held.key === key ? held : NO_SUN_TIMES));
      // Rule 2: try again soon.
      const delay = sunRetryDelay(failedTries);
      failedTries += 1;
      if (delay !== null) {
        retry = setTimer(() => {
          run(coords, true).catch(() => undefined);
        }, delay);
      }
    };

    return get(sunTimesUrl(coords, date)).then(
      (res) => {
        if (mine !== latest) return null;
        const { results, tomorrowResults } = (res && res.data) || {};
        if (!results) {
          onFailure();
          throw new Error("No sun times in the answer");
        }
        failedTries = 0;
        // `tomorrowResults` is absent when only the server's second upstream
        // call failed; that is not a failure of the request.
        setSun({ key, today: results, tomorrow: tomorrowResults || null });
        return results;
      },
      (err) => {
        if (mine === latest) onFailure();
        throw err;
      },
    );
  };

  return {
    request: (coords) => run(coords, false),
    dispose: () => {
      clearTimer(retry);
      retry = null;
      latest += 1;
    },
  };
}

module.exports = {
  SUN_RETRY_DELAYS_MS,
  NO_SUN_TIMES,
  localDateKey,
  sunRequestKey,
  sunTimesUrl,
  sunRetryDelay,
  createSunTimesFetcher,
};
