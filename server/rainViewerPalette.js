// RainViewer's "Universal Blue" radar colour scheme (scheme 2), as data.
//
// Since (at the latest) 2026-10-10, scheme 2 is the only radar colour scheme
// RainViewer documents and serves: a tile requested with scheme 2, 4, 6 or 8
// comes back byte-identical. The analyzer (radarAnalyzerCtrl) decodes tile
// pixels back to dBZ with this table, so it must match what the tiles carry.
//
// Source: https://www.rainviewer.com/api/color-schemes.html, CSV linked there
// (https://www.rainviewer.com/files/rainviewer_api_colors_table.csv),
// column "Universal Blue", downloaded 2026-10-10. The CSV lists 128 rain rows
// then 128 snow rows, each -32 … 95 dBZ, as #RRGGBBAA. Only -10 … 95 dBZ are
// painted (below -10 the colour is #00000000), so the arrays start at -10:
// index i is dBZ UNIVERSAL_BLUE_MIN_DBZ + i. Values copied verbatim, runs
// included (rain 65-74 dBZ are all white, 75-95 all green; snow 75-95 all
// #0000ff).
//
// Rain and snow share the dBZ scale but not a single colour, so a pixel's
// colour gives its dBZ without knowing the precipitation type. The snow
// colours appear because the tile URL asks for them (`{smooth}_{snow}` =
// `1_1`); with `1_0` the same echoes come back in the rain colours, same dBZ
// (checked on a snowy tile, 2026-10-10).
//
// Measured on 20 zoom-7 tiles (2026-10-10, North America, Europe, Asia,
// Australia, South America; 2.48 M painted pixels): every painted pixel is
// exactly one of these RGBA values. No anti-aliasing, no blending.

const RAINVIEWER_COLOR_SCHEME = 2;
// `{smooth}_{snow}`: 1 = smoothed, 1 = snow drawn in the snow colours.
const RAINVIEWER_TILE_OPTIONS = "1_1";

const UNIVERSAL_BLUE_MIN_DBZ = -10;

// #RRGGBBAA, one entry per dBZ from -10. The comment is the first row's dBZ.
const UNIVERSAL_BLUE_RAIN = [
  /* -10 */ "63615914", "66635a19", "69665c1e", "6c685d24", "6f6b5f29", "726e612e", "75706234", "78736439",
  /*  -2 */ "7c75653e", "7f786744", "827b6949", "857d6a4e", "88806c54", "8b826d59", "8e856f5e", "92887164",
  /*   6 */ "9e93756e", "aa9e7978", "b6a97e82", "c2b4828c", "cec08796", "d2c48ba0", "d6c88faa", "dacc93b4",
  /*  14 */ "ded097be", "88ddeeff", "6cd1ebff", "51c5e8ff", "36bae5ff", "1baee2ff", "00a3e0ff", "009ad5ff",
  /*  22 */ "0091caff", "0088bfff", "007fb4ff", "0077aaff", "0070a3ff", "00699cff", "006295ff", "005b8eff",
  /*  30 */ "005588ff", "005180ff", "004e78ff", "004a70ff", "004768ff", "ffee00ff", "ffe000ff", "ffd200ff",
  /*  38 */ "ffc500ff", "ffb700ff", "ffaa00ff", "ff9f00ff", "ff9500ff", "ff8b00ff", "ff8100ff", "ff4400ff",
  /*  46 */ "f23600ff", "e62800ff", "d91b00ff", "cd0d00ff", "c10000ff", "a80000ff", "8f0000ff", "760000ff",
  /*  54 */ "5d0000ff", "ffaaffff", "ff9fffff", "ff95ffff", "ff8bffff", "ff81ffff", "ff77ffff", "ff6cffff",
  /*  62 */ "ff62ffff", "ff58ffff", "ff4effff", "ffffffff", "ffffffff", "ffffffff", "ffffffff", "ffffffff",
  /*  70 */ "ffffffff", "ffffffff", "ffffffff", "ffffffff", "ffffffff", "00ff00ff", "00ff00ff", "00ff00ff",
  /*  78 */ "00ff00ff", "00ff00ff", "00ff00ff", "00ff00ff", "00ff00ff", "00ff00ff", "00ff00ff", "00ff00ff",
  /*  86 */ "00ff00ff", "00ff00ff", "00ff00ff", "00ff00ff", "00ff00ff", "00ff00ff", "00ff00ff", "00ff00ff",
  /*  94 */ "00ff00ff", "00ff00ff",
];

