// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createDevelopmentCompanion } from "../development/companion";
import { Updates } from "./Updates";

afterEach(cleanup);

it("requires explicit consent for the displayed update and initially focuses Cancel", async () => {
  const snapshot = await createDevelopmentCompanion("active").snapshot();
  snapshot.updates = {
    state: "available",
    version: "0.17.0",
    offerId: "offer-first",
    installBlockers: [],
    detail: null,
  };
  const send = vi.fn(async () => {});
  render(
    <Updates
      snapshot={snapshot}
      send={send}
      pending={false}
      error={null}
      dismissError={() => {}}
    />,
  );
  expect(send).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "REVIEW UPDATE" }));
  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toHaveTextContent("0.17.0");
  expect(within(dialog).getByRole("button", { name: "CANCEL" })).toHaveFocus();
  expect(send).not.toHaveBeenCalled();
  await userEvent.click(
    within(dialog).getByRole("button", { name: "INSTALL AND RESTART" }),
  );
  expect(send).toHaveBeenCalledExactlyOnceWith({
    type: "install-update",
    offerId: "offer-first",
  });
});

it("refuses consent after the update offer changes until the new offer is reviewed", async () => {
  const snapshot = await createDevelopmentCompanion("active").snapshot();
  snapshot.updates = {
    state: "available",
    version: "0.17.0",
    offerId: "offer-first",
    installBlockers: [],
    detail: null,
  };
  const send = vi.fn(async () => {});
  const view = render(
    <Updates
      snapshot={snapshot}
      send={send}
      pending={false}
      error={null}
      dismissError={() => {}}
    />,
  );
  const review = screen.getByRole("button", { name: "REVIEW UPDATE" });
  await userEvent.click(review);
  snapshot.updates.offerId = "offer-second";
  snapshot.updates.version = "0.17.1";
  view.rerender(
    <Updates
      snapshot={snapshot}
      send={send}
      pending={false}
      error={null}
      dismissError={() => {}}
    />,
  );
  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toHaveTextContent("INSTALL COMPANION 0.17.0?");
  expect(
    within(dialog).getByRole("button", { name: "INSTALL AND RESTART" }),
  ).toBeDisabled();
  expect(dialog).toHaveTextContent(
    "The available update changed. Cancel and review it again before installing.",
  );
  await userEvent.click(within(dialog).getByRole("button", { name: "CANCEL" }));
  expect(review).toHaveFocus();
  expect(send).not.toHaveBeenCalled();
  await userEvent.click(review);
  await userEvent.click(
    screen.getByRole("button", { name: "INSTALL AND RESTART" }),
  );
  expect(send).toHaveBeenCalledExactlyOnceWith({
    type: "install-update",
    offerId: "offer-second",
  });
});

it("blocks installation when safety work appears after review, including paused conflicts and uncertain receipts", async () => {
  const snapshot = await createDevelopmentCompanion("active").snapshot();
  snapshot.updates = {
    state: "available",
    version: "0.17.0",
    offerId: "offer-first",
    installBlockers: [],
    detail: null,
  };
  const send = vi.fn(async () => {});
  const view = render(
    <Updates
      snapshot={snapshot}
      send={send}
      pending={false}
      error={null}
      dismissError={() => {}}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "REVIEW UPDATE" }));
  snapshot.paused = true;
  snapshot.updates.installBlockers = [
    "countdown",
    "transfer",
    "uncertain-submission",
    "conflict",
  ];
  view.rerender(
    <Updates
      snapshot={snapshot}
      send={send}
      pending={false}
      error={null}
      dismissError={() => {}}
    />,
  );
  const dialog = screen.getByRole("alertdialog");
  const install = within(dialog).getByRole("button", {
    name: "INSTALL AND RESTART",
  });
  expect(install).toBeDisabled();
  expect(dialog).toHaveTextContent(
    "Cancel or finish automatic-send countdowns.",
  );
  expect(dialog).toHaveTextContent("Wait for active transfers to finish.");
  expect(dialog).toHaveTextContent(
    "Pausing does not settle an uncertain submission.",
  );
  expect(dialog).toHaveTextContent("Paused conflicts still need a resolution.");
  await userEvent.click(install);
  expect(send).not.toHaveBeenCalled();
  snapshot.updates.installBlockers = [];
  view.rerender(
    <Updates
      snapshot={snapshot}
      send={send}
      pending={false}
      error={null}
      dismissError={() => {}}
    />,
  );
  await userEvent.click(install);
  expect(send).toHaveBeenCalledExactlyOnceWith({
    type: "install-update",
    offerId: "offer-first",
  });
});

it("checks updates and changes channels while Campaign changes are read-only", async () => {
  const snapshot =
    await createDevelopmentCompanion("update-required").snapshot();
  const send = vi.fn(async () => {});
  const view = render(
    <Updates
      snapshot={snapshot}
      send={send}
      pending={false}
      error={null}
      dismissError={() => {}}
    />,
  );
  expect(
    screen.getByText(/Publisher signing and macOS notarization are deferred/),
  ).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "CHECK FOR UPDATES" }),
  );
  expect(send).toHaveBeenCalledExactlyOnceWith({ type: "check-for-updates" });
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Update channel" }),
    "preview",
  );
  expect(send).toHaveBeenLastCalledWith({
    type: "set-update-channel",
    channel: "preview",
  });
  snapshot.updates.state = "checking";
  view.rerender(
    <Updates
      snapshot={snapshot}
      send={send}
      pending={false}
      error={null}
      dismissError={() => {}}
    />,
  );
  expect(screen.getByText("Checking for updates…")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "CHECK FOR UPDATES" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("combobox", { name: "Update channel" }),
  ).toBeDisabled();
  expect(send).toHaveBeenCalledTimes(2);
});

it("shows installation progress after consent consumes the offer and permits cancellation after failure", async () => {
  const snapshot = await createDevelopmentCompanion("updates").snapshot();
  snapshot.updates = {
    state: "available",
    version: "0.17.0",
    offerId: "offer-first",
    installBlockers: [],
    detail: null,
  };
  const send = vi.fn(async () => {});
  const view = render(
    <Updates
      snapshot={snapshot}
      send={send}
      pending={false}
      error={null}
      dismissError={() => {}}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "REVIEW UPDATE" }));
  await userEvent.click(
    screen.getByRole("button", { name: "INSTALL AND RESTART" }),
  );
  snapshot.updates.state = "installing";
  snapshot.updates.offerId = null;
  view.rerender(
    <Updates
      snapshot={snapshot}
      send={send}
      pending={false}
      error={null}
      dismissError={() => {}}
    />,
  );
  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toHaveTextContent(
    "Installing the update. The Companion will restart.",
  );
  expect(
    within(dialog).queryByText(/The available update changed/),
  ).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "CANCEL" })).toBeDisabled();
  snapshot.updates.state = "error";
  snapshot.updates.detail = "The update signature could not be verified.";
  view.rerender(
    <Updates
      snapshot={snapshot}
      send={send}
      pending={false}
      error={null}
      dismissError={() => {}}
    />,
  );
  expect(dialog).toHaveTextContent(
    "The update signature could not be verified.",
  );
  expect(
    within(dialog).getByRole("button", { name: "INSTALL AND RESTART" }),
  ).toBeDisabled();
  await userEvent.click(within(dialog).getByRole("button", { name: "CANCEL" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});
