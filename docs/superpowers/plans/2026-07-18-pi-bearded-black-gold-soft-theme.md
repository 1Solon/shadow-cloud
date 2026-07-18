# Pi Bearded Black & Gold Soft Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install and activate a faithful global pi adaptation of Bearded Theme Black & Gold Soft.

**Architecture:** A single user-scoped pi theme JSON defines the complete palette and every required TUI token. The existing global pi settings file is then updated atomically so only its `theme` property changes; pi's own compiled theme loader provides schema and variable-resolution validation.

**Tech Stack:** pi theme JSON, Node.js 22 ESM validation, Python 3 atomic JSON update

---

## File Structure

- Create `C:/Users/Solon/.pi/agent/themes/bearded-black-gold-soft.json`: complete global pi theme definition.
- Modify `C:/Users/Solon/.pi/agent/settings.json`: select the custom theme while preserving all other global settings.
- Do not modify Shadow Cloud application files during implementation. The design and plan documents are the only repository-scoped artifacts.

### Task 1: Install and validate the global theme

**Files:**
- Create: `C:/Users/Solon/.pi/agent/themes/bearded-black-gold-soft.json`
- Test with: `C:/Users/Solon/AppData/Local/pi-node/current/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js`

- [ ] **Step 1: Create the global theme directory**

Run:

```bash
mkdir -p "$HOME/.pi/agent/themes"
```

Expected: command exits with status 0 and `~/.pi/agent/themes` exists.

- [ ] **Step 2: Run pi's loader before creating the theme**

Run:

```bash
THEME="$HOME/.pi/agent/themes/bearded-black-gold-soft.json"
node --input-type=module - "$THEME" <<'NODE'
import { loadThemeFromPath } from "file:///C:/Users/Solon/AppData/Local/pi-node/current/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

const theme = loadThemeFromPath(process.argv[2], "truecolor");
if (theme.name !== "bearded-black-gold-soft") {
  throw new Error(`Unexpected theme name: ${theme.name}`);
}
NODE
```

Expected: FAIL with `ENOENT` because the theme file does not exist yet.

- [ ] **Step 3: Create the complete theme JSON**

Write `C:/Users/Solon/.pi/agent/themes/bearded-black-gold-soft.json` with exactly:

```json
{
  "$schema": "https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json",
  "name": "bearded-black-gold-soft",
  "vars": {
    "base": "#221f1d",
    "panel": "#1c1918",
    "surface": "#1f1c1a",
    "element": "#2a2524",
    "elevated": "#302c29",
    "active": "#373230",
    "borderDark": "#11100f",
    "gold": "#c7910c",
    "text": "#d5d1cf",
    "textSoft": "#bdb8b4",
    "muted": "#665e59",
    "cyan": "#11b7d4",
    "blue": "#3585bb",
    "green": "#00a884",
    "orange": "#d4770c",
    "pink": "#d46ec0",
    "purple": "#a85ff1",
    "red": "#e35535",
    "ruby": "#c62f52",
    "teal": "#38c7bd",
    "successBg": "#1d342c",
    "errorBg": "#3f2721"
  },
  "colors": {
    "accent": "gold",
    "border": "gold",
    "borderAccent": "gold",
    "borderMuted": "borderDark",
    "success": "green",
    "error": "red",
    "warning": "orange",
    "muted": "textSoft",
    "dim": "muted",
    "text": "text",
    "thinkingText": "textSoft",
    "selectedBg": "active",
    "userMessageBg": "element",
    "userMessageText": "text",
    "customMessageBg": "elevated",
    "customMessageText": "text",
    "customMessageLabel": "gold",
    "toolPendingBg": "elevated",
    "toolSuccessBg": "successBg",
    "toolErrorBg": "errorBg",
    "toolTitle": "gold",
    "toolOutput": "textSoft",
    "mdHeading": "gold",
    "mdLink": "cyan",
    "mdLinkUrl": "muted",
    "mdCode": "teal",
    "mdCodeBlock": "textSoft",
    "mdCodeBlockBorder": "muted",
    "mdQuote": "textSoft",
    "mdQuoteBorder": "muted",
    "mdHr": "muted",
    "mdListBullet": "gold",
    "toolDiffAdded": "green",
    "toolDiffRemoved": "red",
    "toolDiffContext": "textSoft",
    "syntaxComment": "muted",
    "syntaxKeyword": "gold",
    "syntaxFunction": "cyan",
    "syntaxVariable": "ruby",
    "syntaxString": "green",
    "syntaxNumber": "red",
    "syntaxType": "purple",
    "syntaxOperator": "gold",
    "syntaxPunctuation": "muted",
    "thinkingOff": "borderDark",
    "thinkingMinimal": "muted",
    "thinkingLow": "gold",
    "thinkingMedium": "cyan",
    "thinkingHigh": "teal",
    "thinkingXhigh": "pink",
    "thinkingMax": "purple",
    "bashMode": "green"
  },
  "export": {
    "pageBg": "base",
    "cardBg": "elevated",
    "infoBg": "element"
  }
}
```

- [ ] **Step 4: Run pi's real theme loader**

Run:

