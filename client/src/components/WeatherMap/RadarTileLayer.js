import PropTypes from "prop-types";
import L from "leaflet";
import {
  createElementObject,
  createTileLayerComponent,
  updateGridLayer,
  withPane,
} from "@react-leaflet/core";

import { RADAR_TILE_MAX_RETRIES, createTileCooldown } from "~/ui/radarTileCooldown";

// One registry for every radar layer on the page: a URL refused for one
// frame layer must not be requested by another (the slot retargeted onto
// the same frame on the next loop pass).
const cooldown = createTileCooldown();

/**
 * Leaflet TileLayer for RainViewer radar frames whose tiles honour the
 * shared cooldown (ui/radarTileCooldown.js): a tile URL that failed is not
 * requested again until its hold ends, and a failed tile is retried once
 * the hold ends rather than after a short fixed delay. Leaflet itself does
 * not re-request a failed tile it still holds; it re-creates one only after
 * pruning it (a pan out of the keepBuffer and back, a zoom), which this
 * layer's createTile then holds too.
 */
const CooldownTileLayer = L.TileLayer.extend({
  initialize(url, options) {
    L.TileLayer.prototype.initialize.call(this, url, options);
    this.on("tileerror", this._holdAndRetry, this);
  },

  // Leaflet 1.9.4's TileLayer#createTile (this layer sets no crossOrigin
  // or referrerPolicy), except that a URL still on hold gets its src only
  // when the hold ends. The timer is not tied to the layer: it does
  // nothing once the tile has left the document (layer removed, tile
  // pruned, slot retargeted) or already has a src.
  createTile(coords, done) {
    const tile = document.createElement("img");
    L.DomEvent.on(tile, "load", L.Util.bind(this._tileOnLoad, this, done, tile));
    L.DomEvent.on(tile, "error", L.Util.bind(this._tileOnError, this, done, tile));
    tile.alt = "";
    const url = this.getTileUrl(coords);
    const wait = cooldown.remaining(url);
    if (wait > 0) {
      setTimeout(() => {
        if (tile.isConnected && !tile.getAttribute("src")) tile.src = url;
      }, wait);
    } else {
      tile.src = url;
    }
    return tile;
  },

  // Puts the failed URL on hold and retries the same tile, with the exact
  // URL that failed, when the hold ends (rebuilding it with getTileUrl
  // would use the layer's current zoom). Same detached / retargeted guard
  // as above: a removed tile gets an empty-image src from Leaflet.
  _holdAndRetry({ tile }) {
    const url = tile.getAttribute("src");
    if (!url) return;
    cooldown.markFailed(url);
    const attempt = Number(tile.dataset.retries || 0);
    if (attempt >= RADAR_TILE_MAX_RETRIES) return;
    tile.dataset.retries = String(attempt + 1);
    setTimeout(() => {
      if (tile.isConnected && tile.getAttribute("src") === url) tile.src = url;
    }, cooldown.remaining(url));
  },
});

/**
 * Creates the Leaflet layer for a RadarTileLayer element (react-leaflet's
 * own TileLayer factory, with the cooldown-aware class).
 *
 * @param {object} props - Component props: `url` plus Leaflet TileLayer options.
 * @param {string} props.url - Tile URL template of the frame.
 * @param {object} context - react-leaflet context (map, pane).
 * @returns {object} The react-leaflet element object wrapping the layer.
 */
function createRadarTileLayer({ url, ...options }, context) {
  const layer = new CooldownTileLayer(url, withPane(options, context));
  return createElementObject(layer, context);
}

/**
 * Applies prop changes to the live layer, like react-leaflet's TileLayer:
 * opacity / zIndex through updateGridLayer, and a new `url` through
 * setUrl (a frame slot retargeted onto another frame).
 *
 * @param {object} layer - The CooldownTileLayer instance.
 * @param {object} props - Current props.
 * @param {object} prevProps - Previous props.
 * @returns {void}
 */
function updateRadarTileLayer(layer, props, prevProps) {
  updateGridLayer(layer, props, prevProps);
  if (props.url != null && props.url !== prevProps.url) {
    layer.setUrl(props.url);
  }
}

/**
 * RainViewer radar frame layer: react-leaflet's `TileLayer` with the
 * shared tile cooldown, so a refused tile is not requested again while
 * RainViewer's per-IP rate limit is still saturated. Takes the same props
 * as react-leaflet's TileLayer; the ones WeatherMap passes are declared
 * below.
 *
 * @param {object} props - Component props.
 * @param {string} props.url - Tile URL template of the frame.
 * @param {number} [props.opacity] - Layer opacity (0 hides a preloaded frame).
 * @returns {null} Renders nothing; the layer lives in the Leaflet map.
 */
const RadarTileLayer = createTileLayerComponent(createRadarTileLayer, updateRadarTileLayer);

RadarTileLayer.propTypes = {
  url: PropTypes.string.isRequired,
  opacity: PropTypes.number,
  attribution: PropTypes.string,
  tileSize: PropTypes.number,
  zoomOffset: PropTypes.number,
  maxNativeZoom: PropTypes.number,
  maxZoom: PropTypes.number,
  updateWhenIdle: PropTypes.bool,
  updateWhenZooming: PropTypes.bool,
  keepBuffer: PropTypes.number,
};

export default RadarTileLayer;
