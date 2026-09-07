import { test, expect } from "./fixture";

test("reset and undo feedback survives revision-changing campaign refreshes", async ({
  page,
  campaign,
}) => {
  const file = {
    id: "synthetic",
    originalName: "synthetic.se1",
    uploadedAt: "2026-09-01T00:00:00Z",
    uploadedById: "browser-overlord",
    uploadedByDisplayName: "Browser Overlord",
    contentHash: null,
    contentRevision: 0,
    idempotencyKey: null,
    replacedAt: null as string | null,
    replacedByDisplayName: null as string | null,
  };
  campaign.upstream.game.fileVersions = [file];
  await page.route("**/api/games/42/save-inspection", (route) =>
    route.fulfill({
      json: {
        fileVersionId: file.id,
        sourceId: "synthetic-source",
        expectedSaveBaseline: `baseline-${file.contentRevision}`,
        regimes: [
          {
            id: "north",
            name: "North Reach",
            current: true,
            eligible: true,
            reason: null,
          },
        ],
      },
    }),
  );
  // Mutations are synthetic at the HTTP boundary; refresh uses the real Next
  // campaign page and reads the changed revision from the upstream fixture.
  await page.route("**/api/games/42/password-reset{,/undo}", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          undo: {
            resetId: "reset",
            outputId: "output",
            outputRevision: file.contentRevision,
            expectedSaveBaseline: `baseline-${file.contentRevision}`,
            regimeName: "North Reach",
          },
        },
      });
    file.contentRevision += 1;
    file.replacedAt = `2026-09-07T10:0${file.contentRevision}:00Z`;
    file.replacedByDisplayName = "Browser Overlord";
    return route.fulfill({ json: { regimeName: "North Reach" } });
  });
  await page.goto(`${campaign.url}/games/42`);
  await page.getByRole("tab", { name: "Saves", exact: true }).click();
  const inspection = page.getByRole("region", {
    name: "In-game regime inspection",
  });
  await inspection.getByRole("button", { name: "Inspect regimes" }).click();
  await inspection.getByRole("button", { name: "Choose North Reach" }).click();
  await inspection
    .getByLabel("Replacement password", { exact: true })
    .fill("SyntheticReplacement");
  await inspection
    .getByLabel(
      "Reset the password for North Reach. I have read the restart warning.",
    )
    .check();
  await inspection
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  const history = page.getByRole("region", { name: "Save history table" });
  await expect(
    history.locator('time[datetime="2026-09-07T10:01:00Z"]'),
  ).toBeVisible();
  await expect(inspection.getByRole("status")).toContainText(
    "The in-game password for North Reach was reset.",
  );
  await expect(inspection.getByRole("status")).toContainText(
    "The latest save has been replaced; the turn has not advanced.",
  );
  await expect(
    inspection.getByLabel("Replacement password", { exact: true }),
  ).toHaveCount(0);
  await expect(
    inspection.getByRole("button", { name: "Choose North Reach" }),
  ).toHaveCount(0);
  await inspection
    .getByRole("button", { name: "Check undo availability" })
    .click();
  await inspection
    .getByLabel("Restore the previous password for North Reach.")
    .check();
  await inspection
    .getByRole("button", { name: "Undo password reset", exact: true })
    .click();
  await expect(
    history.locator('time[datetime="2026-09-07T10:02:00Z"]'),
  ).toBeVisible();
  await expect(inspection.getByRole("status")).toContainText(
    "The previous password for North Reach was restored.",
  );
  await expect(inspection.getByRole("status")).toContainText(
    "The latest save has been replaced; the turn has not advanced.",
  );
  await expect(inspection.getByRole("checkbox")).toHaveCount(0);
  // A subsequent page read still sees the replacement metadata.
  await page.reload();
  await page.getByRole("tab", { name: "Saves", exact: true }).click();
  await expect(
    history.locator('time[datetime="2026-09-07T10:02:00Z"]'),
  ).toBeVisible();
});

test("Overlord regime inspection renders on desktop and mobile without changing a save", async ({
  page,
  campaign,
}) => {
  campaign.upstream.game.fileVersions = [
    {
      id: "synthetic",
      originalName: "synthetic.se1",
      uploadedAt: "2026-09-01T00:00:00Z",
      uploadedById: "browser-overlord",
      uploadedByDisplayName: "Browser Overlord",
      contentHash: null,
      idempotencyKey: null,
      replacedAt: null,
      replacedByDisplayName: null,
    },
  ];
  // Thin visual check only. Signed proxy and real-storage operation are tested
  // separately; this route supplies allowlisted synthetic inspection metadata.
  await page.route("**/api/games/42/save-inspection", (route) =>
    route.fulfill({
      json: {
        fileVersionId: "synthetic",
        sourceId: "synthetic-source",
        expectedSaveBaseline: "baseline",
        regimes: [
          {
            id: "north",
            name: "North Reach",
            current: true,
            eligible: true,
            reason: null,
          },
          {
            id: "south",
            name: "South Reach",
            current: false,
            eligible: false,
            reason: "This regime has no existing password.",
          },
          {
            id: "long",
            name: "N".repeat(256),
            current: false,
            eligible: true,
            reason: null,
          },
        ],
      },
    }),
  );
  await page.route("**/api/games/42/password-reset", (route) =>
    route.fulfill({
      json: {
        undo: {
          resetId: "reset",
          outputId: "output",
          outputRevision: 1,
          expectedSaveBaseline: "baseline",
          regimeName: "North Reach",
        },
      },
    }),
  );
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect((await page.goto(`${campaign.url}/games/42`))?.status()).toBe(200);
    await page.getByRole("tab", { name: "Saves", exact: true }).click();
    await page.getByRole("button", { name: "Inspect regimes" }).click();
    const inspection = page.getByRole("region", {
      name: "In-game regime inspection",
    });
    await expect(
      inspection.getByText("North Reach", { exact: true }),
    ).toBeVisible();
    await expect(inspection.getByText("Current regime")).toBeVisible();
    await expect(
      inspection.getByText("This regime has no existing password."),
    ).toBeVisible();
    const bounds = await inspection.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(
      await inspection.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await expect(inspection.locator("input")).toHaveCount(0);
    await inspection
      .getByRole("button", { name: "Choose North Reach", exact: true })
      .click();
    await expect(
      inspection.getByText("Players must use the updated save"),
    ).toBeVisible();
    await inspection
      .getByLabel("Replacement password", { exact: true })
      .fill("BrowserSynthetic");
    await inspection.getByLabel("Reveal replacement password").check();
    await expect(
      inspection.getByRole("textbox", { name: "Replacement password" }),
    ).toHaveValue("BrowserSynthetic");
    expect(
      await inspection.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await inspection
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await inspection
      .getByRole("button", { name: "Check undo availability" })
      .click();
    await expect(
      inspection.getByText(
        "The previous password for North Reach will be restored. It will not be shown.",
      ),
    ).toBeVisible();
    await expect(
      inspection.getByRole("button", {
        name: "Undo password reset",
        exact: true,
      }),
    ).toBeDisabled();
    await inspection
      .getByLabel("Restore the previous password for North Reach.")
      .check();
    await expect(
      inspection.getByRole("button", {
        name: "Undo password reset",
        exact: true,
      }),
    ).toBeEnabled();
    expect(
      await inspection.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await inspection
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
  }
  await page.context().clearCookies();
  await page.reload();
  await page.getByRole("tab", { name: "Saves", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Inspect regimes" }),
  ).toHaveCount(0);
  expect(
    campaign.upstream.requests.every((request) => request.method === "GET"),
  ).toBe(true);
});
