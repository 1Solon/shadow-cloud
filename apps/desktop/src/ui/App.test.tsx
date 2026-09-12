// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createDevelopmentCompanion } from "../development/companion";
import { App } from "./App";

afterEach(cleanup);

async function waitForRootContinue() {
  const button = screen.getByRole("button", { name: "CONTINUE" });
  await waitFor(() => expect(button).toBeEnabled(), { timeout: 2500 });
  return button;
}

it("keeps transfers unavailable until the onboarding review is completed", async () => {
  const user = userEvent.setup();
  const companion = createDevelopmentCompanion("onboarding");
  render(<App companion={companion} development />);

  expect(
    await screen.findByRole("heading", { name: /WELCOME TO SHADOW CLOUD/ }),
  ).toBeVisible();
  expect(screen.queryByText("ONE CAMPAIGN, ONE FOLDER")).toBeNull();
  expect(screen.queryByText("NO SILENT OVERWRITES")).toBeNull();
  expect(screen.queryByText("SAFE WHEN OFFLINE")).toBeNull();
  expect(document.querySelector(".welcome-node-field")).not.toBeNull();
  expect(document.querySelector(".welcome-station-field")).toBeNull();
  expect(screen.getByRole("contentinfo")).not.toHaveTextContent("TRANSFERS");
  const setupSteps = screen.getByRole("list", { name: "Setup steps" });
  expect(within(setupSteps).getAllByRole("listitem")).toHaveLength(5);
  expect(within(setupSteps).getByText("WELCOME").closest("li")).toHaveAttribute(
    "aria-current",
    "step",
  );
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "BEGIN SETUP" }));
  expect(
    screen.getByRole("heading", { name: /CONNECT THIS DEVICE/ }),
  ).toBeVisible();
  expect(document.querySelector(".connect-graphic")).toHaveAttribute(
    "data-powered",
    "false",
  );
  expect(
    within(screen.getByRole("banner")).queryByText("CONNECTED AS"),
  ).toBeNull();
  expect(
    screen.getByText(
      "Sign in through the Shadow Cloud webui. This authenticates the companion with your Shadow Cloud account, if sign in with browser does not work, use the one-use token instead",
    ),
  ).toBeVisible();
  expect(within(setupSteps).getByText("CONNECT").closest("li")).toHaveAttribute(
    "aria-current",
    "step",
  );
  expect(screen.queryByRole("textbox", { name: "One-use token" })).toBeNull();
  expect(screen.getByText("OR USE A ONE-USE TOKEN")).not.toBeVisible();
  expect(screen.queryByRole("button", { name: "Didn't work?" })).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "SIGN IN WITH BROWSER" }),
  );
  expect(screen.getByText(/api\/auth\/companion\?handoff=/)).toBeVisible();
  expect(document.querySelector(".connect-graphic")).toHaveAttribute(
    "data-powered",
    "false",
  );
  const fallback = screen.getByRole("button", { name: "Didn't work?" });
  expect(fallback).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("textbox", { name: "One-use token" })).toBeNull();
  fallback.focus();
  await user.keyboard("{Enter}");
  expect(fallback).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("OR USE A ONE-USE TOKEN")).toBeVisible();
  expect(screen.getByRole("textbox", { name: "One-use token" })).toHaveFocus();
  await user.type(screen.getByLabelText("One-use token"), "development-token");
  await user.click(screen.getByRole("button", { name: "CONNECT WITH TOKEN" }));

  expect(document.querySelector(".connect-graphic")).toHaveAttribute(
    "data-powered",
    "true",
  );
  expect(
    screen.getByRole("heading", { name: /CONNECT THIS DEVICE/ }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: /CHOOSE ROOT DIRECTORY/ }),
  ).toBeNull();
  const header = within(screen.getByRole("banner"));
  expect(header.getByText("CONNECTED AS")).toBeVisible();
  expect(header.getByText("SOLON")).toBeVisible();
  expect(
    within(screen.getByRole("main")).queryByText("CONNECTED AS"),
  ).toBeNull();
  expect(screen.queryByRole("textbox", { name: "One-use token" })).toBeNull();
  expect((await companion.snapshot()).onboarding.canSend).toBe(false);
  expect(screen.getByRole("button", { name: "CONTINUE" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "CONTINUE" }));
  expect(document.querySelector(".connect-graphic")).toBeNull();

  expect(
    screen.getByRole("heading", { name: /CHOOSE ROOT DIRECTORY/ }),
  ).toBeVisible();
  expect(
    screen.getByText(
      "The root directory contains a folder for each one of your Shadow Cloud games, your saves and the saves of other players will be saved into these folders.",
    ),
  ).toBeVisible();
  expect(screen.queryByText(/Existing unrelated folders/)).toBeNull();
  expect(document.querySelector(".root-copy .onboarding-callout")).toBeNull();
  expect(header.getByText("CONNECTED AS")).toBeVisible();
  expect(header.getByText("SOLON")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
  expect(
    screen.getByRole("heading", { name: /CHOOSE ROOT DIRECTORY/ }),
  ).toBeVisible();
  const rootGraphic = document.querySelector(".root-graphic");
  const rootContinue = screen.getByRole("button", { name: "CONTINUE" });
  expect(screen.queryByText("COMPANION ROOT")).not.toBeInTheDocument();
  expect(screen.queryByText("~/Games/Shadow Cloud")).not.toBeInTheDocument();
  expect(document.querySelector(".root-copy .review-list")).toBeNull();
  expect(rootGraphic).toHaveAttribute("data-phase", "releasing");
  expect(rootContinue).toBeDisabled();
  await user.click(rootContinue);
  expect(
    screen.getByRole("heading", { name: /CHOOSE ROOT DIRECTORY/ }),
  ).toBeVisible();
  expect(screen.getByText("IDENTITY: SOLON")).toBeVisible();
  expect(screen.getByText("SHADOW LORD PRESENCE: CONFIRMED")).toBeVisible();
  await waitFor(
    () => {
      expect(rootContinue).toBeEnabled();
      expect(rootGraphic).toHaveAttribute("data-phase", "complete");
    },
    { timeout: 2500 },
  );
  await user.click(rootContinue);
  expect(screen.getByRole("heading", { name: /TURN MODE/ })).toBeVisible();
  expect(
    screen.getByRole("img", {
      name: "Four nearby stars scanned for Shadow Pawn presence",
    }),
  ).toBeVisible();
  expect(document.querySelectorAll(".turn-mode-detection")).toHaveLength(4);
  expect(screen.getAllByText("SHADOW PAWNS: PRESENT")).toHaveLength(2);
  expect(screen.getAllByText("SHADOW PAWNS: ABSENT")).toHaveLength(2);
  expect(
    screen.getByRole("switch", { name: "Automatic uploads" }),
  ).toBeChecked();
  await user.click(screen.getByRole("button", { name: "CONTINUE TO REVIEW" }));
  expect(
    screen.getByRole("heading", { name: /REVIEW SETTINGS/ }),
  ).toBeVisible();
  expect(screen.getByText("ENABLED")).toBeVisible();
  expect(screen.queryByText("CAMPAIGN FOLDERS")).not.toBeInTheDocument();
  expect(
    screen.getByRole("img", {
      name: "Active space station with illuminated habitats and docking traffic",
    }),
  ).toBeVisible();
  expect(screen.getByText("~/Games/Shadow Cloud")).toBeVisible();
  expect((await companion.snapshot()).onboarding.canSend).toBe(false);
  await user.click(screen.getByRole("button", { name: "FINISH SETUP" }));

  expect(
    await screen.findByRole("heading", { name: /YOUR CAMPAIGNS/ }),
  ).toBeVisible();
  expect((await companion.snapshot()).onboarding.canSend).toBe(true);
  expect(
    within(screen.getByRole("banner")).getByText("CONNECTED AS"),
  ).toBeVisible();
  expect(within(screen.getByRole("banner")).getByText("SOLON")).toBeVisible();
});

