# Pi Theme-Aligned Startup Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom PI startup header's hard-coded blue RGB gradient with a warm, active-theme-driven gradient for both the artwork and directory subtitle.

**Architecture:** Add one pure gradient helper that maps character positions to Pi semantic foreground tokens and delegates styling to `theme.fg()`. Cover the helper with Node's built-in test runner, then wire it into the existing global `ui-customization` extension without changing layout or footer behavior.

**Tech Stack:** Pi Extension API, TypeScript 7, Node.js 22 built-in test runner, `@earendil-works/pi-tui`

---

## File Structure

- Create `C:/Users/Solon/.pi/agent/extensions/ui-customization/src/theme-gradient.ts`: theme-token progression and pure text-gradient renderer.
- Create `C:/Users/Solon/.pi/agent/extensions/ui-customization/theme-gradient.test.ts`: focused progression, whitespace, and ANSI-width tests.
- Modify `C:/Users/Solon/.pi/agent/extensions/ui-customization/index.ts`: remove direct RGB coloring and render the header through the helper.
- Modify `C:/Users/Solon/.pi/agent/extensions/ui-customization/package.json`: add the focused Node test command.

The global Pi agent directory is not a Git worktree. Preserve backups in `/tmp/pi-ui-customization-header-backup` until all checks pass; there is no implementation commit for these user-scoped files.

### Task 1: Build the theme-token gradient with TDD

**Files:**
- Create: `C:/Users/Solon/.pi/agent/extensions/ui-customization/src/theme-gradient.ts`
- Create: `C:/Users/Solon/.pi/agent/extensions/ui-customization/theme-gradient.test.ts`
- Modify: `C:/Users/Solon/.pi/agent/extensions/ui-customization/package.json`

- [ ] **Step 1: Back up the existing non-versioned extension files**

Run:

```bash
EXTENSION="$HOME/.pi/agent/extensions/ui-customization"
BACKUP="/tmp/pi-ui-customization-header-backup"
test ! -e "$BACKUP"
mkdir -p "$BACKUP"
cp "$EXTENSION/index.ts" "$BACKUP/index.ts"
cp "$EXTENSION/package.json" "$BACKUP/package.json"
```

Expected: exit status 0, with the original `index.ts` and `package.json` stored under `/tmp/pi-ui-customization-header-backup`.

- [ ] **Step 2: Add the failing gradient tests**

Create `C:/Users/Solon/.pi/agent/extensions/ui-customization/theme-gradient.test.ts` with:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { getThemeByName } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  HEADER_GRADIENT_TOKENS,
  gradientText,
  type ThemeForeground,
} from "./src/theme-gradient.ts";

test("gradientText applies the warm semantic token progression", () => {
  const calls: Array<{ color: string; text: string }> = [];
  const theme: ThemeForeground = {
    fg(color, text) {
      calls.push({ color, text });
      return `<${color}>${text}</${color}>`;
    },
  };

  gradientText(theme, "ABCDEFG", 0);

  assert.deepEqual(HEADER_GRADIENT_TOKENS, [
    "dim",
    "warning",
    "accent",
    "text",
    "accent",
    "warning",
  ]);
  assert.deepEqual(
    calls.map(({ color }) => color),
    ["dim", "warning", "accent", "text", "accent", "warning", "dim"],
  );
});

test("gradientText leaves spaces unstyled", () => {
  const calls: Array<{ color: string; text: string }> = [];
  const theme: ThemeForeground = {
    fg(color, text) {
      calls.push({ color, text });
      return `<${color}>${text}</${color}>`;
    },
  };

  const result = gradientText(theme, "A B", 0);

  assert.equal(result, "<dim>A</dim> <dim>B</dim>");
  assert.deepEqual(
    calls.map(({ text }) => text),
    ["A", "B"],
  );
});

