import React, { useContext, useState } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import DetailsPopover from "~/components/ambient/DetailsPopover";
import { AppContext } from "~/AppContext";
import {
  pickLocality, pickDistrict, pickCounty, pickRegion, placeLabelFromAddress,
} from "~/ui/placeLabel";
import styles from "./styles.css";

/**
 * Tap-for-details popover for the location chip — shared between
 * HeroBand (desktop hero band) and HeroCompact (Pi / mobile hero
 * slab). Reads the full LocationIQ reverse-geocode payload from
 * `AppContext.reverseGeoResult`; renders only the rows we have data
 * for so a sparsely-mapped point (e.g. a small village with no
 * postcode) doesn't show empty rows.
 *
 * Field selection rationale: surface the administrative hierarchy
 * the user already half-sees in the truncated `LocationName`
 * (locality / region / country) plus the two pieces LocationIQ
 * gives us for free that the truncated label can't fit (postcode,
 * precise coordinates). Country shows the ISO 3166-1 alpha-2 code
 * next to the country name so users can disambiguate when the
 * locality name is non-unique (Springfield…).
 *
 * It is also where a place gets PINNED to the favorites list (the
 * footer action). That belongs here rather than on the dock: the
 * popover is already scoped to "this location", so "remember this
 * one" is the same topic. Choosing a DIFFERENT place is a topic
 * change and lives on the dock's Places button instead — the
 * affordance rule from docs/rail-affordance-redesign-design.md.
 *
 * @param {object} props
 * @param {boolean} props.open Whether the popover is displayed;
 *   forwarded verbatim to `DetailsPopover`.
 * @param {() => void} props.onClose Invoked with no arguments when the
 *   user dismisses the popover (outside pointerdown, Esc, close
 *   button). The parent owns `open` and must set it false here.
 * @param {object} [props.triggerRef] React ref to the location chip
 *   that opens this popover. Used by `DetailsPopover` to position the
 *   portaled box and to exclude the chip from outside-click dismissal.
 * @param {"left"|"right"} [props.anchor] Edge of the trigger the
 *   popover aligns to; `"left"` (default here) makes it extend
 *   rightward.
 * @returns {JSX.Element} The portaled `DetailsPopover` shell. Its body
 *   is the address hierarchy from `AppContext.reverseGeoResult`
 *   (locality / district / county / region / country + ISO 3166-1
 *   alpha-2 / postcode), each row omitted when that field is absent,
 *   plus the marker coordinates as decimal degrees at 5 dp. When the
 *   reverse geocode is missing or has no `address`, only the
 *   coordinates and a "no address" note render. The pin-to-favorites
 *   footer is appended in both branches, and only on a local client
 *   with coords and a usable label. Always an element — the shell
 *   itself renders `null` while `open` is false.
 */
