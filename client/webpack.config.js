const path = require("path");
const webpack = require("webpack");
const HtmlWebPackPlugin = require("html-webpack-plugin");
const ESLintPlugin = require("eslint-webpack-plugin");

module.exports = (env) => {
  const PRODUCTION = !!(env && env.BUILD_PRODUCTION);
  process.env.NODE_ENV = PRODUCTION ? "production" : "development";

  const definePlugin = new webpack.DefinePlugin({
    __PRODUCTION__: JSON.stringify(
      JSON.parse(env ? env.BUILD_PRODUCTION || "false" : "false")
    ),
  });

  return {
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: "bundle.min.js",
      publicPath: "/",
      // Wipe dist/ before each build so renamed/removed chunks don't linger
      // as committed orphans. (A stale `1.bundle.min.js` from an old chunk-id
      // layout survived rebuilds until it was hand-deleted — see the Geist
      // consolidation PR.) Every committed dist file is re-emitted by the
      // build, so cleaning removes nothing that isn't immediately regenerated;
      // the CI dist-drift check enforces that invariant.
      clean: true,
    },
    module: {
      rules: [
        {
          test: /\.(js|jsx)$/,
          include: [path.resolve(__dirname, "src")],
          exclude: /node_modules/,
          use: {
            loader: "babel-loader",
          },
        },
        {
          test: /\.html$/,
          use: [
            {
              loader: "html-loader",
            },
          ],
        },
        {
          test: /\.css$/,
          oneOf: [
            {
              // node_modules CSS (e.g. leaflet/dist/leaflet.css) must
              // NOT go through CSS Modules — third-party stylesheets
              // expect their class names verbatim (`.leaflet-container`
              // etc.) because the JS that injects DOM uses the
              // unhashed names. Without this branch the leaflet
              // stylesheet was hashed by the project's css-loader and
              // the map tiles rendered partially / off-position.
              include: /node_modules/,
              use: [
                "style-loader",
                { loader: "css-loader", options: { sourceMap: !PRODUCTION, esModule: false } },
              ],
            },
            {
              use: [
                "style-loader",
                {
                  loader: "css-loader",
                  options: {
                    sourceMap: !PRODUCTION,
                    esModule: false,
                    modules: {
                      exportLocalsConvention: "camelCase",
                      localIdentName: "[path][name]__[local]--[hash:base64:5]",
                    },
                  },
                },
                { loader: "postcss-loader", options: { sourceMap: !PRODUCTION, postcssOptions: { config: true } } },
              ],
            },
          ],
        },
        {
          test: /\.(png|svg|jpg|gif)$/,
          oneOf: [
            {
              // PWA install icons — referenced by manifest.json as
              // bare relative paths ("icon-192.png" etc.). The browser
              // resolves those relative to the manifest's own URL, so
              // the files MUST be served at their original filenames.
              // Use `asset/resource` (always emitted, never inlined as
              // data URI) with the original name preserved.
              test: /(?:apple-touch-icon|icon-192|icon-512)\.png$/,
              type: "asset/resource",
              generator: { filename: "[name][ext]" },
            },
            {
              type: "asset",
              parser: { dataUrlCondition: { maxSize: 8192 } },
              generator: {
                filename: PRODUCTION ? "[contenthash][ext]" : "[path][name][ext]?[contenthash]"
              },
            },
          ],
        },
        {
          test: /\.(woff|woff2|eot|ttf|otf)$/,
          type: "asset/resource",
          generator: {
            filename: PRODUCTION ? "[contenthash][ext]" : "[path][name][ext]?[contenthash]"
          },
        },
      ],
    },
    resolve: {
      extensions: [".js", ".scss"],
      alias: {
        ["~"]: path.resolve(__dirname, "src"),
      },
    },
    plugins: [
      new HtmlWebPackPlugin({
        template: "./src/index.html",
        filename: "./index.html",
        favicon: "./src/favicon.svg",
      }),
      definePlugin,
      new ESLintPlugin({
        extensions: ["js", "jsx"],
        configType: "flat",
      }),
    ],
    watchOptions: {
      ignored: /node_modules/
    }
  };
};
