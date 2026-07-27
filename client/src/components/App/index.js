import React, { useEffect, useContext, useRef } from "react";
import axios from "axios";
import styles from "./styles.css";
import { AppActionsContext, UiPrefsContext, SystemContext } from "~/AppContext";

import AmbientLayers from "~/components/AmbientLayers";
import AmbientSettingsPanel from "~/components/ambient/SettingsPanel";
import AmbientDebugPanel from "~/components/ambient/DebugPanel";
import UpdateModal from "~/components/UpdateModal";
import ScreenSaver from "~/components/ScreenSaver";
import {
  nextRestoreAction,
  RESTORE_MAX_ATTEMPTS,
  RESTORE_SETTLE_MS,
} from "~/services/brightnessRestore";

import "!style-loader!css-loader!./overrides.css";

/**
 * Main component
 *
 * @returns {JSX.Element} Main component
 */
const App = () => {
  const {
    getBrowserGeo,
    getCustomLatLon,
    loadStoredData,
    checkIsLocal,
  } = useContext(AppActionsContext);
  const { mouseHide } = useContext(UiPrefsContext);
  // App is the provider's stable child, so it re-renders ONLY through
  // its context subscriptions. Subscribing to the cold slices (and not
  // the legacy union, which re-mints on every slice change) is what
  // cuts the app-wide cascade at the root: radar/weather/alert/location
  // updates no longer re-render App — and therefore no longer re-render
  // the whole tree below it (context-split step 2c).
  const {
    sleepStage1Brightness,
    sleepStage: stage,
    brightnessAvailable,
    brightnessPercent,
    brightnessMinPercent,
  } = useContext(SystemContext);

  // `stage` (0/1/2) now comes from AppContext — the underlying
  // `useIdleDetection` call lives there since v2.18.2 so background
  // pollers (AiSummary, AiSummaryInline) can suspend on sleep without
  // prop-drilling through AmbientLayers.

  // Hardware-brightness orchestration on stage transitions.
  //
  // Entering stage 1 → save the user's current brightness, apply the
  //   sleep-mode dim level (POST /api/brightness).
  // Entering stage 2 → drop further to the hardware floor.
  // Returning to stage 0 → restore the saved value.
  //
  // The save/restore pair is wrapped in a ref so React's state updates
  // (which would otherwise race with the API call) don't interfere. Calls
  // are best-effort: failure (HDMI monitor, no backlight driver, write
  // permission missing) is silently ignored — the screensaver visual
  // still renders correctly without the hardware dim.
  const brightnessBeforeSleepRef = useRef(null);
  useEffect(() => {
    if (!brightnessAvailable) return undefined;

    if (stage === 1) {
      // Capture the current value once on entry into stage 1, then
      // dim. If the user changes brightness while stage 1 is active
      // (e.g. by swiping in from a wake event), we deliberately don't
      // re-capture — restoring on wake puts us back to whatever was
      // active at sleep onset, which is the principle-of-least-surprise
      // behaviour.
      if (brightnessBeforeSleepRef.current === null) {
        brightnessBeforeSleepRef.current = brightnessPercent;
      }
      axios.post("/api/brightness", { percent: sleepStage1Brightness })
        .catch(() => undefined);
      return undefined;
    }

    if (stage === 2) {
      // Stage 2 always writes brightness 0 with allowOff: true so the
      // server bypasses its 10 % MIN_PERCENT floor. On panels that
      // honour 0, the backlight goes fully off (cleanest anti-burn-in
      // and bleed mitigation). On panels whose driver clamps internally
      // (some industrial all-in-ones, e.g. ED-HMI3010), the hardware
      // floor takes over — same end result either way, no user knob is
      // useful in between because the floor is hardware-bound. Earlier
      // iteration exposed a `sleepStage2Brightness` slider; field
      // testing showed it added UI clutter without buying anything, so
      // it was removed.
      axios.post("/api/brightness", { percent: 0, allowOff: true })
        .catch(() => undefined);
      return undefined;
    }

    // stage 0 — wake. Nothing to do if we never dimmed.
    if (brightnessBeforeSleepRef.current === null) return undefined;
    const restoreTo = brightnessBeforeSleepRef.current;
    brightnessBeforeSleepRef.current = null;

    // Restore the pre-sleep brightness, then VERIFY it actually landed on
    // the hardware and retry a bounded number of times if the screen is
    // still dark. The wake-restore write is otherwise best-effort and can
    // silently fail to take effect — most often an ED-MONITOR DDC/CI i2c
    // timeout (the write 504s and the client swallows it) — which used to
    // leave the panel stuck at the stage-2 value (0 = black) with no
    // on-screen way back. Bounded by RESTORE_MAX_ATTEMPTS so a panel that
    // genuinely can't reach the target never loops forever. See
    // `services/brightnessRestore.js`.
    let cancelled = false;
    const settle = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
    (async () => {
      for (let attempt = 1; attempt <= RESTORE_MAX_ATTEMPTS; attempt++) {
        if (cancelled) return;
        await axios.post("/api/brightness", { percent: restoreTo }).catch(() => undefined);
        await settle(RESTORE_SETTLE_MS);
        if (cancelled) return;
        const observed = await axios.get("/api/brightness")
          .then((res) => (res.data?.available ? res.data.percent : null))
          .catch(() => null);
        const action = nextRestoreAction({ target: restoreTo, observed, attemptsMade: attempt });
        if (action === "done") return;
        if (action === "giveup") {
          if (typeof observed === "number") {
            console.warn(
              `[brightness] wake-restore gave up after ${attempt} attempt(s): ` +
              `asked ${restoreTo}%, screen still at ${observed}%`
            );
          }
          return;
        }
        // action === "retry" → loop and write again.
      }
    })();

    // A new stage transition (idle again, or user interaction) cancels an
    // in-flight retry loop so we never fight the newer brightness state.
    return () => { cancelled = true; };
    // brightnessPercent intentionally NOT in the deps — it's read once via
    // the ref on stage-1 entry; including it would re-trigger the dim API
    // call every time the user nudged the brightness slider.
  }, [stage, brightnessAvailable, sleepStage1Brightness, brightnessMinPercent]); // eslint-disable-line react-hooks/exhaustive-deps -- brightnessPercent intentionally omitted, see comment above

  useEffect(() => {
    getCustomLatLon();
    getBrowserGeo();
    loadStoredData();
    checkIsLocal();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- initialization, runs once on mount

  return (
    <div className={mouseHide ? styles.hideMouse : ""}>
      {/* Settings + Debug overlays are siblings of AmbientLayers (not
          children) so they can cover the whole surface; both compute
          their own palette tokens because CSS custom properties don't
          propagate to siblings. */}
      <div className={styles.settingsContainer}>
        <AmbientSettingsPanel />
        <AmbientDebugPanel />
      </div>
      <UpdateModal />
      <AmbientLayers />
      {/* Sleep-mode overlay — rendered outside the ambient tree so it
          covers everything (settings, debug, layout) when active.
          Stage 0 = unmounted entirely. */}
      <ScreenSaver stage={stage} />
    </div>
  );
};

export default App;
