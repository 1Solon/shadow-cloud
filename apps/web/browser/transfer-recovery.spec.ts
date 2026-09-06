import { test, expect } from "./fixture";
import type { Page } from "@playwright/test";

async function openIdentity(page: Page) {
  await page.getByRole("tab", { name: "Campaign", exact: true }).click();
  const configure = page.getByRole("button", {
    name: "Configure campaign",
    exact: true,
  });
  if (await configure.isVisible()) await configure.click();
}

test("same-number confirmed retry and later section edits never replay committed metadata", async ({
  page,
  campaign,
}) => {
  campaign.upstream.transfer.push(
    { kind: "confirmed-failure" },
    { kind: "confirmed-failure" },
  );
  await page.goto(`${campaign.url}/games/42`);
  await openIdentity(page);
  await page
    .getByLabel("Campaign name", { exact: true })
    .fill("Saved before rejected transfer");
  await page
    .getByRole("combobox", { name: /^Overlord/ })
    .selectOption("seat-successor");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Campaign details saved; Overlord transfer failed.",
  );
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect
    .poll(
      () =>
        campaign.upstream.requests.filter(
          (request) => request.method === "POST",
        ).length,
    )
    .toBe(2);
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Campaign details saved; Overlord transfer failed.",
  );
  await expect(
    page.getByRole("button", { name: "Confirm", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox", { name: /^Overlord/ })).toBeFocused();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Exit configuration", exact: true })
    .click();
  await openIdentity(page);
  await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue(
    "Saved before rejected transfer",
  );
  await expect(page.getByRole("combobox", { name: /^Overlord/ })).toHaveValue(
    "seat-overlord",
  );
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page
    .getByLabel("Campaign notes", { exact: true })
    .fill("Later independent notes.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByText("<GAME NOTES UPDATED>", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close confirmation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Identity & Progress", exact: true })
    .click();
  await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue(
    "Saved before rejected transfer",
  );
  await page
    .getByRole("combobox", { name: /^Overlord/ })
    .selectOption("seat-successor");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByLabel("Campaign number", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Configure campaign", exact: true }),
  ).toHaveCount(0);
  expect(
    campaign.upstream.requests
      .filter((request) => request.method === "PATCH")
      .map((request) => request.body),
  ).toEqual([
    { name: "Saved before rejected transfer" },
    { notes: "Later independent notes." },
  ]);
  expect(
    campaign.upstream.requests.filter((request) => request.method === "POST"),
  ).toHaveLength(3);
  expect(campaign.upstream.game.organizerId).toBe("browser-successor");
});

test("a second uncertain same-route transfer requires another fresh read and fresh selection", async ({
  page,
  campaign,
}) => {
  campaign.upstream.transfer.push(
    { kind: "ambiguous", committed: false },
    { kind: "ambiguous", committed: false },
  );
  await page.goto(`${campaign.url}/games/42`);
  await openIdentity(page);
  let previousNonce: string | null = null;
  for (const attempt of [1, 2]) {
    await page
      .getByRole("combobox", { name: /^Overlord/ })
      .selectOption("seat-successor");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect
      .poll(() => {
        const post = campaign.upstream.requests.findLastIndex(
          (request) => request.method === "POST",
        );
        return (
          campaign.upstream.requests.filter(
            (request) => request.method === "POST",
          ).length === attempt &&
          campaign.upstream.requests
            .slice(post + 1)
            .some((request) => request.method === "GET")
        );
      })
      .toBe(true);
    await expect(page.getByRole("combobox", { name: /^Overlord/ })).toHaveValue(
      "seat-overlord",
    );
    await expect(
      page.getByRole("combobox", { name: /^Overlord/ }),
    ).toBeEnabled();
    await expect(
      page.getByRole("combobox", { name: /^Overlord/ }),
    ).toBeFocused();
    await expect(page).toHaveURL(
      (url) =>
        url.origin === campaign.url &&
        url.hash === "" &&
        url.searchParams.size === 2 &&
        url.pathname === "/games/42" &&
        url.searchParams.get("transferOutcome") === "transfer-unconfirmed" &&
        /^[0-9a-f-]{36}$/.test(url.searchParams.get("transferRecovery") ?? ""),
    );
    const nonce = new URL(page.url()).searchParams.get("transferRecovery");
    expect(nonce).not.toBe(previousNonce);
    previousNonce = nonce;
  }
  expect(
    campaign.upstream.requests.filter((request) => request.method === "PATCH"),
  ).toHaveLength(0);
});

