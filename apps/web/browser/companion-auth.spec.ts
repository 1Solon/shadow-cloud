import { test, expect } from "./fixture";

test("the Companion approval form succeeds without weakening cross-origin protection", async ({
  page,
  context,
  campaign,
}) => {
  const approvalUrl = `${campaign.url}/api/auth/companion?handoff=browser-handoff`;
  const initial = await page.goto(approvalUrl);
  await expect(
    page.getByRole("button", { name: "APPROVE DEVICE SESSION" }),
  ).toBeVisible();
  expect(campaign.upstream.requests).toHaveLength(0);

  const submitted = page.waitForResponse(
    (response) =>
      response.url() === approvalUrl && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "APPROVE DEVICE SESSION" }).click();
  const response = await submitted;
  const origin = response.request().headers().origin;

  expect(response.status()).toBe(200);
  expect(origin).toBe(campaign.url);
  expect(initial?.headers()["referrer-policy"]).toBe("same-origin");
  await expect(
    page.getByRole("heading", { name: "> DEVICE SESSION APPROVED" }),
  ).toBeVisible();
  await expect(page.getByLabel("ONE-USE TOKEN")).toHaveValue(
    "browser-handoff.synthetic-paste-proof",
  );
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  expect(campaign.upstream.requests).toEqual([
    {
      method: "POST",
      path: "/v1/auth/companion-handoffs/browser-handoff/approve",
      subject: "discord-identity-sync",
      body: { userId: "browser-overlord" },
    },
  ]);

  for (const origin of ["https://untrusted.example", "null", undefined]) {
    const rejected = await context.request.post(approvalUrl, {
      headers: origin ? { origin } : {},
    });
    expect(rejected.status()).toBe(403);
  }
  expect(campaign.upstream.requests).toHaveLength(1);
});
