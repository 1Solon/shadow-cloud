import { test, expect } from "./fixture";

for (const action of ["reset", "undo"] as const) {
  test(`${action} keeps an uncertain outcome visible after fresh read-only recovery, without replay`, async ({
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
        contentRevision: 1,
        idempotencyKey: null,
        replacedAt: null,
        replacedByDisplayName: null,
      },
    ];
    let inspections = 0;
    let recoveryReads = 0;
    let posts = 0;
    await page.route("**/api/games/42/save-inspection", (route) => {
      inspections += 1;
      return route.fulfill({
        json: {
          fileVersionId: "synthetic",
          contentRevision: 1,
          sourceId: "source",
          expectedSaveBaseline: `inspection-${inspections}`,
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
      });
    });
    await page.route("**/api/games/42/password-reset{,/undo}", (route) => {
      if (route.request().method() === "GET") {
        recoveryReads += 1;
        return route.fulfill({
          json: {
            undo:
              action === "undo" || posts > 0
                ? {
                    resetId: "reset",
                    outputId: "output",
                    outputRevision: 1,
                    expectedSaveBaseline: `recovery-${recoveryReads}`,
                    regimeName: "North Reach",
                  }
                : null,
          },
        });
      }
      posts += 1;
      return action === "reset"
        ? route.fulfill({ json: { regimeName: "North Reach" } })
        : route.abort("connectionreset");
    });
    await page.goto(`${campaign.url}/games/42`);
    await page.getByRole("tab", { name: "Regimes", exact: true }).click();
    const workflow = page.getByRole("region", {
      name: "In-game regime inspection",
    });
    if (action === "reset") {
      await workflow.getByRole("button", { name: "Edit Password" }).click();
      await workflow
        .getByLabel("Replacement password", { exact: true })
        .fill("SyntheticSecret");
      await workflow
        .getByLabel(
          "Reset the password for North Reach. I have read the restart warning.",
        )
        .check();
      await workflow
        .getByRole("button", { name: "Reset password", exact: true })
        .click();
    } else {
      await workflow
        .getByLabel("Restore the previous password for North Reach.")
        .check();
      await workflow
        .getByRole("button", { name: "Undo password reset", exact: true })
        .click();
    }
    await expect(workflow.getByRole("alert")).toContainText("Outcome unknown");
    await expect.poll(() => inspections).toBe(2);
    await expect.poll(() => recoveryReads).toBe(2);
    await expect(workflow.getByRole("status")).toHaveCount(0);
    await expect(
      workflow.getByRole("button", { name: "Undo password reset" }),
    ).toBeDisabled();
    await expect(
      workflow.getByLabel("Restore the previous password for North Reach."),
    ).not.toBeChecked();
    await workflow.getByRole("button", { name: "Edit Password" }).click();
    await expect(
      workflow.getByLabel("Replacement password", { exact: true }),
    ).toHaveValue("");
    await expect(
      workflow.getByRole("button", { name: "Reset password", exact: true }),
    ).toBeDisabled();
    expect(posts).toBe(1);
  });
}

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
  let inspectionRequests = 0;
  let availabilityRequests = 0;
  let undoAvailable = false;
  await page.route("**/api/games/42/save-inspection", (route) => {
    inspectionRequests += 1;
    return route.fulfill({
      json: {
        fileVersionId: file.id,
        contentRevision: file.contentRevision,
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
    });
  });
  // Mutations are synthetic at the HTTP boundary; refresh uses the real Next
  // campaign page and reads the changed revision from the upstream fixture.
  await page.route("**/api/games/42/password-reset{,/undo}", (route) => {
    if (route.request().method() === "GET") {
      availabilityRequests += 1;
      return route.fulfill({
        json: {
          undo: undoAvailable
            ? {
                resetId: "reset",
                outputId: "output",
                outputRevision: file.contentRevision,
                expectedSaveBaseline: `baseline-${file.contentRevision}`,
                regimeName: "North Reach",
              }
            : null,
        },
      });
    }
    file.contentRevision += 1;
    file.replacedAt = `2026-09-07T10:0${file.contentRevision}:00Z`;
    file.replacedByDisplayName = "Browser Overlord";
    undoAvailable = route.request().url().endsWith("/password-reset");
    return route.fulfill({
      json: {
        resetId: "reset",
        fileVersionId: file.id,
        contentRevision: file.contentRevision,
        regimeName: "North Reach",
        replacedAt: file.replacedAt,
      },
    });
  });
  await page.goto(`${campaign.url}/games/42`);
  expect(inspectionRequests).toBe(0);
  expect(availabilityRequests).toBe(0);
  await page.getByRole("tab", { name: "Regimes", exact: true }).click();
  const inspection = page.getByRole("region", {
    name: "In-game regime inspection",
  });
  await expect.poll(() => inspectionRequests).toBe(1);
  await expect.poll(() => availabilityRequests).toBeGreaterThan(0);
  await inspection.getByRole("button", { name: "Edit Password" }).click();
  await inspection
    .getByLabel("Replacement password", { exact: true })
    .fill("SyntheticReplacement");
  await page.getByRole("tab", { name: "Saves", exact: true }).click();
  await page.getByRole("tab", { name: "Regimes", exact: true }).click();
  await expect(
    inspection.getByLabel("Replacement password", { exact: true }),
  ).toHaveValue("SyntheticReplacement");
  await inspection
    .getByLabel(
      "Reset the password for North Reach. I have read the restart warning.",
    )
    .check();
  await inspection
    .getByRole("button", { name: "Reset password", exact: true })
    .click();
  await expect.poll(() => file.contentRevision).toBe(1);
  const history = page.getByRole("region", { name: "Save history table" });
  await page.getByRole("tab", { name: "Saves", exact: true }).click();
  await expect(
    history.locator('time[datetime="2026-09-07T10:01:00Z"]'),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Regimes", exact: true }).click();
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
    inspection.getByRole("button", { name: "Edit Password" }),
  ).toBeVisible();
  await inspection
    .getByLabel("Restore the previous password for North Reach.")
    .check();
  await inspection
    .getByRole("button", { name: "Undo password reset", exact: true })
    .click();
  await page.getByRole("tab", { name: "Saves", exact: true }).click();
  await expect(
    history.locator('time[datetime="2026-09-07T10:02:00Z"]'),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Regimes", exact: true }).click();
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
      contentRevision: 0,
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
        contentRevision: 0,
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
  let undoAvailable = false;
  await page.route("**/api/games/42/password-reset", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            undo: undoAvailable
              ? {
                  resetId: "reset",
                  outputId: "output",
                  outputRevision: 1,
                  expectedSaveBaseline: "baseline",
                  regimeName: "North Reach",
                }
              : null,
          },
        })
      : route.fulfill({
          json: {
            resetId: "reset",
            fileVersionId: "synthetic",
            contentRevision: 1,
            regimeName: "North Reach",
            replacedAt: "2026-09-08T10:00:00Z",
          },
        }),
  );
  for (const width of [1280, 390]) {
    undoAvailable = false;
    await page.setViewportSize({ width, height: 900 });
    expect((await page.goto(`${campaign.url}/games/42`))?.status()).toBe(200);
    await page.getByRole("tab", { name: "Regimes", exact: true }).click();
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
      .getByRole("listitem")
      .filter({ has: page.getByText("North Reach", { exact: true }) })
      .getByRole("button", { name: "Edit Password", exact: true })
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
    undoAvailable = true;
    await inspection
      .getByRole("button", { name: "Cancel", exact: true })
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
  await expect(
    page.getByRole("tab", { name: "Regimes", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Refresh", exact: true }),
  ).toHaveCount(0);
  expect(
    campaign.upstream.requests.every((request) => request.method === "GET"),
  ).toBe(true);
});
