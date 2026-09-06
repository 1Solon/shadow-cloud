import { test, expect } from "./fixture";

test("an authenticated Overlord edits notes and sees them after a real reload", async ({
  page,
  campaign,
}) => {
  const document = await page.goto(`${campaign.url}/games/42`);
  expect(document?.status()).toBe(200);
  // The initial HTML, not just hydration, must reflect the real session.
  expect(await document!.text()).toContain("Browser Overlord");
  expect(await document!.text()).toContain("Configure campaign");
  const session = await page.request.get(`${campaign.url}/api/auth/session`);
  expect((await session.json()).user).toMatchObject({
    id: "browser-overlord",
    isShadowOverride: false,
  });

  await page.getByRole("tab", { name: "Campaign", exact: true }).click();
  await page
    .getByRole("button", { name: "Configure campaign", exact: true })
    .click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByLabel("Campaign notes", { exact: true })).toHaveValue(
    "Initial browser campaign notes.",
  );
  await page
    .getByLabel("Campaign notes", { exact: true })
    .fill("Notes committed through the real browser proxy.");
  const mutation = page.waitForResponse(
    (response) =>
      response.url() === `${campaign.url}/api/games/42/metadata` &&
      response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await mutation).status()).toBe(200);
  await expect(
    page.getByText("<GAME NOTES UPDATED>", { exact: true }),
  ).toBeVisible();

  const reloaded = await page.reload();
  expect(reloaded?.status()).toBe(200);
  await expect(page).toHaveURL(`${campaign.url}/games/42`);
  await expect(
    page
      .getByText("Notes committed through the real browser proxy.", {
        exact: true,
      })
      .first(),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Campaign", exact: true }).click();
  await page
    .getByRole("button", { name: "Configure campaign", exact: true })
    .click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByLabel("Campaign notes", { exact: true })).toHaveValue(
    "Notes committed through the real browser proxy.",
  );
  expect(
    campaign.upstream.requests.filter((request) => request.method === "PATCH"),
  ).toEqual([
    {
      method: "PATCH",
      path: "/v1/games/42/metadata",
      subject: "browser-overlord",
      body: { notes: "Notes committed through the real browser proxy." },
    },
  ]);

  // Without the cookie, the same SSR and proxy enforce the unchanged auth policy.
  await page.context().clearCookies();
  const anonymous = await page.reload();
  expect(await anonymous!.text()).not.toContain("Configure campaign");
  const denied = await page.request.patch(
    `${campaign.url}/api/games/42/metadata`,
    {
      data: { notes: "Unauthorized change" },
    },
  );
  expect(denied.status()).toBe(401);
  expect(
    campaign.upstream.requests.filter((request) => request.method === "PATCH"),
  ).toHaveLength(1);
  console.log(
    "SSR authenticated; signed proxy PATCH 200; document reload retained notes; anonymous SSR read-only and PATCH 401.",
  );
});