test("gradientText preserves terminal-visible width", () => {
  const theme = getThemeByName("dark");
  assert.ok(theme);

  const text = "PI header";
  const result = gradientText(theme, text, 0.18);

  assert.equal(visibleWidth(result), visibleWidth(text));
});
```

Then change `C:/Users/Solon/.pi/agent/extensions/ui-customization/package.json` to:

```json
{
  "name": "ui-customization",
  "scripts": {
    "check": "tsc --noEmit -p .",
    "test": "node --test --experimental-strip-types *.test.ts",
    "prepare": "effect-tsgo patch"
  },
  "type": "module",
  "private": true,
  "devDependencies": {
    "@effect/tsgo": "^0.19.0",
    "typescript": "^7.0.2"
  }
}
```

- [ ] **Step 3: Run the test to verify it fails for the missing helper**

Run:

```bash
cd "$HOME/.pi/agent/extensions/ui-customization"
npm test
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/theme-gradient.ts`.

- [ ] **Step 4: Implement the minimal theme-token gradient helper**

Create `C:/Users/Solon/.pi/agent/extensions/ui-customization/src/theme-gradient.ts` with:

```typescript
import type {
  Theme,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";

export type ThemeForeground = Pick<Theme, "fg">;

export const HEADER_GRADIENT_TOKENS = [
  "dim",
  "warning",
  "accent",
  "text",
  "accent",
  "warning",
] as const satisfies readonly ThemeColor[];

export function gradientText(
  theme: ThemeForeground,
  text: string,
  phase: number,
) {
  const characters = [...text];
  const span = Math.max(characters.length - 1, 1);

  return characters
    .map((character, index) => {
      if (character === " ") return character;

      const position = ((index / span + phase) % 1 + 1) % 1;
      const tokenIndex = Math.floor(
        position * HEADER_GRADIENT_TOKENS.length,
      );
      const token = HEADER_GRADIENT_TOKENS[tokenIndex]!;
      return theme.fg(token, character);
    })
    .join("");
}
```

- [ ] **Step 5: Run the focused tests and verify they pass**

Run:

```bash
cd "$HOME/.pi/agent/extensions/ui-customization"
npm test
```

Expected: PASS with 3 tests and 0 failures.

### Task 2: Wire the gradient into the custom startup header

**Files:**
- Modify: `C:/Users/Solon/.pi/agent/extensions/ui-customization/index.ts`
- Test: `C:/Users/Solon/.pi/agent/extensions/ui-customization/theme-gradient.test.ts`

- [ ] **Step 1: Replace the hard-coded RGB implementation with the helper import**

In `C:/Users/Solon/.pi/agent/extensions/ui-customization/index.ts`, add this import after the dashboard-state import:

```typescript
import { gradientText } from "./src/theme-gradient.ts";
```

Delete the `Rgb` type and the complete hard-coded coloring block:

```typescript
type Rgb = [number, number, number];
```

```typescript
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const PALETTE: Rgb[] = [
  [22, 83, 189],
  [48, 129, 247],
  [93, 171, 255],
  [151, 205, 255],
  [93, 171, 255],
  [48, 129, 247],
];
```

```typescript
function mix(a: number, b: number, amount: number) {
  return Math.round(a + (b - a) * amount);
}

function sampleGradient(position: number) {
  const wrapped = ((position % 1) + 1) % 1;
  const scaled = wrapped * PALETTE.length;
  const index = Math.floor(scaled);
  const nextIndex = (index + 1) % PALETTE.length;
  const amount = scaled - index;
  const start = PALETTE[index]!;
  const end = PALETTE[nextIndex]!;

  return [
    mix(start[0], end[0], amount),
    mix(start[1], end[1], amount),
    mix(start[2], end[2], amount),
  ] satisfies Rgb;
}

function foreground([red, green, blue]: Rgb, text: string) {
  return `\x1b[38;2;${red};${green};${blue}m${text}${RESET}`;
}

function gradientText(text: string, phase: number) {
  const characters = [...text];
  const span = Math.max(characters.length - 1, 1);

  return characters
    .map((character, index) =>
      character === " "
        ? character
        : foreground(sampleGradient(index / span + phase), character),
    )
    .join("");
}
```

Keep `TITLE_LINES` and `ANSI_PATTERN` unchanged.

- [ ] **Step 2: Pass the active theme into artwork and subtitle rendering**

Replace the header registration block:

```typescript
    ctx.ui.setHeader((tui) => {
      activeTui = tui;
      requestRender = () => tui.requestRender();
      scheduleThemeRemoval(tui);

      return {
        render(width: number) {
          const art = TITLE_LINES.map((line, row) =>
            center(gradientText(line, row * 0.045), width),
          );
          const subtitle = center(
            `${BOLD}${gradientText(title, 0.18)}${RESET}`,
            width,
          );
          return ["", ...art, subtitle, ""];
        },
        invalidate() {},
      };
    });
```

with:

```typescript
    ctx.ui.setHeader((tui, theme) => {
      activeTui = tui;
      requestRender = () => tui.requestRender();
      scheduleThemeRemoval(tui);

      return {
        render(width: number) {
          const art = TITLE_LINES.map((line, row) =>
            center(gradientText(theme, line, row * 0.045), width),
          );
          const subtitle = center(
            theme.bold(gradientText(theme, title, 0.18)),
            width,
          );
          return ["", ...art, subtitle, ""];
        },
        invalidate() {},
      };
    });
```

This preserves all layout values and phase offsets while routing color and bold styling through Pi's active theme.

- [ ] **Step 3: Run the extension tests and typecheck**

Run:

```bash
cd "$HOME/.pi/agent/extensions/ui-customization"
npm test && npm run check
```

Expected: both commands exit 0; the test runner reports 3 passing tests and TypeScript reports no errors.

- [ ] **Step 4: Verify direct blue coloring is gone and unrelated header behavior remains**

Run:

```bash
EXTENSION="$HOME/.pi/agent/extensions/ui-customization"
if rg "22, 83, 189|48, 129, 247|93, 171, 255|151, 205, 255|sampleGradient|function foreground" "$EXTENSION/index.ts"; then
  echo "Hard-coded blue gradient remains" >&2
  exit 1
fi
rg 'ctx\.ui\.setHeader\(\(tui, theme\)' "$EXTENSION/index.ts"
rg 'gradientText\(theme, line, row \* 0\.045\)' "$EXTENSION/index.ts"
rg 'theme\.bold\(gradientText\(theme, title, 0\.18\)\)' "$EXTENSION/index.ts"
rg 'ctx\.ui\.setFooter' "$EXTENSION/index.ts"
```

Expected: exit status 0. The first check prints no blue-gradient matches; the remaining checks print the theme-aware header calls and unchanged footer registration.

- [ ] **Step 5: Remove the backup after successful verification**

Run:

```bash
rm -rf /tmp/pi-ui-customization-header-backup
```

Expected: the backup directory is removed. Run `/reload` in the active Pi session or open a new session to view the gold, theme-aligned PI artwork and subtitle.