test("renumbered transfer failure cannot send a subsequent notes edit to the old number", async ({
  page,
  campaign,
}) => {
  campaign.upstream.transfer.push({ kind: "confirmed-failure" });
  await page.goto(`${campaign.url}/api/auth/session`);
  await page.goto(`${campaign.url}/games/42`);
  const historyLength = await page.evaluate(() => history.length);
  await page.getByRole("tab", { name: "Campaign", exact: true }).click();
  await page
    .getByRole("button", { name: "Configure campaign", exact: true })
    .click();
  await page.getByLabel("Campaign number", { exact: true }).fill("43");
  await page
    .getByRole("combobox", { name: /^Overlord/ })
    .selectOption("seat-successor");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.origin === campaign.url &&
      url.hash === "" &&
      url.searchParams.size === 2 &&
      url.pathname === "/games/43" &&
      url.searchParams.get("transferOutcome") ===
        "metadata-saved-transfer-failed" &&
      /^[0-9a-f-]{36}$/.test(url.searchParams.get("transferRecovery") ?? ""),
  );
  await expect(
    page.getByText("Campaign details saved; Overlord transfer failed.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("tab", { name: "Campaign", exact: true }).click();
  await page
    .getByRole("button", { name: "Configure campaign", exact: true })
    .click();
  await expect(page.getByRole("combobox", { name: /^Overlord/ })).toHaveValue(
    "seat-overlord",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Exit configuration", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Configure campaign", exact: true })
    .click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page
    .getByLabel("Campaign notes", { exact: true })
    .fill("Notes after partial success.");
  const written = page.waitForResponse(
    (response) =>
      response.url().endsWith("/metadata") &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const response = await written;
  console.log(
    `After renumber, failed transfer, dialog dismissal and section switch: ${response.request().method()} ${response.url()} -> ${response.status()}`,
  );
  expect(response.url()).toBe(`${campaign.url}/api/games/43/metadata`);
  expect(response.status()).toBe(200);
  await expect(
    page.getByText("<GAME NOTES UPDATED>", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Notes after partial success.", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("Campaign details saved; Overlord transfer failed.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(campaign.upstream.game.organizerId).toBe("browser-overlord");
  expect(
    campaign.upstream.requests.filter((request) => request.method === "POST"),
  ).toHaveLength(1);
  await page.goBack();
  await expect(page).toHaveURL(`${campaign.url}/api/auth/session`);
});

for (const renumber of [false, true]) {
  test(`failed reconciliation ${renumber ? "after renumber" : "on same route"} never enables unsafe transfer retry`, async ({
    page,
    campaign,
  }) => {
    campaign.upstream.transfer.push({ kind: "ambiguous", committed: false });
    await page.goto(`${campaign.url}/games/42`);
    await openIdentity(page);
    if (renumber)
      await page.getByLabel("Campaign number", { exact: true }).fill("43");
    await page
      .getByRole("combobox", { name: /^Overlord/ })
      .selectOption("seat-successor");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    campaign.upstream.detailFailure = true;
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect
      .poll(() => {
        const post = campaign.upstream.requests.findIndex(
          (request) => request.method === "POST",
        );
        return (
          post >= 0 &&
          campaign.upstream.requests
            .slice(post + 1)
            .some((request) => request.method === "GET")
        );
      })
      .toBe(true);
    await expect(
      page.getByText("Campaign data could not be reloaded.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Overlord transfer could not be confirmed/),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Confirm", exact: true }),
    ).toHaveCount(0);
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect
      .poll(async () => (await save.count()) === 0 || (await save.isDisabled()))
      .toBe(true);
    const notes = page.getByRole("button", { name: "Notes", exact: true });
    await expect
      .poll(
        async () => (await notes.count()) === 0 || (await notes.isDisabled()),
      )
      .toBe(true);
    // A user can retry only the read. No queued transfer is resurrected.
    campaign.upstream.detailFailure = false;
    const sessionReady = page.waitForResponse((response) =>
      response.url().endsWith("/api/auth/session"),
    );
    await page
      .getByRole("button", { name: "Reload campaign", exact: true })
      .click();
    await sessionReady;
    await openIdentity(page);
    await expect(page.getByRole("combobox", { name: /^Overlord/ })).toHaveValue(
      "seat-overlord",
    );
    expect(
      campaign.upstream.requests.filter((request) => request.method === "POST"),
    ).toHaveLength(1);
  });

  for (const committed of [false, true]) {
    test(`uncertain ${committed ? "committed" : "uncommitted"} transfer ${renumber ? "after renumber" : "on same route"} reloads ownership before another action`, async ({
      page,
      campaign,
    }) => {
      campaign.upstream.transfer.push({ kind: "ambiguous", committed });
      await page.goto(`${campaign.url}/games/42`);
      await openIdentity(page);
      await page
        .getByLabel("Campaign name", { exact: true })
        .fill("Saved before uncertainty");
      if (renumber)
        await page.getByLabel("Campaign number", { exact: true }).fill("43");
      await page
        .getByRole("combobox", { name: /^Overlord/ })
        .selectOption("seat-successor");
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByRole("button", { name: "Confirm", exact: true }).click();
      const number = renumber ? 43 : 42;
      await expect
        .poll(() => {
          const post = campaign.upstream.requests.findIndex(
            (request) => request.method === "POST",
          );
          return (
            post >= 0 &&
            campaign.upstream.requests
              .slice(post + 1)
              .some((request) => request.path === `/v1/games/${number}/detail`)
          );
        })
        .toBe(true);
      await expect(
        page
          .getByText(
            /Campaign details saved; Overlord transfer could not be confirmed/,
          )
          .first(),
      ).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(new URL(page.url()).pathname).toBe(`/games/${number}`);
      await page.getByRole("tab", { name: "Campaign", exact: true }).click();
      if (committed) {
        await expect(
          page.getByRole("button", { name: "Configure campaign", exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByLabel("Campaign number", { exact: true }),
        ).toHaveCount(0);
      } else {
        await openIdentity(page);
        await expect(
          page.getByRole("combobox", { name: /^Overlord/ }),
        ).toHaveValue("seat-overlord");
        await expect(
          page.getByRole("combobox", { name: /^Overlord/ }),
        ).toBeEnabled();
        await page.getByRole("button", { name: "Notes", exact: true }).click();
        await page
          .getByLabel("Campaign notes", { exact: true })
          .fill("Safe after authoritative reconciliation.");
        const saved = page.waitForResponse(
          (response) =>
            response.url().endsWith(`/api/games/${number}/metadata`) &&
            response.request().method() === "PATCH",
        );
        await page.getByRole("button", { name: "Save", exact: true }).click();
        expect((await saved).status()).toBe(200);
      }
      expect(
        campaign.upstream.requests.filter(
          (request) => request.method === "POST",
        ),
      ).toHaveLength(1);
      expect(
        campaign.upstream.requests.filter(
          (request) =>
            request.method === "PATCH" &&
            (request.body as { name?: string }).name,
        ),
      ).toHaveLength(1);
    });
  }
}
