import { createApiAccessToken, getServerAuthSession } from "@/auth";

const apiBaseUrl = process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ gameNumber: string }> },
) {
  const { gameNumber } = await context.params;
  const session = await getServerAuthSession();

  if (!session?.user?.id) {
    return Response.json(
      { error: "Sign in to edit campaign details." },
      { status: 401 },
    );
  }

  const token = await createApiAccessToken(session).catch(() => null);

  if (!token) {
    return Response.json(
      { error: "API authentication is unavailable." },
      { status: 500 },
    );
  }

  const payload = (await request.json().catch(() => null)) as {
    roundNumber?: unknown;
    playerCount?: unknown;
    hasAiPlayers?: unknown;
    dlcMode?: unknown;
    gameMode?: unknown;
    techLevel?: unknown;
    zoneCount?: unknown;
    armyCount?: unknown;
    notes?: unknown;
  } | null;

  if (!payload || typeof payload !== "object") {
    return Response.json(
      { error: "Game metadata payload is invalid." },
      { status: 400 },
    );
  }

  if (
    payload.roundNumber !== undefined &&
    (typeof payload.roundNumber !== "number" ||
      !Number.isInteger(payload.roundNumber) ||
      payload.roundNumber < 1)
  ) {
    return Response.json(
      { error: "Current turn metadata is invalid." },
      { status: 400 },
    );
  }

  if (
    payload.playerCount !== undefined &&
    (typeof payload.playerCount !== "number" ||
      !Number.isInteger(payload.playerCount) ||
      payload.playerCount < 1)
  ) {
    return Response.json(
      { error: "Seat limit metadata is invalid." },
      { status: 400 },
    );
  }

  if (
    payload.hasAiPlayers !== undefined &&
    typeof payload.hasAiPlayers !== "boolean"
  ) {
    return Response.json(
      { error: "AI player metadata is invalid." },
      { status: 400 },
    );
  }

  if (
    (payload.dlcMode !== undefined && typeof payload.dlcMode !== "string") ||
    (payload.gameMode !== undefined && typeof payload.gameMode !== "string") ||
    (payload.zoneCount !== undefined &&
      typeof payload.zoneCount !== "string") ||
    (payload.armyCount !== undefined && typeof payload.armyCount !== "string")
  ) {
    return Response.json(
      { error: "Game metadata payload is invalid." },
      { status: 400 },
    );
  }

  if (
    payload.techLevel !== undefined &&
    (typeof payload.techLevel !== "number" ||
      !Number.isInteger(payload.techLevel))
  ) {
    return Response.json(
      { error: "Tech level metadata is invalid." },
      { status: 400 },
    );
  }

  if (payload.notes != null && typeof payload.notes !== "string") {
    return Response.json(
      { error: "Notes metadata is invalid." },
      { status: 400 },
    );
  }

  const response = await fetch(
    `${apiBaseUrl}/v1/games/${encodeURIComponent(gameNumber)}/metadata`,
    {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...(payload.roundNumber !== undefined
          ? { roundNumber: payload.roundNumber }
          : {}),
        ...(payload.playerCount !== undefined
          ? { playerCount: payload.playerCount }
          : {}),
        ...(payload.hasAiPlayers !== undefined
          ? { hasAiPlayers: payload.hasAiPlayers }
          : {}),
        ...(payload.dlcMode !== undefined ? { dlcMode: payload.dlcMode } : {}),
        ...(payload.gameMode !== undefined
          ? { gameMode: payload.gameMode }
          : {}),
        ...(payload.techLevel !== undefined
          ? { techLevel: payload.techLevel }
          : {}),
        ...(payload.zoneCount !== undefined
          ? { zoneCount: payload.zoneCount }
          : {}),
        ...(payload.armyCount !== undefined
          ? { armyCount: payload.armyCount }
          : {}),
        ...("notes" in payload ? { notes: payload.notes ?? null } : {}),
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as {
      message?: string | string[];
      error?: string;
    } | null;
    const message = Array.isArray(errorPayload?.message)
      ? errorPayload.message.join(", ")
      : (errorPayload?.message ??
        errorPayload?.error ??
        "The game metadata update failed.");

    return Response.json(
      { error: message },
      { status: response.status || 500 },
    );
  }

  return Response.json(await response.json().catch(() => ({ ok: true })));
}