it("keeps the token fallback available when browser sign-in fails", async () => {
  const user = userEvent.setup();
  const companion = createDevelopmentCompanion("offline");
  await companion.command({ type: "sign-out" });
  render(<App companion={companion} />);
  await user.click(
    await screen.findByRole("button", { name: "SIGN IN WITH BROWSER" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not reach Shadow Cloud",
  );
  expect(screen.queryByRole("textbox", { name: "One-use token" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Didn't work?" }));
  expect(screen.getByRole("textbox", { name: "One-use token" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "One-use token" })).toHaveFocus();
});

it("offers the fallback when returning to an already waiting browser sign-in", async () => {
  const user = userEvent.setup();
  const companion = createDevelopmentCompanion("onboarding");
  await companion.command({ type: "continue-onboarding" });
  await companion.command({ type: "start-browser-sign-in" });
  render(<App companion={companion} />);
  const fallback = await screen.findByRole("button", { name: "Didn't work?" });
  expect(
    screen.getByRole("button", { name: "SIGN IN WITH BROWSER" }),
  ).toBeDisabled();
  expect(screen.queryByRole("textbox", { name: "One-use token" })).toBeNull();
  await user.click(fallback);
  expect(screen.getByRole("textbox", { name: "One-use token" })).toBeVisible();
});

it("lets reached setup steps be revisited without losing an unfinished sign-in", async () => {
  const user = userEvent.setup();
  const companion = createDevelopmentCompanion("onboarding");
  render(<App companion={companion} />);
  await screen.findByRole("heading", { name: /WELCOME TO SHADOW CLOUD/ });
  const steps = within(screen.getByRole("list", { name: "Setup steps" }));
  expect(steps.getByRole("button", { name: "02 CONNECT" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "BEGIN SETUP" }));
  await user.click(
    screen.getByRole("button", { name: "SIGN IN WITH BROWSER" }),
  );
  await user.click(screen.getByRole("button", { name: "Didn't work?" }));
  await user.type(screen.getByLabelText("One-use token"), "unfinished-token");
  await user.click(steps.getByRole("button", { name: "01 WELCOME" }));
  expect(
    screen.getByRole("heading", { name: /WELCOME TO SHADOW CLOUD/ }),
  ).toBeVisible();

  // Returning through the setup element also works with the keyboard.
  steps.getByRole("button", { name: "02 CONNECT" }).focus();
  await user.keyboard("{Enter}");
  expect(
    screen.getByRole("heading", { name: /CONNECT THIS DEVICE/ }),
  ).toHaveFocus();
  expect(screen.getByLabelText("One-use token")).toHaveValue(
    "unfinished-token",
  );
  expect(screen.getByRole("textbox", { name: "One-use token" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Didn't work?" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(screen.getByText("WAITING FOR APPROVAL")).toBeVisible();
  expect(steps.getByRole("button", { name: "03 ROOT" })).toBeDisabled();
  expect(steps.getByRole("button", { name: "04 TURN MODE" })).toBeDisabled();
  expect(steps.getByRole("button", { name: "05 REVIEW" })).toBeDisabled();
  expect((await companion.snapshot()).onboarding.canSend).toBe(false);
});

it("preserves completed setup choices when navigating back from review", async () => {
  const user = userEvent.setup();
  const companion = createDevelopmentCompanion("onboarding");
  render(<App companion={companion} />);
  await user.click(await screen.findByRole("button", { name: "BEGIN SETUP" }));
  await user.click(
    screen.getByRole("button", { name: "SIGN IN WITH BROWSER" }),
  );
  await user.click(screen.getByRole("button", { name: "Didn't work?" }));
  await user.type(screen.getByLabelText("One-use token"), "development-token");
  await user.click(screen.getByRole("button", { name: "CONNECT WITH TOKEN" }));
  await user.click(screen.getByRole("button", { name: "CONTINUE" }));
  await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
  await user.click(await waitForRootContinue());
  await user.click(screen.getByRole("switch", { name: "Automatic uploads" }));
  await user.click(screen.getByRole("button", { name: "CONTINUE TO REVIEW" }));
  expect(screen.getByText("DISABLED")).toBeVisible();
  const steps = within(screen.getByRole("list", { name: "Setup steps" }));

  await user.click(steps.getByRole("button", { name: "02 CONNECT" }));
  expect(screen.getByText("CONNECTED AS")).toBeVisible();
  expect(screen.getByText("SOLON")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "SIGN IN WITH BROWSER" }),
  ).toBeNull();
  expect(screen.queryByLabelText("One-use token")).toBeNull();
  await user.click(screen.getByRole("button", { name: "CONTINUE" }));
  expect(
    screen.getByRole("heading", { name: /CHOOSE ROOT DIRECTORY/ }),
  ).toBeVisible();
  expect((await companion.snapshot()).rootPath).toBe("~/Games/Shadow Cloud");
  await user.click(screen.getByRole("button", { name: "CONTINUE" }));
  expect(
    screen.getByRole("switch", { name: "Automatic uploads" }),
  ).not.toBeChecked();

  // All reached steps, including Review, remain navigable from Welcome.
  await user.click(steps.getByRole("button", { name: "01 WELCOME" }));
  await user.click(steps.getByRole("button", { name: "03 ROOT" }));
  expect(screen.queryByText("COMPANION ROOT")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "CONTINUE" })).toBeEnabled();
  expect((await companion.snapshot()).rootPath).toBe("~/Games/Shadow Cloud");
  await user.click(steps.getByRole("button", { name: "04 TURN MODE" }));
  await user.click(screen.getByRole("switch", { name: "Automatic uploads" }));
  await user.click(steps.getByRole("button", { name: "05 REVIEW" }));
  expect(screen.getByText("ENABLED")).toBeVisible();
  expect(screen.getByText("~/Games/Shadow Cloud")).toBeVisible();
  expect((await companion.snapshot()).onboarding.canSend).toBe(false);
  await user.click(screen.getByRole("button", { name: "FINISH SETUP" }));
  expect(
    await screen.findByRole("heading", { name: /YOUR CAMPAIGNS/ }),
  ).toBeVisible();
});

it("keeps the Setup bar fixed when moving from Connect to Root", async () => {
  const user = userEvent.setup();
  const companion = createDevelopmentCompanion("onboarding");
  render(<App companion={companion} />);

  await user.click(await screen.findByRole("button", { name: "BEGIN SETUP" }));
  await user.click(
    screen.getByRole("button", { name: "SIGN IN WITH BROWSER" }),
  );
  await user.click(screen.getByRole("button", { name: "Didn't work?" }));
  await user.type(screen.getByLabelText("One-use token"), "development-token");
  await user.click(screen.getByRole("button", { name: "CONNECT WITH TOKEN" }));

  const setupBar = screen.getByRole("list", {
    name: "Setup steps",
  }).parentElement!;
  const connectPageClass = setupBar.parentElement!.className;
  await user.click(screen.getByRole("button", { name: "CONTINUE" }));

  expect(
    screen.getByRole("heading", { name: /CHOOSE ROOT DIRECTORY/ }),
  ).toBeVisible();
  expect(setupBar.parentElement).toHaveClass(connectPageClass);
});

it("replays the same entry transition for every reached step without remounting the Setup bar", async () => {
  const user = userEvent.setup();
  const companion = createDevelopmentCompanion("onboarding");
  await companion.command({ type: "continue-onboarding" });
  await companion.command({
    type: "submit-handoff-token",
    token: "development-token",
  });
  await companion.command({ type: "continue-onboarding" });
  await companion.command({ type: "choose-companion-root" });
  await companion.command({ type: "continue-onboarding" });
  await companion.command({ type: "continue-onboarding" });
  render(<App companion={companion} />);
  await screen.findByRole("heading", { name: /REVIEW SETTINGS/ });
  const setupBar = screen.getByRole("list", { name: "Setup steps" });
  const steps = within(setupBar);
  let previousPanel = document.querySelector(".onboarding-panel");

  // Cover backward, forward and non-adjacent sidebar navigation, then repeat.
  for (const label of [
    "04 TURN MODE",
    "03 ROOT",
    "02 CONNECT",
    "01 WELCOME",
    "02 CONNECT",
    "03 ROOT",
    "04 TURN MODE",
    "05 REVIEW",
    "01 WELCOME",
    "05 REVIEW",
  ]) {
    await user.click(steps.getByRole("button", { name: label }));
    const panel = document.querySelector(".onboarding-panel");
    expect(panel).toHaveClass("onboarding-panel--reveal");
    expect(panel).not.toBe(previousPanel);
    expect(previousPanel).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Setup steps" })).toBe(setupBar);
    expect(panel?.querySelector("h1")).toHaveFocus();
    previousPanel = panel;
  }

  // Preference updates are not navigation: keep the scene and its animation mounted.
  await user.click(steps.getByRole("button", { name: "04 TURN MODE" }));
  const panel = document.querySelector(".onboarding-panel");
  const graphic = screen.getByRole("img");
  await user.click(screen.getByRole("switch", { name: "Automatic uploads" }));
  expect(document.querySelector(".onboarding-panel")).toBe(panel);
  expect(screen.getByRole("img")).toBe(graphic);
  expect((await companion.snapshot()).onboarding.canSend).toBe(false);
});

it("combines web-style search and sync-status visibility without changing engine campaigns", async () => {
  const user = userEvent.setup();
  const companion = createDevelopmentCompanion("active");
  render(<App companion={companion} />);
  await screen.findByRole("heading", { name: /YOUR CAMPAIGNS \(5\)/ });
  const cards = () =>
    screen
      .queryAllByRole("article")
      .map((card) => within(card).getByRole("heading").textContent);
  expect(cards()[0]).toBe("107 : Long Meridian");
  await user.type(screen.getByRole("searchbox"), "  GLASS  ");
  expect(cards()).toEqual(["42 : Black Glass"]);
  await user.click(
    screen.getByRole("button", {
      name: /Filter your campaigns by sync status/,
    }),
  );
  await user.click(
    screen.getByRole("checkbox", { name: "Show Conflict campaigns" }),
  );
  await user.keyboard("{Escape}");
  expect(screen.getByText("NO CAMPAIGNS MATCH THESE FILTERS")).toBeVisible();
  // The visibility filter must not hide global actionable state or stop sync.
  expect(screen.getByText("2 NEED YOUR ATTENTION")).toBeVisible();
  expect((await companion.snapshot()).campaigns).toHaveLength(5);
  await user.click(screen.getByRole("button", { name: "SHOW ALL CAMPAIGNS" }));
  expect(cards()).toHaveLength(5);
});

it("keeps interface preferences in Settings and sends changes through the engine", async () => {
  const user = userEvent.setup();
  const companion = createDevelopmentCompanion("active");
  render(<App companion={companion} />);
  await screen.findByRole("heading", { name: /YOUR CAMPAIGNS/ });
  expect(
    screen.queryByRole("button", { name: "LIGHT" }),
  ).not.toBeInTheDocument();
  await user.type(screen.getByRole("searchbox"), "107");
  await user.click(screen.getByRole("button", { name: "SETTINGS" }));
  expect(screen.getByRole("heading", { name: "> SETTINGS" })).toBeVisible();
  expect(screen.queryByText("Preferences")).not.toBeInTheDocument();
  expect(
    screen.getByText("~/Games/Shadow Cloud", { exact: true }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "LIGHT" }));
  expect((await companion.snapshot()).preferences.theme).toBe("light");
  expect(screen.getByRole("button", { name: "LIGHT" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    screen.getByRole("switch", { name: "Automatic uploads" }),
  ).toBeChecked();
  await user.click(screen.getByRole("switch", { name: "Automatic uploads" }));
  expect((await companion.snapshot()).preferences.automaticUploads).toBe(false);
  await user.click(screen.getByRole("button", { name: "CAMPAIGNS" }));
  expect(screen.getByRole("searchbox")).toHaveValue("107");
  expect(screen.getAllByRole("article")).toHaveLength(1);
});

it("signs out the Device session while keeping the configured root", async () => {
  const user = userEvent.setup();
  const companion = createDevelopmentCompanion("active");
  render(<App companion={companion} />);
  await screen.findByRole("heading", { name: /YOUR CAMPAIGNS/ });
  await user.click(screen.getByRole("button", { name: "SETTINGS" }));
  await user.click(screen.getByRole("button", { name: "SIGN OUT" }));

  expect(
    await screen.findByRole("heading", { name: /CONNECT THIS DEVICE/ }),
  ).toBeVisible();
  const snapshot = await companion.snapshot();
  expect(snapshot.session.state).toBe("signed-out");
  expect(snapshot.rootPath).toBe("~/Games/Shadow Cloud");
});

it("requires confirmation before resetting and lets Cancel or Escape leave setup unchanged", async () => {
  const user = userEvent.setup();
  const companion = createDevelopmentCompanion("active");
  const command = vi.spyOn(companion, "command");
  const before = await companion.snapshot();
  render(<App companion={companion} />);
  await user.click(await screen.findByRole("button", { name: "SETTINGS" }));
  const reset = screen.getByRole("button", { name: "RESET COMPANION" });
  await user.click(reset);
  const dialog = screen.getByRole("alertdialog", { name: "RESET COMPANION?" });
  expect(within(dialog).getByRole("button", { name: "CANCEL" })).toHaveFocus();
  expect(dialog).toHaveTextContent(
    "Your local saves and cloud campaigns will not be deleted.",
  );
  expect(command).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(reset).toHaveFocus();
  await user.click(reset);
  await user.click(screen.getByRole("button", { name: "CANCEL" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(command).not.toHaveBeenCalled();
  expect(await companion.snapshot()).toEqual(before);
});

it.each(["active", "offline", "update-required"])(
  "resets from Settings to a fresh Welcome in the %s scenario",
  async (scenario) => {
    const user = userEvent.setup();
    const companion = createDevelopmentCompanion(scenario);
    await companion.command({ type: "set-theme", theme: "light" });
    await companion.command({ type: "set-automatic-uploads", enabled: false });
    await companion.command({ type: "set-paused", paused: true });
    render(<App companion={companion} />);
    await user.click(await screen.findByRole("button", { name: "SETTINGS" }));
    await user.click(screen.getByRole("button", { name: "RESET COMPANION" }));
    await user.click(
      screen.getByRole("button", { name: "RESET AND RESTART SETUP" }),
    );

    expect(
      await screen.findByRole("heading", { name: /WELCOME TO SHADOW CLOUD/ }),
    ).toBeVisible();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(await companion.snapshot()).toMatchObject({
      onboarding: {
        stage: "welcome",
        availableSteps: ["welcome"],
        canSend: false,
      },
      session: {
        state: "signed-out",
        authorizationUrl: null,
        handoffExpiresAt: null,
        credentialStorage: null,
      },
      displayName: null,
      rootPath: null,
      preferences: { theme: "system", automaticUploads: true },
      paused: false,
      readOnly: true,
      campaigns: [],
      activity: [],
    });
    expect(document.documentElement.dataset.theme).toBe("system");
    if (scenario !== "active") return;

    await user.click(screen.getByRole("button", { name: "BEGIN SETUP" }));
    await user.click(
      screen.getByRole("button", { name: "SIGN IN WITH BROWSER" }),
    );
    await user.click(screen.getByRole("button", { name: "Didn't work?" }));
    await user.type(
      screen.getByLabelText("One-use token"),
      "new-development-token",
    );
    await user.click(
      screen.getByRole("button", { name: "CONNECT WITH TOKEN" }),
    );
    await user.click(screen.getByRole("button", { name: "CONTINUE" }));
    expect(
      screen.getByRole("heading", { name: /CHOOSE ROOT DIRECTORY/ }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "CHOOSE FOLDER" }));
    expect((await companion.snapshot()).onboarding.canSend).toBe(false);
    await user.click(await waitForRootContinue());
    await user.click(
      screen.getByRole("button", { name: "CONTINUE TO REVIEW" }),
    );
    await user.click(screen.getByRole("button", { name: "FINISH SETUP" }));
    expect(
      await screen.findByRole("heading", { name: /YOUR CAMPAIGNS/ }),
    ).toBeVisible();
  },
);

it("prevents repeat reset submissions and keeps a failed reset visible and retryable", async () => {
  const user = userEvent.setup();
  const companion = createDevelopmentCompanion("active");
  const before = await companion.snapshot();
  let failReset = (_cause: string) => {};
  const command = vi.spyOn(companion, "command").mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        failReset = reject;
      }),
  );
  render(<App companion={companion} />);
  await user.click(await screen.findByRole("button", { name: "SETTINGS" }));
  await user.click(screen.getByRole("button", { name: "RESET COMPANION" }));
  const dialog = screen.getByRole("alertdialog");
  await user.dblClick(
    within(dialog).getByRole("button", { name: "RESET AND RESTART SETUP" }),
  );
  expect(command).toHaveBeenCalledTimes(1);
  expect(
    within(dialog).getByRole("button", { name: "RESETTING…" }),
  ).toBeDisabled();
  expect(within(dialog).getByRole("button", { name: "CANCEL" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(dialog).toBeVisible();
  failReset("storage-unavailable");
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Reset was not completed",
  );
  expect(await companion.snapshot()).toEqual(before);
  await user.click(
    within(dialog).getByRole("button", { name: "RESET AND RESTART SETUP" }),
  );
  expect(
    await screen.findByRole("heading", { name: /WELCOME TO SHADOW CLOUD/ }),
  ).toBeVisible();
  expect(command).toHaveBeenCalledTimes(2);
});

it("keeps a memory-only Device session warning visible outside Settings", async () => {
  const companion = createDevelopmentCompanion("memory-only");
  render(<App companion={companion} />);

  expect(await screen.findByText("MEMORY-ONLY SESSION")).toBeVisible();
  expect(screen.getByText(/sign in again after quitting/i)).toBeVisible();
  expect(screen.queryByRole("heading", { name: /> SETTINGS/ })).toBeNull();
});

it("keeps development authentication transitions aligned with the engine", async () => {
  const companion = createDevelopmentCompanion("active");

  await expect(
    companion.command({ type: "start-browser-sign-in" }),
  ).rejects.toBe("invalid-onboarding-step");
  await companion.command({ type: "sign-out" });
  const reauthenticated = await companion.command({
    type: "submit-handoff-token",
    token: "another-session",
  });

  expect(reauthenticated.session.state).toBe("signed-in");
  expect(reauthenticated.onboarding.stage).toBe("sign-in");
  expect(reauthenticated.onboarding.canSend).toBe(false);
  const continued = await companion.command({ type: "continue-onboarding" });
  expect(continued.onboarding.stage).toBe("complete");
  expect(continued.onboarding.canSend).toBe(true);
});

it.each([
  ["offline", "authentication-unavailable"],
  ["update-required", "update-required"],
])(
  "rejects browser and pasted-token sign-in in the %s development scenario",
  async (scenario, expectedError) => {
    const companion = createDevelopmentCompanion(scenario);
    await companion.command({ type: "sign-out" });

    await expect(
      companion.command({ type: "start-browser-sign-in" }),
    ).rejects.toBe(expectedError);
    await expect(
      companion.command({
        type: "submit-handoff-token",
        token: "another-session",
      }),
    ).rejects.toBe(expectedError);

    const snapshot = await companion.snapshot();
    expect(snapshot.session.state).toBe("signed-out");
    expect(snapshot.onboarding.stage).toBe("sign-in");
  },
);

it("preserves Campaign visibility and safe conflict choices during protocol mismatch", async () => {
  const user = userEvent.setup();
  const companion = createDevelopmentCompanion("update-required");
  render(<App companion={companion} />);
  await screen.findByText("UPDATE REQUIRED");
  await user.click(screen.getByRole("button", { name: "> RESOLVE CONFLICT" }));
  expect(screen.getByRole("button", { name: "USE LATEST" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "KEEP LOCAL AND PAUSE" }),
  ).toBeEnabled();
  expect(screen.getAllByRole("article")).toHaveLength(5);
  await user.click(screen.getByRole("button", { name: "PAUSE SYNC" }));
  expect(screen.getByRole("button", { name: "RESUME SYNC" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "SETTINGS" }));
  await user.click(screen.getByRole("button", { name: "LIGHT" }));
  expect((await companion.snapshot()).readOnly).toBe(true);
  expect((await companion.snapshot()).preferences.theme).toBe("light");
});

it("shows rejected commands without pretending that a campaign changed", async () => {
  const user = userEvent.setup();
  const development = createDevelopmentCompanion("active");
  const companion = {
    ...development,
    command: vi.fn(async () => {
      throw "not-available";
    }),
  };
  render(<App companion={companion} />);
  await user.click(
    await screen.findByRole("button", { name: "> RESOLVE CONFLICT" }),
  );
  expect(companion.command).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "USE LATEST" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This action is no longer available. Review the current Campaign status and try again.",
  );
  expect((await companion.snapshot()).campaigns[0].syncStatus).toBe("conflict");
});

it("generates selectable diagnostics only when explicitly requested in Settings", async () => {
  const companion = createDevelopmentCompanion("offline");
  const command = vi.spyOn(companion, "command");
  render(<App companion={companion} development />);
  await userEvent.click(
    await screen.findByRole("button", { name: "SETTINGS" }),
  );
  expect(
    screen.queryByRole("region", { name: "Diagnostic report" }),
  ).not.toBeInTheDocument();
  expect(command).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "GENERATE DIAGNOSTICS" }),
  );
  expect(command).toHaveBeenCalledExactlyOnceWith({
    type: "generate-diagnostics",
  });
  const report = screen.getByRole("region", { name: "Diagnostic report" });
  expect(report).toHaveTextContent('"connection": "offline"');
  expect(report).not.toHaveTextContent("~/Games/Shadow Cloud");
  expect(report).toHaveAttribute("tabindex", "0");
});

it("offers update checking during onboarding when protocol mismatch prevents sign-in", async () => {
  const companion = createDevelopmentCompanion("update-required");
  await companion.command({ type: "sign-out" });
  const command = vi.spyOn(companion, "command");
  render(<App companion={companion} development />);
  expect(
    await screen.findByText("UPDATE REQUIRED", { exact: true }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "> CONNECT THIS DEVICE" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "SETTINGS" }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "CHECK FOR UPDATES" }),
  );
  expect(command).toHaveBeenCalledExactlyOnceWith({
    type: "check-for-updates",
  });
  expect(screen.getByText("An update is available.")).toBeVisible();
  expect((await companion.snapshot()).session.state).toBe("signed-out");
});

