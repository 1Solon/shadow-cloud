// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { createDevelopmentCompanion } from "../development/companion";
import { App } from "./App";

afterEach(cleanup);

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
  expect(screen.getByText("Preferences")).toBeVisible();
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

it("preserves campaign visibility during protocol mismatch and never optimistically performs an unavailable action", async () => {
  const user = userEvent.setup();
  const companion = createDevelopmentCompanion("update-required");
  render(<App companion={companion} />);
  await screen.findByText("UPDATE REQUIRED");
  expect(
    screen.getByRole("button", { name: "> RESOLVE CONFLICT" }),
  ).toBeDisabled();
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
  const companion = createDevelopmentCompanion("active");
  render(<App companion={companion} />);
  await user.click(
    await screen.findByRole("button", { name: "> RESOLVE CONFLICT" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "No files were changed",
  );
  expect((await companion.snapshot()).campaigns[0].syncStatus).toBe("conflict");
});
