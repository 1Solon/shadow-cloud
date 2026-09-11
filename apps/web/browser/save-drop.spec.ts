import type { Page } from "@playwright/test";
import { test, expect } from "./fixture";

async function dropSave(page: Page, fileName: string) {
  const dataTransfer = await page.evaluateHandle((name) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["synthetic-save"], name, {
        type: "application/octet-stream",
      }),
    );
    return transfer;
  }, fileName);

  await page
    .getByRole("region", { name: "Current turn" })
    .getByText("Latest save", { exact: true })
    .dispatchEvent("drop", { dataTransfer });
  await dataTransfer.dispose();
}

test("save drops beside the uploader are staged or safely rejected", async ({
  page,
  campaign,
}) => {
  campaign.upstream.game.fileVersions = [
    {
      id: "latest-save",
      originalName: "42-T1-S1-Browser-Overlord.se1",
      uploadedAt: "2026-09-11T12:00:00.000Z",
      uploadedById: "browser-successor",
      uploadedByDisplayName: "Browser Successor",
      contentHash: null,
      contentRevision: 0,
      idempotencyKey: null,
      replacedAt: null,
      replacedByDisplayName: null,
    },
  ];

  await page.goto(`${campaign.url}/games/42`);
  await dropSave(page, "42-T1-S1-complete.se1");
  await expect(
    page.getByRole("button", {
      name: "Selected save file 42-T1-S1-complete.se1",
    }),
  ).toBeVisible();

  campaign.upstream.game.activePlayerUserId = "browser-successor";
  campaign.upstream.game.activePlayerEntryId = "seat-successor";
  campaign.upstream.game.activePlayerDisplayName = "Browser Successor";
  await page.reload();
  await dropSave(page, "42-T1-S1-complete.se1");
  await expect(page.getByRole("status")).toHaveText(
    "It is currently Browser Successor’s turn. Only the active lord can upload this save.",
  );
  await expect(page).toHaveURL(`${campaign.url}/games/42`);
});
