import { createServer } from "node:http";
import { jwtVerify } from "jose";
import type { GameDetail, GameListItem } from "../src/lib/shadow-cloud-api";

export type MutationOutcome =
  | { kind: "success" }
  | { kind: "confirmed-failure"; status?: number; message?: string }
  | { kind: "ambiguous"; committed: boolean };

export async function startUpstream(secret: string) {
  const upstream: {
    game: GameDetail;
    metadata: MutationOutcome[];
    transfer: MutationOutcome[];
    detailFailure: boolean;
    requests: Array<{
      method: string;
      path: string;
      subject?: string;
      shadowOverrideEnabled?: unknown;
      body?: unknown;
    }>;
  } = {
    game: {
      id: "browser-campaign",
      gameNumber: 42,
      slug: "browser-campaign",
      name: "Browser Campaign",
      organizerId: "browser-overlord",
      organizerDisplayName: "Browser Overlord",
      seatOrderBaseline: { campaignId: "browser-campaign", revision: 0 },
      playerCount: 2,
      hasAiPlayers: false,
      dlcMode: "NONE",
      gameMode: "MULTIPLAYER",
      techLevel: 3,
      zoneCount: "REGULAR",
      armyCount: "REGULAR",
      notes: "Initial browser campaign notes.",
      roundNumber: 1,
      activePlayerEntryId: "seat-overlord",
      activePlayerUserId: "browser-overlord",
      activePlayerDisplayName: "Browser Overlord",
      turnTargetHours: 24,
      turnReminderGraceHours: 2,
      turnReminderRepeatHours: 4,
      turnRemindersEnabled: false,
      currentTurnStartedAt: null,
      players: [
        {
          id: "seat-overlord",
          userId: "browser-overlord",
          displayName: "Browser Overlord",
          turnOrder: 1,
          isOrganizer: true,
        },
        {
          id: "seat-successor",
          userId: "browser-successor",
          displayName: "Browser Successor",
          turnOrder: 2,
          isOrganizer: false,
        },
      ],
      fileVersions: [],
      openTurn: null,
      recentCompletedTurns: [],
    },
    metadata: [],
    transfer: [],
    detailFailure: false,
    requests: [],
  };
  const server = createServer(async (request, response) => {
    const path = request.url ?? "/";
    const method = request.method ?? "GET";
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    try {
      const base = `/v1/games/${upstream.game.gameNumber}`;
      if (method === "GET" && path === "/v1/games") {
        const game = upstream.game;
        const latest = game.fileVersions[0];
        const item: GameListItem = {
          ...game,
          playerCount: game.playerCount ?? game.players.length,
          filledSeatCount: game.players.filter(
            (player) => player.userId !== null,
          ).length,
          participantUserIds: game.players.flatMap((player) =>
            player.userId ? [player.userId] : [],
          ),
          updatedAt: latest?.uploadedAt ?? "2026-07-11T12:00:00.000Z",
          latestSave: latest
            ? {
                contentRevision: latest.contentRevision,
                id: latest.id,
                originalName: latest.originalName,
              }
            : null,
        };
        reply(200, [item]);
        return;
      }
      if (method === "GET" && path === `${base}/detail`) {
        upstream.requests.push({ method, path });
        if (upstream.detailFailure) {
          reply(503, { message: "Fixture detail read unavailable." });
          return;
        }
        reply(200, upstream.game);
        return;
      }
      if (method === "GET" && path.startsWith(`${base}/files/`)) {
        const body = Buffer.from("corrected save");
        response.writeHead(200, {
          "content-disposition": 'attachment; filename="42-T1-S1-Browser.se1"',
          "content-length": String(body.byteLength),
          "content-type": "application/octet-stream",
          "last-modified": "Fri, 11 Sep 2026 13:00:38 GMT",
        });
        response.end(body);
        return;
      }
      const isMetadata = method === "PATCH" && path === `${base}/metadata`;
      const isTransfer = method === "POST" && path === `${base}/transfer-host`;
      const isInspection =
        method === "GET" && path === `${base}/save-inspection`;
      const isRecovery = method === "GET" && path === `${base}/password-reset`;
      if (!isMetadata && !isTransfer && !isInspection && !isRecovery) {
        reply(404, { message: "Unknown fixture campaign or route." });
        return;
      }
      let subject: string | undefined;
      let shadowOverrideEnabled: unknown;
      try {
        const { payload } = await jwtVerify(
          (request.headers.authorization ?? "").replace(/^Bearer /, ""),
          new TextEncoder().encode(secret),
          { algorithms: ["HS256"], requiredClaims: ["sub", "iat", "exp"] },
        );
        subject = payload.sub;
        shadowOverrideEnabled = payload.shadowOverrideEnabled;
      } catch {
        reply(401, { message: "Invalid fixture API token." });
        return;
      }
      if (isInspection || isRecovery) {
        upstream.requests.push({
          method,
          path,
          subject,
          shadowOverrideEnabled,
        });
        // Fixture privilege is independent of the campaign's current Overlord.
        if (
          subject !== upstream.game.organizerId &&
          !(subject === "browser-overlord" && shadowOverrideEnabled === true)
        ) {
          reply(403, {
            message: "Only the current Overlord can inspect regimes.",
          });
          return;
        }
        reply(
          200,
          isInspection
            ? {
                fileVersionId: upstream.game.fileVersions[0]?.id,
                contentRevision: upstream.game.fileVersions[0]?.contentRevision,
                sourceId: "synthetic-source",
                expectedSaveBaseline: "synthetic-baseline",
                regimes: [
                  {
                    id: "north",
                    name: "North Reach",
                    current: true,
                    eligible: true,
                    reason: null,
                  },
                ],
              }
            : { undo: null },
        );
        return;
      }
      if (subject !== upstream.game.organizerId) {
        reply(403, { message: "Only the Overlord can edit this campaign." });
        return;
      }
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      upstream.requests.push({ method, path, subject, body });
      const outcome = (isMetadata
        ? upstream.metadata
        : upstream.transfer
      ).shift() ?? { kind: "success" };
      if (outcome.kind === "confirmed-failure") {
        reply(outcome.status ?? 409, {
          message: outcome.message ?? "Fixture mutation rejected.",
        });
        return;
      }
      if (outcome.kind === "success" || outcome.committed) {
        if (isMetadata) {
          Object.assign(upstream.game, body);
        } else {
          const target = upstream.game.players.find(
            (player) => player.id === body.targetPlayerEntryId,
          );
          if (!target?.userId) {
            reply(400, { message: "Select an occupied seat." });
            return;
          }
          if (target.userId === upstream.game.organizerId) {
            reply(400, { message: "Select a different player." });
            return;
          }
          upstream.game.organizerId = target.userId;
          upstream.game.organizerDisplayName = target.displayName ?? "";
          upstream.game.players.forEach((player) => {
            player.isOrganizer = player.id === target.id;
          });
          upstream.game.seatOrderBaseline.revision += 1;
        }
      }
      if (outcome.kind === "ambiguous") {
        // Drop the response after the chosen commit decision, never auto-retry.
        response.destroy();
        return;
      }
      const game = upstream.game;
      const overlord = game.players.find((player) => player.isOrganizer)!;
      reply(
        200,
        isMetadata
          ? game
          : {
              gameId: game.id,
              gameNumber: game.gameNumber,
              slug: game.slug,
              name: game.name,
              organizerId: game.organizerId,
              organizerDisplayName: game.organizerDisplayName,
              player: {
                displayName: overlord.displayName,
                turnOrder: overlord.turnOrder,
              },
            },
      );
    } catch (error) {
      reply(500, { message: String(error) });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture listener.");
  return Object.assign(upstream, {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  });
}
