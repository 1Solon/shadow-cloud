import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import { startUpstream, type MutationOutcome } from "./upstream";

const outcomes: Array<{
  name: string;
  outcome: MutationOutcome;
  commits: boolean;
}> = [
  { name: "success", outcome: { kind: "success" }, commits: true },
  {
    name: "confirmed failure",
    outcome: { kind: "confirmed-failure" },
    commits: false,
  },
  {
    name: "lost response after commit",
    outcome: { kind: "ambiguous", committed: true },
    commits: true,
  },
  {
    name: "lost response without commit",
    outcome: { kind: "ambiguous", committed: false },
    commits: false,
  },
];

for (const operation of ["metadata", "transfer"] as const) {
  for (const { name, outcome, commits } of outcomes) {
    test(`upstream ${operation}: ${name} is reflected in authoritative HTTP reads`, async () => {
      const secret = randomBytes(32).toString("hex");
      const upstream = await startUpstream(secret);
      try {
        upstream[operation].push(outcome);
        const token = await new SignJWT({})
          .setProtectedHeader({ alg: "HS256" })
          .setSubject("browser-overlord")
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(new TextEncoder().encode(secret));
        const mutation = fetch(
          `${upstream.url}/v1/games/42/${operation === "metadata" ? "metadata" : "transfer-host"}`,
          {
            method: operation === "metadata" ? "PATCH" : "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(
              operation === "metadata"
                ? { gameNumber: 43, notes: "Committed metadata." }
                : { targetPlayerEntryId: "seat-successor" },
            ),
          },
        );
        if (outcome.kind === "ambiguous") {
          await expect(mutation).rejects.toThrow("fetch failed");
        } else {
          const response = await mutation;
          expect(response.status).toBe(outcome.kind === "success" ? 200 : 409);
          if (operation === "transfer" && commits) {
            expect(await response.json()).toMatchObject({
              gameId: "browser-campaign",
              organizerId: "browser-successor",
              player: { displayName: "Browser Successor", turnOrder: 2 },
            });
          }
        }
        const currentNumber = operation === "metadata" && commits ? 43 : 42;
        const current = await fetch(
          `${upstream.url}/v1/games/${currentNumber}/detail`,
        );
        expect(current.status).toBe(200);
        const game = await current.json();
        expect(game).toMatchObject(
          operation === "metadata"
            ? {
                gameNumber: currentNumber,
                notes: commits
                  ? "Committed metadata."
                  : "Initial browser campaign notes.",
                seatOrderBaseline: {
                  campaignId: "browser-campaign",
                  revision: 0,
                },
              }
            : {
                organizerId: commits ? "browser-successor" : "browser-overlord",
                seatOrderBaseline: {
                  campaignId: "browser-campaign",
                  revision: commits ? 1 : 0,
                },
              },
        );
        if (currentNumber === 43) {
          expect(
            (await fetch(`${upstream.url}/v1/games/42/detail`)).status,
          ).toBe(404);
        }
      } finally {
        await upstream.close();
      }
    });
  }
}
