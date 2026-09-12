// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { createDevelopmentCompanion } from "../development/companion";
import { Campaigns } from "./Campaigns";

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