it("changes native startup and tray preferences through the engine", async () => {
  const companion = createDevelopmentCompanion("active");
  const command = vi.spyOn(companion, "command");
  render(<App companion={companion} development />);
  await userEvent.click(
    await screen.findByRole("button", { name: "SETTINGS" }),
  );
  const startup = screen.getByRole("switch", { name: "Start at login" });
  const tray = screen.getByRole("switch", { name: "Keep running in tray" });
  expect(startup).not.toBeChecked();
  expect(tray).toBeChecked();
  await userEvent.click(startup);
  expect(command).toHaveBeenLastCalledWith({
    type: "set-start-at-login",
    enabled: true,
  });
  expect(startup).toBeChecked();
  await userEvent.click(tray);
  expect(command).toHaveBeenLastCalledWith({
    type: "set-keep-running-in-tray",
    enabled: false,
  });
  expect(tray).not.toBeChecked();
});

it("disables native preference controls when the operating system integration is unavailable", async () => {
  const companion = createDevelopmentCompanion("active");
  const snapshot = await companion.snapshot();
  snapshot.desktop = { trayAvailable: false, startAtLoginAvailable: false };
  render(
    <App
      companion={{ ...companion, snapshot: async () => snapshot }}
      development
    />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "SETTINGS" }),
  );
  expect(screen.getByRole("switch", { name: "Start at login" })).toBeDisabled();
  expect(
    screen.getByRole("switch", { name: "Keep running in tray" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("switch", { name: "Keep running in tray" }),
  ).not.toBeChecked();
  expect(
    screen.getByText("Start at login is unavailable on this system."),
  ).toBeVisible();
  expect(
    screen.getByText("Tray controls are unavailable on this system."),
  ).toBeVisible();
});

