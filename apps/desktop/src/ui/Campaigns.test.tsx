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
      syncStatus: "needs-attention",
      recovery: null,
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

it("requires an explicit Save-conflict choice while keeping offline recovery actions available", async () => {
  const snapshot = await createDevelopmentCompanion("offline").snapshot();
  snapshot.campaigns = [
    {
      ...snapshot.campaigns[0],
      recovery: "conflict",
      recoveryToken: "review-cloud-first",
      paused: false,
      actions: ["resolve-conflict", "open-web"],
      candidates: [
        {
          contentHash: "sha256:local",
          filename: "local-turn.se1",
          size: 1024,
          modifiedAt: 1000,
          stable: true,
          ignored: false,
          canSend: true,
        },
      ],
    },
  ];
  const send = vi.fn(async () => {});
  const view = render(
    <Campaigns snapshot={snapshot} send={send} pending={false} />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "> RESOLVE CONFLICT" }),
  );
  expect(send).not.toHaveBeenCalled();
  expect(
    screen.getByRole("region", {
      name: "Resolve Save conflict for Black Glass",
    }),
  ).toHaveTextContent(
    "Use latest preserves your local work in a conflict area before receiving the current cloud save.",
  );
  expect(screen.getByRole("button", { name: "USE LATEST" })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Send local-turn.se1" }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "KEEP LOCAL AND PAUSE" }),
  );
  expect(send).toHaveBeenLastCalledWith({
    type: "resolve-campaign",
    campaignId: "black-glass",
    action: "keep-local-and-pause",
  });
  await userEvent.click(screen.getByRole("button", { name: "OPEN WEB" }));
  expect(send).toHaveBeenLastCalledWith({
    type: "campaign-action",
    campaignId: "black-glass",
    action: "open-web",
  });

  snapshot.connection.state = "connected";
  snapshot.readOnly = false;
  view.rerender(<Campaigns snapshot={snapshot} send={send} pending={false} />);
  expect(
    screen.getByRole("button", { name: "Send local-turn.se1" }),
  ).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "USE LATEST" }));
  expect(send).toHaveBeenLastCalledWith({
    type: "resolve-campaign",
    campaignId: "black-glass",
    action: "use-latest",
    reviewToken: "review-cloud-first",
  });
  snapshot.campaigns[0].recoveryToken = "review-cloud-changed";
  view.rerender(<Campaigns snapshot={snapshot} send={send} pending={false} />);
  expect(screen.getByRole("button", { name: "USE LATEST" })).toBeDisabled();
  expect(
    screen.getByText(/The Campaign changed while this review was open/),
  ).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "> CLOSE REVIEW" }));
  await userEvent.click(
    screen.getByRole("button", { name: "> RESOLVE CONFLICT" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "USE LATEST" }));
  expect(send).toHaveBeenLastCalledWith({
    type: "resolve-campaign",
    campaignId: "black-glass",
    action: "use-latest",
    reviewToken: "review-cloud-changed",
  });
});

it("requires current-turn review and a separate Send for stale work and can resume a paused Campaign", async () => {
  const snapshot = await createDevelopmentCompanion("manual").snapshot();
  snapshot.campaigns[0].recovery = "stale";
  snapshot.campaigns[0].recoveryToken = "review-turn-first";
  const send = vi.fn(async () => {});
  const view = render(
    <Campaigns snapshot={snapshot} send={send} pending={false} />,
  );
  expect(
    screen.getByRole("button", { name: "Send completed-turn.se1" }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "REVIEW CURRENT TURN" }),
  );
  expect(send).toHaveBeenCalledExactlyOnceWith({
    type: "resolve-campaign",
    campaignId: "black-glass",
    action: "review-current-turn",
    reviewToken: "review-turn-first",
  });
  snapshot.campaigns[0].recovery = null;
  view.rerender(<Campaigns snapshot={snapshot} send={send} pending={false} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Send completed-turn.se1" }),
  );
  expect(send).toHaveBeenLastCalledWith({
    type: "candidate-action",
    campaignId: "black-glass",
    contentHash: "sha256:development-first",
    action: "send",
  });
  snapshot.campaigns[0].paused = true;
  view.rerender(<Campaigns snapshot={snapshot} send={send} pending={false} />);
  expect(
    screen.getByRole("button", { name: "Send completed-turn.se1" }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "RESUME CAMPAIGN" }),
  );
  expect(send).toHaveBeenLastCalledWith({
    type: "set-campaign-paused",
    campaignId: "black-glass",
    paused: false,
  });
});

it("lets the conflict development scenario preserve work, pause, and receive the cloud save", async () => {
  render(
    <App companion={createDevelopmentCompanion("conflict")} development />,
  );
  const send = await screen.findByRole("button", {
    name: "Send local-turn.se1",
  });
  expect(send).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "Ignore local-turn.se1" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Restore local-turn.se1" }),
  );
  expect(
    screen.getByRole("button", { name: "Send local-turn.se1" }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "> RESOLVE CONFLICT" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "KEEP LOCAL AND PAUSE" }),
  );
  expect(screen.getByText("local-turn.se1")).toBeVisible();
  expect(screen.getByRole("button", { name: "USE LATEST" })).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "RESUME CAMPAIGN" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "USE LATEST" }));
  expect(
    screen.getByText("Local work preserved; current cloud save received."),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Send local-turn.se1" }),
  ).not.toBeInTheDocument();
});

it("lets the stale development scenario review state without submitting the Turn candidate", async () => {
  render(<App companion={createDevelopmentCompanion("stale")} development />);
  expect(
    await screen.findByRole("button", { name: "Send local-turn.se1" }),
  ).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "REVIEW CURRENT TURN" }),
  );
  expect(screen.getByText("local-turn.se1")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Send local-turn.se1" }),
  ).toBeEnabled();
  expect(screen.queryByText(/Sends in/)).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Send local-turn.se1" }),
  );
  expect(screen.getByText("Submission accepted")).toBeVisible();
});
