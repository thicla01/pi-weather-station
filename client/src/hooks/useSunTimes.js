import { useState, useRef, useCallback, useEffect } from "react";
import axios from "axios";
import { NO_SUN_TIMES, createSunTimesFetcher } from "~/ui/sunTimes";

/**
 * Sun times for the place on the map: sunrise / sunset for today, plus the
 * full sunrise-sunset.org payloads for today and tomorrow.
 *
 * `updateSunriseSunset(coords)` asks `/api/sunrise-sunset`; AppContext's
 * hourly poller calls it (and so does a change of place, which restarts the
 * poller). A failed refresh keeps the values that still answer the same
 * place and local day, and is tried again after 30 s, 2 min and 5 min
 * instead of an hour later. The rules, and why, are in ui/sunTimes.js, which
 * holds the whole request / keep / retry logic; this hook only gives it
 * axios, React state and a cleanup.
 *
 * @returns {{
 *   sunriseTime: ?string,
 *   sunsetTime: ?string,
 *   sunriseSunsetToday: ?object,
 *   sunriseSunsetTomorrow: ?object,
 *   updateSunriseSunset: (coords: ?{latitude: number, longitude: number}) => Promise<object>
 * }} `sunriseTime` / `sunsetTime` are today's ISO strings, null while there
 *   are no times. The payloads keep the upstream keys (`sunrise`, `sunset`,
 *   `civil_twilight_begin`, `civil_twilight_end`, `day_length`, …) so
 *   SunDetailsPopover reads them as they are; tomorrow's is null when only
 *   that upstream call failed. `updateSunriseSunset` resolves with today's
 *   payload and rejects when the request fails or `coords` is missing.
 */
export function useSunTimes() {
  const [sun, setSun] = useState(NO_SUN_TIMES);
  const fetcherRef = useRef(null);

  useEffect(() => {
    const fetcher = createSunTimesFetcher({ get: (url) => axios.get(url), setSun });
    fetcherRef.current = fetcher;
    return () => {
      fetcher.dispose();
      fetcherRef.current = null;
    };
  }, []);

  const updateSunriseSunset = useCallback((coords) => {
    const fetcher = fetcherRef.current;
    if (!fetcher) return Promise.reject(new Error("Sun times are not ready"));
    return fetcher.request(coords);
  }, []);

  return {
    sunriseTime: sun.today ? sun.today.sunrise : null,
    sunsetTime: sun.today ? sun.today.sunset : null,
    sunriseSunsetToday: sun.today,
    sunriseSunsetTomorrow: sun.tomorrow,
    updateSunriseSunset,
  };
}
