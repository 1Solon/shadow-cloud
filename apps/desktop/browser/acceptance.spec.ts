import { expect, test, type Locator, type Page } from "@playwright/test";
import axe from "axe-core";

declare global {
  interface Window {
    axe: typeof axe;
  }
}

test.beforeEach(async ({ page }) => {
  // These scenarios use the same React snapshot/command boundary as native
  // builds. Only their engine adapter is synthetic; no real service is used.
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === "http://127.0.0.1:1425")
      await route.continue();
    else await route.abort("blockedbyclient");
  });
});

test.afterEach(async ({ page }) => {
  expect((await page.pageErrors()).map((error) => error.message)).toEqual([]);
});

async function accessible(page: Page) {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    });
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        explanation: node.failureSummary,
      })),
    }));
  });
  expect(violations).toEqual([]);
}

async function focusWithKeyboard(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await expect(target).toBeEnabled();
  for (let step = 0; step < 30; step++) {
    if (
      await target.evaluate((element) => element === document.activeElement)
    ) {
      await expect(target).toHaveCSS("outline-style", "solid");
      await expect(target).toHaveCSS("outline-width", "2px");
      return;
    }
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

async function activateWithKeyboard(page: Page, target: Locator) {
  await focusWithKeyboard(page, target);
  await page.keyboard.press("Enter");
}

test("onboarding and reset cancellation work with the keyboard through every setup step", async ({
  page,
}) => {
  await page.goto("/?scenario=onboarding");
  await accessible(page);
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "BEGIN SETUP" }),
  );
  await expect(
    page.getByRole("heading", { name: "> CONNECT THIS DEVICE" }),
  ).toBeFocused();
  await expect(
    page.getByText("Warning: Maintenance overdue!", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/\bNaN\b/)).not.toBeVisible();
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "SIGN IN WITH BROWSER" }),
  );
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "Didn't work?" }),
  );
  const token = page.getByRole("textbox", { name: "One-use token" });
  await expect(token).toBeFocused();
  await accessible(page);
  await page.keyboard.type("synthetic-approval-token");
  await page.keyboard.press("Enter");
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "CONTINUE", exact: true }),
  );
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "CHOOSE FOLDER" }),
  );
  await expect(
    page.getByRole("button", { name: "CONTINUE", exact: true }),
  ).toBeEnabled();
  await accessible(page);
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "CONTINUE", exact: true }),
  );
  const automatic = page.getByRole("switch", { name: "Automatic uploads" });
  await expect(automatic).toBeChecked();
  await activateWithKeyboard(page, automatic);
  await expect(automatic).not.toBeChecked();
  await accessible(page);
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "CONTINUE TO REVIEW" }),
  );
  await expect(page.getByText("DISABLED", { exact: true })).toBeVisible();
  await accessible(page);
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "FINISH SETUP" }),
  );
  await expect(
    page.getByRole("heading", { name: /YOUR CAMPAIGNS/ }),
  ).toBeVisible();
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "SETTINGS", exact: true }),
  );
  const reset = page.getByRole("button", {
    name: "RESET COMPANION",
    exact: true,
  });
  await activateWithKeyboard(page, reset);
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("button", { name: "CANCEL", exact: true }),
  ).toBeFocused();
  await accessible(page);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(reset).toBeFocused();
  await expect(page.getByRole("heading", { name: "> SETTINGS" })).toBeVisible();
});

test("manual review keeps changing files unavailable and supports Ignore, Restore, and explicit Send", async ({
  page,
}) => {
  await page.goto("/?scenario=manual");
  const completed = page.getByRole("button", {
    name: "Send completed-turn.se1",
  });
  await expect(completed).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Send work-in-progress.se1" }),
  ).toBeDisabled();
  await accessible(page);
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "Ignore completed-turn.se1" }),
  );
  await expect(completed).not.toBeVisible();
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "Restore completed-turn.se1" }),
  );
  await activateWithKeyboard(page, completed);
  await expect(
    page.getByText("Submission accepted", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("work-in-progress.se1", { exact: true }),
  ).toBeVisible();
});

test("automatic countdown cancellation leaves a Turn candidate for ordinary review", async ({
  page,
}) => {
  await page.goto("/?scenario=automatic");
  await expect(page.getByText("Sends in 00:15", { exact: true })).toBeVisible();
  await accessible(page);
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "> CANCEL SEND" }),
  );
  await expect(
    page.getByText("Automatic send cancelled", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send completed-turn.se1" }),
  ).toBeEnabled();
  const mode = page.getByRole("combobox", {
    name: "Automatic sends for Long Meridian",
  });
  await focusWithKeyboard(page, mode);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(mode).toHaveValue("manual");
  await expect(
    page.getByText("completed-turn.se1", { exact: true }),
  ).toBeVisible();
  await accessible(page);
});

