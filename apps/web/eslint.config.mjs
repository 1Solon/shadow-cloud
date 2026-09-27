import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const paletteName = String.raw`(?:(?!terminal-)[a-z]+-\d{2,3}\b|black\b|white\b)`;
const colourUtility = String.raw`\b(?:text|bg|border(?:-[trblxyse])?|ring(?:-offset)?|inset-ring|shadow|inset-shadow|outline|decoration|divide|fill|stroke|from|via|to|placeholder|caret|accent)`;
const colourPattern = [
  String.raw`${colourUtility}-${paletteName}`,
  String.raw`${colourUtility}-\[(?:#|(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\()`,
  String.raw`--color-${paletteName}`,
  String.raw`(?:^|[\s:(,])#[0-9a-fA-F]{3,8}\b`,
  String.raw`\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(`,
].join("|");
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
    ignores: ["src/**/*.test.{ts,tsx}", "src/app/api/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `Literal[value=/${colourPattern}/]`,
          message: themeColourMessage,
        },
        {
          selector: `TemplateElement[value.raw=/${colourPattern}/]`,
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
