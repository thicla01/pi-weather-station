import { useEffect, useState, useContext, useRef } from "react";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { AppActionsContext, SystemContext, LocationContext, UiPrefsContext } from "~/AppContext";

const REFRESH_INTERVAL = 15 * 60 * 1000;
// HTTP status + body `reason` of the server's "no Anthropic key" answer
// (aiSummaryCtrl SUMMARY_ERROR_REASON.NO_KEY). Kept in step by
// test/aiAvailability.test.js.
const NO_KEY_STATUS = 503;
const NO_KEY_REASON = "no-key";

/**
 * Whether a failed `/api/weather-summary` request means "this server has no
 * Anthropic key" — the one failure that switches the AI feature off
 * (AppContext's `aiSummaryAvailable`). Every other failure is transient: the
 * surface keeps what it shows and the next poll retries.
 *
 * Only a 503 qualifies. A 503 whose body has no `reason` comes from a server
 * that predates the field (e.g. the window between a `git pull` and the
 * service restart), so it keeps its old meaning; a 503 carrying any other
 * reason is treated as transient, because wrongly hiding a working feature
 * is the costly mistake, while polling a keyless server costs nothing (that
 * 503 is answered before any paid call). The server's "no weather data"
 * answer is a 502, so it never reaches this test.
 *
 * Shared with AiSummaryInline, which still duplicates the fetch itself.
 *
 * @param {{response?: {status?: number, data?: (string|{reason?: string})}}} err
 *   the rejection from the axios request
 * @returns {boolean} true when the server says no Anthropic key is configured
 */
export function isAiSummaryKeyMissing(err) {
  const response = err?.response;
  if (response?.status !== NO_KEY_STATUS) return false;
  const reason = response.data?.reason;
  return reason === undefined || reason === NO_KEY_REASON;
}

/**
 * Fetches + refreshes the Claude weather summary (the 3-paragraph string:
 * current conditions / forecast period / radar analysis). Extracted from
 * AiSummaryInline (the Phase-10 cleanup the slab's comment anticipated) so the
 * v3.3 AiView can reuse the exact fetch contract.
 *
 * Only fetches while mounted AND `available` AND awake — so mounting the AiView
 * lazily (on the user opening the IA view) means the paid Anthropic call fires
 * on demand, not as background overhead.
 *
 * `available` is AppContext's `aiSummaryAvailable`. It is normally settled
 * before this hook ever mounts — the boot settings read clears it when no
 * Anthropic key is configured (local raw value or remote masked boolean
 * alike), which also hides the dock's IA button — so the no-key 503 handling
 * below is the authoritative fallback (a settings.json edited after boot, or
 * a boot settings read that failed), not the primary way the client learns
 * there is no key.
 *
 * @returns {{ summary: string|null, available: boolean, lang: "en"|"fr"|"es",
 *   period: "evening"|"overnight"|"tomorrow"|null, errored: boolean }} the raw
 *   summary, the availability flag, the resolved language, the forecast-paragraph
 *   period kind (server-derived, titles the "next period" section), and whether
 *   the last fetch failed for any reason other than "no Anthropic key".
 */
export default function useAiSummary() {
  const { mapGeo } = useContext(LocationContext);
  const {
    aiSummaryAvailable: serverAvailable,
    tempUnit,
    speedUnit,
    distanceUnit,
  } = useContext(UiPrefsContext);
  const { setAiSummaryAvailable: setAvailable } = useContext(AppActionsContext);
  const { sleepStage } = useContext(SystemContext);
  const { i18n } = useTranslation();
  const lang = ["fr", "es"].find((l) => i18n.language.startsWith(l)) || "en";
  // Gate on the server-driven key only, NOT `aiSummaryUserVisible` (the v2
  // "hide the inline section" debug toggle): opening the AiView is a deliberate
  // act, and that toggle persists to localStorage, so a stale `false` from v2
  // poking would otherwise stop the view from ever fetching.
  const available = serverAvailable;
  const [summary, setSummary] = useState(null);
  // Forecast-paragraph period kind ("evening"/"overnight"/"tomorrow"), derived
  // server-side from the local hour + data availability — kept alongside the
  // summary so the AiView can title the second section with the real period.
  const [period, setPeriod] = useState(null);
  // Set when a fetch fails for any reason OTHER than "no Anthropic key" (500 /
  // 502 incl. no weather data / 429 / network / timeout) so AiView can fall
  // back to "unavailable" instead of a permanent loading caption when no
  // summary is on screen yet; cleared on the next success.
  const [errored, setErrored] = useState(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    // Suspend polling while the screensaver is up (nothing visible) — re-runs
    // on wake so the summary is fresh by the time the overlay fades.
    if (!mapGeo || !available || sleepStage > 0) return undefined;

    // Cancellation flag: a slow build keyed to the previous position can
    // resolve after a pan and show the OLD location's narrative. Same pattern
    // as AppContext's AQI / pollen effects.
    let cancelled = false;
    const fetchSummary = () => {
      const now = new Date();
      const localHour = now.getHours();
      const ts18 = new Date(now); ts18.setHours(18, 0, 0, 0);
      const ts21 = new Date(now); ts21.setHours(21, 0, 0, 0);
      const ts05tomorrow = new Date(now);
      ts05tomorrow.setDate(ts05tomorrow.getDate() + 1);
      ts05tomorrow.setHours(5, 0, 0, 0);

      const params = new URLSearchParams({
        lat: mapGeo.latitude,
        lon: mapGeo.longitude,
        lang,
        localHour,
        ts18: ts18.getTime(),
        ts21: ts21.getTime(),
        ts05tomorrow: ts05tomorrow.getTime(),
        tempUnit,
        speedUnit,
        distanceUnit,
      });

      axios
        .get(`/api/weather-summary?${params}`)
        .then((res) => {
          if (cancelled) return;
          setSummary(res.data.summary);
          setPeriod(res.data.period ?? null);
          setErrored(false);
        })
        .catch((err) => {
          if (cancelled) return;
          // No Anthropic key server-side → mark unavailable; authoritative
          // over the boot settings read, which never re-enables what this
          // switched off. Any other error (incl. the transient "no weather
          // data" 502) flags `errored` so AiView falls back from the loading
          // caption to "unavailable" when nothing is shown yet; an
          // already-displayed summary stays on screen and the next poll
          // retries.
          if (isAiSummaryKeyMissing(err)) setAvailable(false);
          else setErrored(true);
        });
    };

    fetchSummary();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchSummary, REFRESH_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(intervalRef.current);
    };
  }, [mapGeo, lang, available, setAvailable, tempUnit, speedUnit, distanceUnit, sleepStage]);

  return { summary, available, lang, period, errored };
}
