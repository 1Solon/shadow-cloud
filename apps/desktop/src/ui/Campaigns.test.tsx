// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createDevelopmentCompanion } from "../development/companion";
import { Campaigns } from "./Campaigns";
import { App } from "./App";

afterEach(cleanup);
it("shows receive failures and requests an explicit current-save redownload through the engine", async () => {
  const snapshot = await createDevelopmentCompanion("active").snapshot();
  snapshot.campaigns = [
    {
      ...snapshot.campaigns[0],
      syncStatus: "needs-attention",
      statusLabel: "Current save missing",
      detail: "The received save was deleted. Redownload it when needed.",
      actions: ["redownload-current"],
    },
  ];
  const send = vi.fn(async () => {});
  render(<Campaigns snapshot={snapshot} send={send} pending={false} />);
  expect(screen.getByText("Current save missing")).toBeVisible();
  expect(
    screen.getByText(
      "The received save was deleted. Redownload it when needed.",
    ),
  ).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "REDOWNLOAD CURRENT SAVE" }),
  );
  expect(send).toHaveBeenCalledWith({
    type: "campaign-action",
    campaignId: snapshot.campaigns[0].id,
    action: "redownload-current",
  });
});

it("shows candidate facts and sends only the exact candidate the player selected", async () => {
  const snapshot = await createDevelopmentCompanion("active").snapshot();
  snapshot.campaigns = [
    {
      ...snapshot.campaigns[0],
      actions: [],
      candidates: [
        {
          contentHash: "sha256:first",
          filename: "first.se1",
          size: 1024,
          modifiedAt: 1000,
          stable: true,
          ignored: false,
          canSend: true,
        },
        {
          contentHash: "sha256:second",
          filename: "second.se1",
          size: 2048,
          modifiedAt: 2000,
          stable: false,
          ignored: false,
          canSend: false,
        },
      ],
    },
  ];
  const send = vi.fn(async () => {});
  render(<Campaigns snapshot={snapshot} send={send} pending={false} />);
  expect(screen.getByText("first.se1")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Send second.se1" }),
  ).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Send first.se1" }));
  expect(send).toHaveBeenCalledWith({
    type: "candidate-action",
    campaignId: snapshot.campaigns[0].id,
    contentHash: "sha256:first",
    action: "send",
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Ignore first.se1" }),
  );
  expect(send).toHaveBeenLastCalledWith({
    type: "candidate-action",
    campaignId: snapshot.campaigns[0].id,
    contentHash: "sha256:first",
    action: "ignore",
  });
});

it("keeps cancellation available offline and binds it to the displayed countdown", async () => {
  const snapshot = await createDevelopmentCompanion("offline").snapshot();
  snapshot.campaigns = [
    {
      ...snapshot.campaigns[1],
      countdown: {
        authorizationId: "countdown-first",
        contentHash: "sha256:first",
        remainingSeconds: 15,
      },
      actions: ["cancel-automatic-send", "open-folder"],
    },
  ];
  const send = vi.fn(async () => {});
  const view = render(
    <Campaigns snapshot={snapshot} send={send} pending={false} />,
  );
  expect(screen.getByText("Sends in 00:15")).toBeVisible();
  const cancel = screen.getByRole("button", { name: "> CANCEL SEND" });
  expect(cancel).toBeEnabled();
  expect(screen.getByRole("button", { name: "OPEN FOLDER" })).toBeDisabled();
  await userEvent.click(cancel);
  expect(send).toHaveBeenLastCalledWith({
    type: "cancel-automatic-send",
    campaignId: "long-meridian",
    authorizationId: "countdown-first",
  });

  snapshot.campaigns[0].countdown = {
    authorizationId: "countdown-changed-contents",
    contentHash: "sha256:changed",
    remainingSeconds: 15,
  };
  view.rerender(<Campaigns snapshot={snapshot} send={send} pending={false} />);
  await userEvent.click(cancel);
  expect(send).toHaveBeenLastCalledWith({
    type: "cancel-automatic-send",
    campaignId: "long-meridian",
    authorizationId: "countdown-changed-contents",
  });
});

it("lets each Campaign inherit the global send preference or choose an override", async () => {
  const snapshot = await createDevelopmentCompanion("offline").snapshot();
  snapshot.campaigns = [
    { ...snapshot.campaigns[0], automaticMode: "inherit", actions: [] },
  ];
  const send = vi.fn(async () => {});
  const view = render(
    <Campaigns snapshot={snapshot} send={send} pending={false} />,
  );
  const preference = screen.getByRole("combobox", {
    name: "Automatic sends for Black Glass",
  });
  expect(preference).toHaveValue("inherit");
  expect(
    screen.getByRole("option", { name: "Use global setting (Automatic)" }),
  ).toBeInTheDocument();
  await userEvent.selectOptions(preference, "manual");
  expect(send).toHaveBeenLastCalledWith({
    type: "set-campaign-automatic-uploads",
    campaignId: "black-glass",
    mode: "manual",
  });

  snapshot.campaigns[0].automaticMode = "manual";
  snapshot.campaigns[0].automaticUploads = false;
  snapshot.preferences.automaticUploads = false;
  view.rerender(<Campaigns snapshot={snapshot} send={send} pending={false} />);
  expect(preference).toHaveValue("manual");
  expect(
    screen.getByRole("option", { name: "Use global setting (Manual)" }),
  ).toBeInTheDocument();
  await userEvent.selectOptions(preference, "automatic");
  expect(send).toHaveBeenLastCalledWith({
    type: "set-campaign-automatic-uploads",
    campaignId: "black-glass",
    mode: "automatic",
  });
  await userEvent.selectOptions(preference, "inherit");
  expect(send).toHaveBeenLastCalledWith({
    type: "set-campaign-automatic-uploads",
    campaignId: "black-glass",
    mode: "inherit",
  });
});

it("lets the automatic development scenario cancel and retain an ordinary Turn candidate", async () => {
  render(
    <App companion={createDevelopmentCompanion("automatic")} development />,
  );
  expect(await screen.findByText("Sends in 00:15")).toBeVisible();
  expect(screen.getByText("completed-turn.se1")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "> CANCEL SEND" }));
  expect(screen.queryByText("Sends in 00:15")).not.toBeInTheDocument();
  expect(screen.getByText("Automatic send cancelled")).toBeVisible();
  expect(screen.getByText("completed-turn.se1")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Send completed-turn.se1" }),
  ).toBeEnabled();
  await userEvent.selectOptions(
    screen.getByRole("combobox", {
      name: "Automatic sends for Long Meridian",
    }),
    "manual",
  );
  expect(
    screen.getByRole("combobox", {
      name: "Automatic sends for Long Meridian",
    }),
  ).toHaveValue("manual");
  expect(screen.getByText("completed-turn.se1")).toBeVisible();
});