const UNIVERSAL_BLUE_SNOW = [
  /* -10 */ "cfffff00", "ceffff0c", "cdffff19", "ccffff26", "cbffff33", "cbffff3f", "caffff4c", "c9ffff59",
  /*  -2 */ "c8ffff66", "c7ffff72", "c7ffff7f", "c6ffff8c", "c5ffff99", "c4ffffa5", "c3ffffb2", "c3ffffbf",
  /*   6 */ "c2ffffcc", "c1ffffd8", "c0ffffe5", "bffffff2", "bfffffff", "b8f8ffff", "b2f2ffff", "abebffff",
  /*  14 */ "a5e5ffff", "9fdfffff", "98d8ffff", "92d2ffff", "8bcbffff", "85c5ffff", "7fbfffff", "78b8ffff",
  /*  22 */ "72b2ffff", "6babffff", "65a5ffff", "5f9fffff", "5b9bffff", "5898ffff", "5595ffff", "5292ffff",
  /*  30 */ "4f8fffff", "4b8bffff", "4888ffff", "4585ffff", "4282ffff", "3f7fffff", "3b7bffff", "3878ffff",
  /*  38 */ "3575ffff", "3272ffff", "2f6fffff", "2b6bffff", "2868ffff", "2565ffff", "2262ffff", "1f5fffff",
  /*  46 */ "1b5bffff", "1858ffff", "1555ffff", "1252ffff", "0f4fffff", "0c4bffff", "0948ffff", "0645ffff",
  /*  54 */ "0242ffff", "003fffff", "003bffff", "0038ffff", "0035ffff", "0032ffff", "002fffff", "002bffff",
  /*  62 */ "0028ffff", "0025ffff", "0022ffff", "001fffff", "001bffff", "0018ffff", "0015ffff", "0012ffff",
  /*  70 */ "000fffff", "000cffff", "0009ffff", "0006ffff", "0002ffff", "0000ffff", "0000ffff", "0000ffff",
  /*  78 */ "0000ffff", "0000ffff", "0000ffff", "0000ffff", "0000ffff", "0000ffff", "0000ffff", "0000ffff",
  /*  86 */ "0000ffff", "0000ffff", "0000ffff", "0000ffff", "0000ffff", "0000ffff", "0000ffff", "0000ffff",
  /*  94 */ "0000ffff", "0000ffff",
];

/**
 * Build the colour → dBZ lookup for the painted Universal Blue colours
 * (alpha > 0), rain and snow together. A colour repeated over a run of dBZ
 * (rain white 65-74, green 75-95; snow 75-95) maps to the run's lowest dBZ.
 *
 * @returns {Map<Number, Number>} colour as an unsigned 0xRRGGBBAA → dBZ
 */
function buildDbzLookup() {
  const lookup = new Map();
  for (const table of [UNIVERSAL_BLUE_RAIN, UNIVERSAL_BLUE_SNOW]) {
    table.forEach((hex, i) => {
      const key = parseInt(hex, 16) >>> 0;
      if ((key & 0xff) === 0) return; // fully transparent: not a painted colour
      if (!lookup.has(key)) lookup.set(key, UNIVERSAL_BLUE_MIN_DBZ + i);
    });
  }
  return lookup;
}

module.exports = {
  RAINVIEWER_COLOR_SCHEME,
  RAINVIEWER_TILE_OPTIONS,
  UNIVERSAL_BLUE_MIN_DBZ,
  UNIVERSAL_BLUE_RAIN,
  UNIVERSAL_BLUE_SNOW,
  buildDbzLookup,
};