const LocationDetailsPopover = ({ open, onClose, triggerRef = null, anchor = "left" }) => {
  const {
    reverseGeoResult, mapGeo, isLocal,
    canPinFavorite, isFavoritePinned, pinFavorite,
  } = useContext(AppContext);
  const { t } = useTranslation();
  const [pinFailed, setPinFailed] = useState(false);

  const address = (reverseGeoResult && reverseGeoResult.address) || {};
  // LocationIQ keys vary by locality scale — a small place may expose
  // `village` / `hamlet` instead of `city`, urban points may carry
  // `suburb`. The fallback chains live in `~/ui/placeLabel` so this
  // component, the favorite auto-label below, and AppContext's capture of
  // the default location's name all answer "what is this place called" the
  // same way.
  const locality = pickLocality(address);
  const district = pickDistrict(address);
  const county = pickCounty(address);
  const region = pickRegion(address);
  const country = address.country || null;
  const countryCode = address.country_code
    ? address.country_code.toUpperCase()
    : null;
  const postcode = address.postcode || null;

  // Use the marker's current coords (mapGeo) rather than the address
  // payload's `res.lat` / `res.lon`, which LocationIQ snaps to the
  // nearest mapped feature (sometimes a few hundred meters off). The
  // user's mental model of "where am I looking?" matches the marker.
  const coordsStr = mapGeo
    ? `${mapGeo.latitude.toFixed(5)}, ${mapGeo.longitude.toFixed(5)}`
    : null;

  const noData = !reverseGeoResult || !reverseGeoResult.address;

  // Auto-label for a new favorite: the administrative name the user already
  // reads in the truncated hero label. Falls back to the coordinates so a
  // point over a lake or an unmapped field can still be pinned — the server
  // sanitizer drops label-less entries, so "no address" must not mean "no
  // label". Renaming afterwards is available on any local client; see the
  // Places popover and LLD §7.3 Rename — ungated.
  const autoLabel = placeLabelFromAddress(address) || coordsStr || null;

  const pinnedAlready = isFavoritePinned ? isFavoritePinned(mapGeo) : false;
  // Pinning writes settings.json, which is localhost-gated — a remote client
  // gets 403. Hide the action rather than offer a button that cannot work.
  const pinVisible = isLocal && !!mapGeo && !!autoLabel && typeof pinFavorite === "function";

  // Deliberately NO zoom capture (LLD §10 D-05, reversed 2026-08-17). The zoom
  // at pin time is an artefact of the pinning gesture — the user zooms IN to
  // place the pin precisely — not a statement about how they want to view the
  // place later. Restoring it on every jump fought the user instead of
  // helping them.
  const handlePin = () => {
    setPinFailed(false);
    pinFavorite({ label: autoLabel, lat: mapGeo.latitude, lon: mapGeo.longitude })
      .then((ok) => setPinFailed(!ok));
  };

  const pinFooter = pinVisible ? (
    <div className={styles.pinRow}>
      {pinnedAlready ? (
        <span className={styles.pinnedTag}>{t("favorites.pinned")}</span>
      ) : (
        <button
          type="button"
          className={styles.pinButton}
          onClick={handlePin}
          disabled={!canPinFavorite}
        >
          {t("favorites.pin")}
        </button>
      )}
      {!pinnedAlready && !canPinFavorite ? (
        <span className={styles.pinNote}>{t("favorites.full")}</span>
      ) : null}
      {pinFailed ? <span className={styles.pinError}>{t("favorites.saveFailed")}</span> : null}
    </div>
  ) : null;

  return (
    <DetailsPopover
      open={open}
      onClose={onClose}
      title={t("location.details")}
      anchor={anchor}
      triggerRef={triggerRef}
      portal
    >
      {noData ? (
        <div className={styles.empty}>
          {coordsStr ? (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>{t("location.coordinates")}</span>
              <span className={styles.detailValue}>{coordsStr}</span>
            </div>
          ) : null}
          <div className={styles.note}>{t("location.noAddress")}</div>
          {pinFooter}
        </div>
      ) : (
        <>
          {locality ? (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>{t("location.locality")}</span>
              <span className={styles.detailValue}>{locality}</span>
            </div>
          ) : null}
          {district ? (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>{t("location.district")}</span>
              <span className={styles.detailValue}>{district}</span>
            </div>
          ) : null}
          {county ? (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>{t("location.county")}</span>
              <span className={styles.detailValue}>{county}</span>
            </div>
          ) : null}
          {region ? (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>{t("location.region")}</span>
              <span className={styles.detailValue}>{region}</span>
            </div>
          ) : null}
          {country ? (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>{t("location.country")}</span>
              <span className={styles.detailValue}>
                {country}
                {countryCode ? <span className={styles.code}> ({countryCode})</span> : null}
              </span>
            </div>
          ) : null}
          {postcode ? (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>{t("location.postcode")}</span>
              <span className={styles.detailValue}>{postcode}</span>
            </div>
          ) : null}
          {coordsStr ? (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>{t("location.coordinates")}</span>
              <span className={styles.detailValue}>{coordsStr}</span>
            </div>
          ) : null}
          <div className={styles.source}>{t("location.source")}</div>
          {pinFooter}
        </>
      )}
    </DetailsPopover>
  );
};

LocationDetailsPopover.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  triggerRef: PropTypes.object,
  anchor: PropTypes.oneOf(["left", "right"]),
};

export default LocationDetailsPopover;
