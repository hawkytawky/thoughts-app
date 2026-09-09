const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const globals = require("globals");

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: [".expo/**", "dist/**", "ios/**", "node_modules/**"],
  },
  {
    files: ["scripts/**/*.js", "server/**/*.js"],
    languageOptions: {
      globals: globals.node,
      sourceType: "commonjs",
    },
  },
]);