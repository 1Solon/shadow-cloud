import { createApiAccessToken, getServerAuthSession } from "@/auth";

const apiBaseUrl = process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001";

export async function POST(
  request: Request,
  context: { params: Promise<{ gameNumber: string }> },
) {
  const { gameNumber } = await context.params;
  const session = await getServerAuthSession();

  if (!session?.user?.id) {
    return Response.json(
      { error: "Sign in to edit seat order." },
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
    seatEntryIds?: unknown;
    clearedSeatEntryIds?: unknown;
    removedSeatEntryIds?: unknown;
    activePlayerEntryId?: unknown;
  } | null;

  if (!Array.isArray(payload?.seatEntryIds)) {
    return Response.json(
      { error: "Seat order payload is invalid." },
      { status: 400 },
    );
  }

  if (payload.seatEntryIds.some((entryId) => typeof entryId !== "string")) {
    return Response.json(
      { error: "Seat order payload is invalid." },
      { status: 400 },
    );
  }

  if (
    payload.clearedSeatEntryIds != null &&
    !Array.isArray(payload.clearedSeatEntryIds)
  ) {
    return Response.json(
      { error: "Cleared seat payload is invalid." },
      { status: 400 },
    );
  }

  if (
    payload.removedSeatEntryIds != null &&
    !Array.isArray(payload.removedSeatEntryIds)
  ) {
    return Response.json(
      { error: "Removed seat payload is invalid." },
      { status: 400 },
    );
  }

  if (
    Array.isArray(payload.clearedSeatEntryIds) &&
    payload.clearedSeatEntryIds.some((entryId) => typeof entryId !== "string")
  ) {
    return Response.json(
      { error: "Cleared seat payload is invalid." },
      { status: 400 },
    );
  }

  if (
    Array.isArray(payload.removedSeatEntryIds) &&
    payload.removedSeatEntryIds.some((entryId) => typeof entryId !== "string")
  ) {
    return Response.json(
      { error: "Removed seat payload is invalid." },
      { status: 400 },
    );
  }

  if (
    payload.activePlayerEntryId != null &&
    typeof payload.activePlayerEntryId !== "string"
  ) {
    return Response.json(
      { error: "Active player payload is invalid." },
      { status: 400 },
    );
  }

  const response = await fetch(
    `${apiBaseUrl}/v1/games/${encodeURIComponent(gameNumber)}/seat-order`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        seatEntryIds: payload.seatEntryIds,
        clearedSeatEntryIds: payload.clearedSeatEntryIds,
        removedSeatEntryIds: payload.removedSeatEntryIds,
        activePlayerEntryId: payload.activePlayerEntryId,
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
        "The seat order update failed.");

    return Response.json(
      { error: message },
      { status: response.status || 500 },
    );
  }

  return Response.json(await response.json().catch(() => ({ ok: true })));
}