test("Save-conflict review preserves local work through pause and explicit Use latest", async ({
  page,
}) => {
  await page.goto("/?scenario=conflict");
  const localSend = page.getByRole("button", { name: "Send local-turn.se1" });
  await expect(localSend).toBeDisabled();
  await page.getByRole("button", { name: "Ignore local-turn.se1" }).click();
  await page.getByRole("button", { name: "Restore local-turn.se1" }).click();
  await expect(localSend).toBeDisabled();
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "> RESOLVE CONFLICT" }),
  );
  await expect(
    page.getByRole("region", { name: "Resolve Save conflict for Black Glass" }),
  ).toContainText(
    "Use latest preserves your local work in a conflict area before receiving the current cloud save.",
  );
  await accessible(page);
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "KEEP LOCAL AND PAUSE" }),
  );
  await expect(page.getByText("local-turn.se1", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "USE LATEST", exact: true }),
  ).toBeDisabled();
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "RESUME CAMPAIGN" }),
  );
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "USE LATEST", exact: true }),
  );
  await expect(
    page.getByText("Local work preserved; current cloud save received.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(localSend).not.toBeVisible();
});

test("stale turn review requires a separate explicit Send", async ({
  page,
}) => {
  await page.goto("/?scenario=stale");
  const localSend = page.getByRole("button", { name: "Send local-turn.se1" });
  await expect(localSend).toBeDisabled();
  await accessible(page);
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "REVIEW CURRENT TURN", exact: true }),
  );
  await expect(localSend).toBeEnabled();
  await expect(page.getByText("local-turn.se1", { exact: true })).toBeVisible();
  await expect(page.getByText(/Sends in/)).not.toBeVisible();
  await activateWithKeyboard(page, localSend);
  await expect(
    page.getByText("Submission accepted", { exact: true }),
  ).toBeVisible();
});

test("offline recovery choices and diagnostics remain available without network effects", async ({
  page,
}) => {
  await page.goto("/?scenario=offline");
  await expect(
    page.getByText("YOU ARE OFFLINE", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "> RESOLVE CONFLICT" }).click();
  await expect(
    page.getByRole("button", { name: "USE LATEST", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "KEEP LOCAL AND PAUSE" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "SETTINGS", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Diagnostic report" }),
  ).not.toBeVisible();
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "GENERATE DIAGNOSTICS" }),
  );
  const diagnostics = page.getByRole("region", { name: "Diagnostic report" });
  await expect(diagnostics).toContainText('"connection": "offline"');
  await expect(diagnostics).not.toContainText("~/Games/Shadow Cloud");
  await focusWithKeyboard(page, diagnostics);
  await expect(diagnostics).toHaveCSS("user-select", "text");
  await accessible(page);
});

for (const appearance of [
  { theme: "DARK", system: "light", background: "rgb(0, 0, 0)" },
  { theme: "LIGHT", system: "dark", background: "rgb(248, 239, 227)" },
  { theme: "SYSTEM", system: "light", background: "rgb(248, 239, 227)" },
  { theme: "SYSTEM", system: "dark", background: "rgb(0, 0, 0)" },
] satisfies {
  theme: string;
  system: "light" | "dark";
  background: string;
}[]) {
  test(`${appearance.theme} theme remains accessible with a ${appearance.system} system preference`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: appearance.system });
    await page.goto("/?scenario=active");
    await page.getByRole("button", { name: "SETTINGS", exact: true }).click();
    await page
      .getByRole("button", { name: appearance.theme, exact: true })
      .click();
    await expect(page.locator("html")).toHaveCSS(
      "background-color",
      appearance.background,
    );
    await accessible(page);
    await page.getByRole("button", { name: "CAMPAIGNS", exact: true }).click();
    await accessible(page);
  });
}

test("reduced motion and forced colors retain visible keyboard focus and conflict controls", async ({
  page,
}) => {
  await page.emulateMedia({
    reducedMotion: "reduce",
    forcedColors: "active",
    contrast: "more",
  });
  await page.goto("/?scenario=conflict");
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "> RESOLVE CONFLICT" }),
  );
  await focusWithKeyboard(
    page,
    page.getByRole("button", { name: "USE LATEST", exact: true }),
  );
  await accessible(page);
  await expect(
    page.getByRole("button", { name: "Send local-turn.se1" }),
  ).toBeDisabled();
});

