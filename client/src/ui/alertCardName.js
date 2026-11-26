// The accessible name of the compact gov-alert card on the 7" rail's v3.3
// priority glance (ambient/AlertBanner, the whole card one `<button>`): the
// level (the chip's full product word), the source, the title, and, when
// more than one alert is eligible, "1 of N". With a single alert the count
// says nothing, and the card's passive "1 / N" indicator is not shown
// either, so the name leaves it out. One threshold for both, COUNTED_FROM
// below: AlertBanner's `hasOthers`, which shows the indicators, is computed
// from it.
//
// MODULE FORMAT: CommonJS on purpose, like ui/alertTitle.js, so
// test/alertCardName.test.js runs the real module under `node --test`,
// against the real locale strings.

/**
 * From this many eligible gov alerts, the alert is counted: the compact
 * card's name carries "current of count", and AlertBanner's `hasOthers`
 * (the passive "1 / N" indicator, the cycle counter) holds.
 */
const COUNTED_FROM = 2;

/**
 * The compact alert card's accessible name (see the header).
 *
 * @param {function(string, object): string} t - i18next's `t`.
 * @param {object} parts - What the name says.
 * @param {string} parts.level - The chip's full product word, translated (`alert.severity*`).
 * @param {string} parts.source - The source badge's text (ECCC, NWS).
 * @param {string} parts.title - The title the card shows (alertDisplayTitle).
 * @param {number} parts.current - The shown alert's 1-based place among the eligible ones.
 * @param {number} parts.count - How many gov alerts are eligible.
 * @returns {string} The name: `alert.compactCardAria` with the count, `alert.compactCardAriaSingle` without.
 */
function compactAlertCardName(t, { level, source, title, current, count }) {
  if (count >= COUNTED_FROM) {
    return t("alert.compactCardAria", { level, source, title, current, count });
  }
  return t("alert.compactCardAriaSingle", { level, source, title });
}

module.exports = {
  COUNTED_FROM,
  compactAlertCardName,
};
