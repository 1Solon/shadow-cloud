import { test, expect } from "./fixture";

test("campaign actions and configuration remain reachable on mobile and desktop", async ({
  page,
  context,
  campaign,
}, testInfo) => {
  campaign.upstream.game.notes = "Campaign rules. ".repeat(50);
  campaign.upstream.game.activePlayerUserId = "browser-successor";
  campaign.upstream.game.activePlayerEntryId = "seat-successor";
  campaign.upstream.game.activePlayerDisplayName = "Browser Successor";
  campaign.upstream.game.currentTurnStartedAt = new Date().toISOString();
  campaign.upstream.game.openTurn = {
    id: "current-turn",
    roundNumber: 1,
    gamePlayerId: "seat-successor",
    userId: "browser-successor",
    seatNumber: 2,
    playerDisplayName: "Browser Successor",
    startedAt: campaign.upstream.game.currentTurnStartedAt,
    endedAt: null,
    completionReason: null,
    reminderCount: 0,
    lastReminderAt: null,
    nextReminderAt: null,
  };
  campaign.upstream.game.fileVersions = [
    {
      id: "latest-save",
      originalName: "42-T1-S2-Browser-Successor.se1",
      uploadedAt: "2026-07-11T12:00:00.000Z",
      uploadedById: "browser-overlord",
      uploadedByDisplayName: "Browser Overlord",
      contentHash: null,
      idempotencyKey: null,
      replacedAt: null,
      replacedByDisplayName: null,
    },
  ];

  for (const width of [400, 639, 640, 767, 768, 1279, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${campaign.url}/games/42`);
    await expect(
      page
        .getByRole("region", { name: "Current turn" })
        .getByRole("button", { name: "Download latest save" }),
    ).toBeInViewport();
    await expect(
      page.getByRole("tab", { name: "Campaign", exact: true }),
    ).toBeInViewport();
    await expect(page.getByTestId("campaign-notes")).not.toHaveAttribute(
      "open",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`campaign-${width}.png`),
      fullPage: true,
    });
    if (width < 640) {
      expect(
        await page
          .getByRole("region", { name: "Save history table", exact: true })
          .evaluate((node) => node.scrollWidth <= node.clientWidth),
      ).toBe(true);
    }
    await page.getByRole("tab", { name: "Timing", exact: true }).click();
    const timings = page.getByRole("table", {
      name: "Recent turn timing history",
      exact: true,
    });
    await expect(timings).toBeVisible();
    await timings.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`timing-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("tab", { name: "Campaign", exact: true }).click();
    await page.getByRole("button", { name: "Configure campaign" }).click();
    await expect(
      page.getByRole("textbox", { name: "Campaign name", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath(`configuration-${width}.png`),
      fullPage: true,
    });
    await page.goto(campaign.url);
    await expect(
      page.getByRole("link").filter({ hasText: "42 : Browser Campaign" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`list-${width}.png`),
      fullPage: true,
    });
  }

  await context.clearCookies();
  await page.setViewportSize({ width: 400, height: 900 });
  await page.goto(campaign.url);
  await expect(
    page.getByRole("button", { name: "Sign in with Discord" }),
  ).toBeVisible();
  const search = page.getByRole("searchbox", {
    name: /Search active campaigns/,
  });
  await search.fill("no matching campaign");
  await expect(page.getByText("No campaigns match your search")).toBeVisible();
  await search.fill("42");
  await expect(
    page.getByRole("link").filter({ hasText: "42 : Browser Campaign" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("list-guest-400.png"),
    fullPage: true,
  });
});