test("update review supports keyboard cancellation and requires consent for the selected channel", async ({
  page,
}) => {
  await page.goto("/?scenario=updates");
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "SETTINGS", exact: true }),
  );
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "CHECK FOR UPDATES" }),
  );
  await expect(
    page.getByText("An update is available.", { exact: true }),
  ).toBeVisible();
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "REVIEW UPDATE" }),
  );
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("button", { name: "CANCEL", exact: true }),
  ).toBeFocused();
  await accessible(page);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "REVIEW UPDATE" }),
  ).toBeFocused();
  const channel = page.getByRole("combobox", { name: "Update channel" });
  await focusWithKeyboard(page, channel);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(channel).toHaveValue("preview");
  await expect(
    page.getByRole("button", { name: "REVIEW UPDATE" }),
  ).toBeDisabled();
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "CHECK FOR UPDATES" }),
  );
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "REVIEW UPDATE" }),
  );
  await expect(dialog).toContainText("0.18.0-beta.1");
  await activateWithKeyboard(
    page,
    dialog.getByRole("button", { name: "INSTALL AND RESTART" }),
  );
  await expect(
    dialog.getByRole("button", { name: "INSTALLING…" }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "CANCEL", exact: true }),
  ).toBeDisabled();
  await expect(dialog).toContainText(
    "This development scenario does not install software or restart.",
  );
});

test("update blockers remain explicit while paused and native preferences use available capabilities", async ({
  page,
}) => {
  await page.goto("/?scenario=update-blocked");
  await page.getByRole("button", { name: "PAUSE SYNC", exact: true }).click();
  await page.getByRole("button", { name: "SETTINGS", exact: true }).click();
  await page.getByRole("button", { name: "CHECK FOR UPDATES" }).click();
  await page.getByRole("button", { name: "REVIEW UPDATE" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("button", { name: "INSTALL AND RESTART" }),
  ).toBeDisabled();
  await expect(dialog).toContainText(
    "Paused conflicts still need a resolution.",
  );
  await expect(dialog).toContainText(
    "Pausing does not settle an uncertain submission.",
  );
  await accessible(page);
  await page.keyboard.press("Escape");
  const startup = page.getByRole("switch", { name: "Start at login" });
  await activateWithKeyboard(page, startup);
  await expect(startup).toBeChecked();
  const tray = page.getByRole("switch", { name: "Keep running in tray" });
  await activateWithKeyboard(page, tray);
  await expect(tray).not.toBeChecked();
  await page.goto("/?scenario=native-unavailable");
  await page.getByRole("button", { name: "SETTINGS", exact: true }).click();
  await expect(startup).toBeDisabled();
  await expect(tray).toBeDisabled();
  await expect(tray).not.toBeChecked();
  await accessible(page);
});

test("protocol mismatch exposes updates before onboarding can authenticate", async ({
  page,
}) => {
  await page.goto("/?scenario=onboarding-update-required");
  await expect(
    page.getByText("UPDATE REQUIRED", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "SETTINGS", exact: true }),
  ).not.toBeVisible();
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "CHECK FOR UPDATES" }),
  );
  await activateWithKeyboard(
    page,
    page.getByRole("button", { name: "REVIEW UPDATE" }),
  );
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("button", { name: "CANCEL", exact: true }),
  ).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: "INSTALL AND RESTART" }),
  ).toBeEnabled();
  await accessible(page);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "> WELCOME TO SHADOW CLOUD" }),
  ).toBeVisible();
});

test.describe("reflow at the 200% equivalent of the minimum 640 by 480 window", () => {
  // Browser CSS-pixel reflow and native webview zoom have separate acceptance.
  // This uses the same effective layout space as 200% zoom at minimum window size.
  test.use({ viewport: { width: 320, height: 240 }, deviceScaleFactor: 2 });

  async function controlsFit(page: Page) {
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const control of await page.locator("button, input, select").all()) {
      if (!(await control.isVisible())) continue;
      await control.scrollIntoViewIfNeeded();
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(321);
    }
  }

  test("Campaign recovery and Settings diagnostics remain reachable without horizontal scrolling", async ({
    page,
  }) => {
    await page.goto("/?scenario=conflict");
    await page.getByRole("button", { name: "> RESOLVE CONFLICT" }).click();
    await controlsFit(page);
    await accessible(page);
    await page.getByRole("button", { name: "SETTINGS", exact: true }).click();
    await page.getByRole("button", { name: "GENERATE DIAGNOSTICS" }).click();
    await controlsFit(page);
    await accessible(page);
    await expect(
      page.getByRole("region", { name: "Diagnostic report" }),
    ).toBeVisible();
  });

  test("update consent fits and keeps both choices reachable", async ({
    page,
  }) => {
    await page.goto("/?scenario=updates");
    await page.getByRole("button", { name: "SETTINGS", exact: true }).click();
    await page.getByRole("button", { name: "CHECK FOR UPDATES" }).click();
    await controlsFit(page);
    await page.getByRole("button", { name: "REVIEW UPDATE" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(
      dialog.getByRole("button", { name: "CANCEL", exact: true }),
    ).toBeFocused();
    await accessible(page);
    for (const name of ["CANCEL", "INSTALL AND RESTART"]) {
      const button = dialog.getByRole("button", { name, exact: true });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
});
