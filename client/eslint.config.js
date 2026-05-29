const js = require("@eslint/js");
const globals = require("globals");
const react = require("eslint-plugin-react");
const reactHooks = require("eslint-plugin-react-hooks");
const jsdoc = require("eslint-plugin-jsdoc");
const eslintComments = require("@eslint-community/eslint-plugin-eslint-comments");

module.exports = [
  js.configs.recommended,
  react.configs.flat.recommended,
  jsdoc.configs["flat/recommended"],
  // eslint-comments flat config (plugin doesn't yet export one natively)
  {
    plugins: {
      "@eslint-community/eslint-comments": eslintComments,
    },
    rules: {
      "@eslint-community/eslint-comments/no-aggregating-enable": "error",
      "@eslint-community/eslint-comments/no-duplicate-disable": "error",
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",
      "@eslint-community/eslint-comments/no-unused-enable": "error",
      "@eslint-community/eslint-comments/no-unused-disable": 1,
      "@eslint-community/eslint-comments/disable-enable-pair": 0,
    },
  },
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.es2015,
        ...globals.jest,
        ...globals.node,
        Atomics: "readonly",
        SharedArrayBuffer: "readonly",
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
      jsdoc,
    },
    settings: {
      react: { version: "detect" },
      jsdoc: {
        tagNamePreference: {
          property: "prop",
          augments: "extends",
        },
      },
    },
    rules: {
      ...reactHooks.configs["recommended-latest"].rules,
      "react/jsx-uses-react": 1,
      "semi": 1,
      "camelcase": 1,
      "no-useless-return": 2,
      "no-self-compare": 2,
      "no-implicit-globals": 2,
      "no-eval": 2,
      "no-alert": 2,
      "no-multiple-empty-lines": 1,
      "no-empty-function": 2,
      "guard-for-in": 2,
      "no-unused-expressions": 2,
      "jsx-quotes": ["warn", "prefer-double"],
      "comma-spacing": 1,
      "arrow-spacing": 1,
      "prefer-destructuring": 1,
      "multiline-comment-style": 0,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react/display-name": 0,
      "react/no-unused-prop-types": 2,
      "jsdoc/require-jsdoc": ["error", {
        publicOnly: true,
        require: {
          ClassDeclaration: true,
          ArrowFunctionExpression: true,
          MethodDefinition: true,
        },
      }],
      "jsdoc/require-param-description": 0,
      "jsdoc/no-undefined-types": 0,
      "jsdoc/check-types": ["warn", { noDefaults: true }],
      "jsdoc/tag-lines": 0,
    },
  },
];
