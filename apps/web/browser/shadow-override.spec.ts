import { test, expect } from "./fixture";

test.use({ privilegedNonOverlord: true });

test("Override reveals Regimes for a privileged non-Overlord and gates signed inspection and recovery reads", async ({
  page,
  context,
  campaign,
}) => {
  const { upstream, url } = campaign;
  upstream.game.fileVersions = [
    {
      id: "synthetic",
      originalName: "synthetic.se1",
      uploadedAt: "2026-09-01T00:00:00Z",
      uploadedById: "browser-successor",
      uploadedByDisplayName: "Browser Successor",
      contentHash: null,
      contentRevision: 0,
      idempotencyKey: null,
      replacedAt: null,
      replacedByDisplayName: null,
    },
  ];
  const initialGame = structuredClone(upstream.game);
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname.startsWith("/api/games/") &&
      request.method() !== "GET"
    ) {
      mutations.push(request.url());
    }
  });
  const reads = () =>
    upstream.requests.filter(
      (request) =>
        request.path.endsWith("/save-inspection") ||
        request.path.endsWith("/password-reset"),
    );
  await page.goto(`${url}/games/42`);
  const session = await (
    await context.request.get(`${url}/api/auth/session`)
  ).json();
  expect(session.user).toMatchObject({
    id: "browser-overlord",
    isShadowOverride: true,
  });
  expect(upstream.game.organizerId).toBe("browser-successor");
  const regimes = page.getByRole("tab", { name: "Regimes", exact: true });
  await expect(regimes).toHaveCount(0);
  expect(reads()).toHaveLength(0);

  for (const enabled of [true, false]) {
    await page
      .getByRole("button", {
        name: enabled ? "Override" : "Override Armed",
        exact: true,
      })
      .click();
    const confirmation = page.getByRole("dialog", {
      name: "Confirm override change",
    });
    await expect(confirmation).toBeVisible();
    expect(
      (await context.cookies()).some(
        (cookie) => cookie.name === "shadow-override",
      ),
    ).toBe(!enabled);
    const responsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/shadow-override" &&
        response.request().method() === "POST",
    );
    await confirmation
      .getByRole("button", {
        name: enabled ? "Enable" : "Disable",
        exact: true,
      })
      .click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toEqual({ enabled });
    expect(await response.json()).toEqual({ enabled });
    await expect(confirmation).toHaveCount(0);
    const cookie = (await context.cookies()).find(
      (cookie) => cookie.name === "shadow-override",
    );
    if (enabled) {
      expect(cookie).toMatchObject({
        value: "enabled",
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
      });
      await expect(regimes).toBeVisible();
      expect(reads()).toHaveLength(0);
      await regimes.click();
      const inspection = page.getByRole("region", {
        name: "In-game regime inspection",
      });
      await expect(
        inspection.getByText("North Reach", { exact: true }),
      ).toBeVisible();
      await expect(
        inspection.getByRole("button", { name: "Edit Password" }),
      ).toBeVisible();
      await expect.poll(reads).toEqual(
        expect.arrayContaining([
          {
            method: "GET",
            path: "/v1/games/42/save-inspection",
            subject: "browser-overlord",
            shadowOverrideEnabled: true,
          },
          {
            method: "GET",
            path: "/v1/games/42/password-reset",
            subject: "browser-overlord",
            shadowOverrideEnabled: true,
          },
        ]),
      );
      expect(
        reads().every((request) => request.shadowOverrideEnabled === true),
      ).toBe(true);
    } else {
      expect(cookie).toBeUndefined();
      await expect(regimes).toHaveCount(0);
      await expect(
        page.getByRole("tab", { name: "Saves", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      const before = reads().length;
      for (const endpoint of ["save-inspection", "password-reset"]) {
        const denied = await context.request.get(
          `${url}/api/games/42/${endpoint}`,
        );
        expect(denied.status()).toBe(403);
      }
      expect(reads().slice(before)).toEqual([
        {
          method: "GET",
          path: "/v1/games/42/save-inspection",
          subject: "browser-overlord",
          shadowOverrideEnabled: false,
        },
        {
          method: "GET",
          path: "/v1/games/42/password-reset",
          subject: "browser-overlord",
          shadowOverrideEnabled: false,
        },
      ]);
      await page.reload();
      await expect(regimes).toHaveCount(0);
    }
  }
  // No reset/undo is synthesized here: full permissions and writes belong to
  // the real SQLite API tests. Merely inspecting must never mutate the save.
  expect(upstream.requests.every((request) => request.method === "GET")).toBe(
    true,
  );
  expect(mutations).toEqual([]);
  expect(upstream.game).toEqual(initialGame);
});
