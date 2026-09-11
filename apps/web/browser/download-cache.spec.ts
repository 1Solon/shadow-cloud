import { readFile } from "node:fs/promises";
import { test, expect } from "./fixture";

test("a corrected save uses a revisioned URL and cannot be browser-cached", async ({
  page,
  campaign,
}) => {
  campaign.upstream.game.fileVersions = [
    {
      contentRevision: 4,
      id: "corrected-save",
      originalName: "42-T1-S1-Browser.se1",
      uploadedAt: "2026-09-08T17:08:15.268Z",
      uploadedById: "browser-overlord",
      uploadedByDisplayName: "Browser Overlord",
      contentHash: null,
      idempotencyKey: null,
      replacedAt: "2026-09-11T13:00:38.000Z",
      replacedByDisplayName: "Browser Overlord",
    },
  ];

  await page.goto(`${campaign.url}/games/42`);

  const [request, download] = await Promise.all([
    page.waitForRequest((candidate) =>
      candidate.url().includes("/api/games/42/files/corrected-save"),
    ),
    page.waitForEvent("download"),
    page
      .getByTestId("command-center-body")
      .getByRole("button", { name: "Download latest save" })
      .click(),
  ]);

  expect(new URL(request.url()).searchParams.get("revision")).toBe("4");
  expect(download.suggestedFilename()).toBe("42-T1-S1-Browser.se1");
  const downloadedPath = await download.path();
  if (!downloadedPath)
    throw new Error("The corrected save was not downloaded.");
  expect(await readFile(downloadedPath)).toEqual(Buffer.from("corrected save"));

  const response = await page.request.get(request.url());
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.body()).toEqual(Buffer.from("corrected save"));
});