it("checks a selected update channel and installs only after confirmation while retaining ordinary candidates", async () => {
  const companion = createDevelopmentCompanion("updates");
  const command = vi.spyOn(companion, "command");
  render(<App companion={companion} development />);
  await userEvent.click(
    await screen.findByRole("button", { name: "SETTINGS" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "CHECK FOR UPDATES" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "REVIEW UPDATE" }));
  await userEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "CANCEL",
    }),
  );
  expect(command).toHaveBeenCalledExactlyOnceWith({
    type: "check-for-updates",
  });
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Update channel" }),
    "preview",
  );
  expect(screen.getByRole("button", { name: "REVIEW UPDATE" })).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "CHECK FOR UPDATES" }),
  );
  const offered = (await companion.snapshot()).updates.offerId;
  await userEvent.click(screen.getByRole("button", { name: "REVIEW UPDATE" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("0.18.0-beta.1");
  await userEvent.click(
    screen.getByRole("button", { name: "INSTALL AND RESTART" }),
  );
  expect(command).toHaveBeenLastCalledWith({
    type: "install-update",
    offerId: offered,
  });
  expect(screen.getByRole("button", { name: "INSTALLING…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "CANCEL" })).toBeDisabled();
  const snapshot = await companion.snapshot();
  expect(snapshot.updates.state).toBe("installing");
  expect(snapshot.campaigns[0].candidates).toHaveLength(2);
});
