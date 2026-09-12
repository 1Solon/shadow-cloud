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
