import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const paletteColour = String.raw`\b(?:text|bg|border(?:-[trblxy])?|ring(?:-offset)?|shadow|outline|decoration|divide|fill|stroke|from|via|to|placeholder|caret|accent)-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d|black\b|white\b|\[(?:#|rgba?\(|hsla?\(|oklch\())`;
const rawColour = String.raw`^#[0-9a-fA-F]{3,8}$|rgba?\(`;
const themeColourMessage =
  "Use theme colours (terminal-*, primary, destructive and so on) so Shadow Override can recolour them.";

const eslintConfig = defineConfig([
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `Literal[value=/${paletteColour}/]`,
          message: themeColourMessage,
        },
        {
          selector: `TemplateElement[value.raw=/${paletteColour}/]`,
          message: themeColourMessage,
        },
        {
          selector: `Literal[value=/${rawColour}/]`,
          message: themeColourMessage,
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "test-results/**",
  ]),
]);

export default eslintConfig;
