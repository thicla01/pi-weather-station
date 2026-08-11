import React, { useContext } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import DetailsPopover from "~/components/ambient/DetailsPopover";
import { AppContext } from "~/AppContext";
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
 * @param {object} props
 * @param {boolean} props.open
 * @param {Function} props.onClose
 * @param {object} [props.triggerRef]
 * @param {"left"|"right"} [props.anchor]
 * @returns {JSX.Element} popover shell with reverse-geocode details
 */
const LocationDetailsPopover = ({ open, onClose, triggerRef = null, anchor = "left" }) => {
  const { reverseGeoResult, mapGeo } = useContext(AppContext);
  const { t } = useTranslation();

  const address = (reverseGeoResult && reverseGeoResult.address) || {};
  // LocationIQ keys vary by locality scale — a small place may expose
  // `village` / `hamlet` instead of `city`, urban points may carry
  // `suburb`. Pick the most specific available for each row.
  const locality = address.city
    || address.town
    || address.village
    || address.hamlet
    || address.municipality
    || null;
  const district = address.suburb
    || address.neighbourhood
    || address.quarter
    || null;
  const county = address.county || address.state_district || null;
  const region = address.state || address.region || null;
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