```bash
THEME="$HOME/.pi/agent/themes/bearded-black-gold-soft.json"
node --input-type=module - "$THEME" <<'NODE'
import { loadThemeFromPath } from "file:///C:/Users/Solon/AppData/Local/pi-node/current/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

const theme = loadThemeFromPath(process.argv[2], "truecolor");
if (theme.name !== "bearded-black-gold-soft") {
  throw new Error(`Unexpected theme name: ${theme.name}`);
}
console.log(`Loaded theme: ${theme.name}`);
NODE
```

Expected: PASS and print `Loaded theme: bearded-black-gold-soft`. This exercises pi's compiled TypeBox schema, required-token checks, color parsing, and variable resolution.

- [ ] **Step 5: Validate the export variable references**

Run:

```bash
node - "$HOME/.pi/agent/themes/bearded-black-gold-soft.json" <<'NODE'
const fs = require("node:fs");
const theme = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

for (const [key, value] of Object.entries(theme.export)) {
  if (typeof value === "string" && value !== "" && !value.startsWith("#") && !(value in theme.vars)) {
    throw new Error(`Unresolved export variable ${key}: ${value}`);
  }
}
console.log("Export variables resolved");
NODE
```

Expected: PASS and print `Export variables resolved`.

### Task 2: Activate the theme without altering other settings

**Files:**
- Modify: `C:/Users/Solon/.pi/agent/settings.json`
- Temporary safety copy: `/tmp/pi-settings-before-bearded-theme.json`

- [ ] **Step 1: Save the current settings and assert the desired state is not active**

Run:

```bash
test ! -e /tmp/pi-settings-before-bearded-theme.json
cp "$HOME/.pi/agent/settings.json" /tmp/pi-settings-before-bearded-theme.json
node - "$HOME/.pi/agent/settings.json" <<'NODE'
const fs = require("node:fs");
const settings = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (settings.theme !== "bearded-black-gold-soft") {
  throw new Error(`Theme is not active: ${settings.theme}`);
}
NODE
```

Expected: FAIL with `Theme is not active: dark`, while the safety copy remains available.

- [ ] **Step 2: Atomically change only the theme property**

Run:

```bash
python - <<'PY'
import json
import os
from pathlib import Path

settings_path = Path.home() / ".pi" / "agent" / "settings.json"
temp_path = settings_path.with_name("settings.json.bearded-theme.tmp")
backup_path = settings_path.with_name("settings.json.bearded-theme.backup")

if temp_path.exists() or backup_path.exists():
    raise SystemExit("Refusing to overwrite a pre-existing temporary or backup settings file")

raw = settings_path.read_text(encoding="utf-8")
settings = json.loads(raw)
settings["theme"] = "bearded-black-gold-soft"
temp_path.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8", newline="\n")
backup_path.write_text(raw, encoding="utf-8", newline="\n")

try:
    os.replace(temp_path, settings_path)
except Exception:
    if temp_path.exists():
        temp_path.unlink()
    raise
else:
    backup_path.unlink()
PY
```

Expected: command exits with status 0; the temporary and backup files are removed only after `settings.json` is replaced successfully.

- [ ] **Step 3: Verify that no unrelated setting changed**

Run:

```bash
node - /tmp/pi-settings-before-bearded-theme.json "$HOME/.pi/agent/settings.json" <<'NODE'
const fs = require("node:fs");
const before = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const after = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const expected = { ...before, theme: "bearded-black-gold-soft" };

if (JSON.stringify(after) !== JSON.stringify(expected)) {
  throw new Error("Global settings changed beyond the theme property");
}
console.log("Only the global theme setting changed");
NODE
```

Expected: PASS and print `Only the global theme setting changed`.

- [ ] **Step 4: Verify global discovery, active setting, and export colors**

Run:

```bash
node --input-type=module - "$HOME/.pi/agent/settings.json" <<'NODE'
import fs from "node:fs";
import {
  getThemeByName,
  getThemeExportColors,
} from "file:///C:/Users/Solon/AppData/Local/pi-node/current/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";

const settings = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const theme = getThemeByName(settings.theme);
if (!theme || theme.name !== "bearded-black-gold-soft") {
  throw new Error(`pi could not discover active theme: ${settings.theme}`);
}

const exportColors = getThemeExportColors(settings.theme);
const expectedExport = {
  pageBg: "#221f1d",
  cardBg: "#302c29",
  infoBg: "#2a2524",
};
if (JSON.stringify(exportColors) !== JSON.stringify(expectedExport)) {
  throw new Error(`Unexpected export colors: ${JSON.stringify(exportColors)}`);
}
console.log(`Active pi theme: ${theme.name}`);
NODE
```

Expected: PASS and print `Active pi theme: bearded-black-gold-soft`.

- [ ] **Step 5: Remove the temporary safety copy and inspect final files**

Run:

```bash
rm /tmp/pi-settings-before-bearded-theme.json
node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); console.log("Theme JSON valid")' "$HOME/.pi/agent/themes/bearded-black-gold-soft.json"
node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); console.log("Settings JSON valid")' "$HOME/.pi/agent/settings.json"
```

Expected: both JSON checks pass. No application test suite or repository commit is needed because implementation changes only user-scoped pi configuration outside the repository.
