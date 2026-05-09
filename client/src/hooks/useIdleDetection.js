import { useEffect, useRef, useState } from "react";

/**
 * Idle-detection hook for the screensaver / sleep mode feature. Tracks the
 * timestamp of the user's last interaction with the page and exposes a
 * three-state stage value:
 *   - 0  active / awake
 *   - 1  idle past stage1Delay minutes (screensaver visible, brightness dimmed)
 *   - 2  deep idle past stage1Delay + stage2Delay minutes (black screen with
 *        anti-burn-in dot at brightness floor)
 *
 * The hook is a no-op when `enabled` is false — no listeners, no interval,
 * stage stays at 0. Flipping `enabled` on/off mid-session attaches and
 * detaches cleanly.
 *
 * Activity counts as: pointermove, pointerdown, touchstart, keydown, wheel.
 * Programmatic state changes (data refreshes, polling, etc.) do NOT count —
 * the hook listens only on user-input events. Mouse jiggle from a flaky
 * touchscreen could in principle keep the kiosk awake forever; in practice
 * the touchscreens this is targeting are idle when nobody is in the room,
 * so this isn't worth defending against here.
 *
 * @param {object} opts
 * @param {boolean} opts.enabled Master toggle. False → stage stays 0.
 * @param {number} opts.stage1Delay Minutes of inactivity before stage 1
 * @param {boolean} opts.stage2Enabled Whether to ever enter stage 2
 * @param {number} opts.stage2Delay Minutes after stage 1 before stage 2
 * @returns {object} `{ stage }` — current 0/1/2 stage value
 */
export default function useIdleDetection({
  enabled,
  stage1Delay,
  stage2Enabled,
  stage2Delay,
}) {
  const [stage, setStage] = useState(0);
  // Last activity timestamp lives in a ref so listeners can update it
  // without triggering a re-render on every mouse twitch (we only care
  // about the threshold crossings, evaluated by the interval below).
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    if (!enabled) {
      // Stay at stage 0 and skip all the listeners / interval. Cleaner
      // than running them and short-circuiting in the interval body.
      setStage(0);
      return undefined;
    }

    const markActive = () => {
      lastActivityRef.current = Date.now();
      // Optimistic instant wakeup — don't wait for the next interval tick
      // to flip stage back to 0. The interval still arbitrates the
      // 0 → 1 → 2 direction.
      setStage((current) => (current === 0 ? current : 0));
    };

    const events = ["pointermove", "pointerdown", "touchstart", "keydown", "wheel"];
    events.forEach((evt) => {
      window.addEventListener(evt, markActive, { passive: true });
    });

    const stage1Ms = stage1Delay * 60 * 1000;
    const stage2Ms = stage2Delay * 60 * 1000;
    // 1 s tick is plenty — minutes-scale thresholds, no need to be precise
    // to the millisecond. Using a longer interval (e.g. 5 s) would make
    // the wake-up feel slightly sluggish even though markActive flips
    // the state directly; users tolerate a 1 s falling-asleep delay
    // better than a 5 s one.
    const interval = setInterval(() => {
      const idleFor = Date.now() - lastActivityRef.current;
      let next;
      if (stage2Enabled && idleFor >= stage1Ms + stage2Ms) {
        next = 2;
      } else if (idleFor >= stage1Ms) {
        next = 1;
      } else {
        next = 0;
      }
      setStage((prev) => (prev === next ? prev : next));
    }, 1000);

    return () => {
      events.forEach((evt) => {
        window.removeEventListener(evt, markActive);
      });
      clearInterval(interval);
    };
  }, [enabled, stage1Delay, stage2Enabled, stage2Delay]);

  return { stage };
}
