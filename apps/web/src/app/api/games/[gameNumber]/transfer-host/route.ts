import { createApiAccessToken, getServerAuthSession } from "@/auth";
import { isKnownRejectionStatus } from "@/lib/transfer-outcome";

const apiBaseUrl = process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001";

export async function POST(
  request: Request,
  context: { params: Promise<{ gameNumber: string }> },
) {
  const { gameNumber } = await context.params;
  const session = await getServerAuthSession();

  if (!session?.user?.id) {
    return Response.json(
      { error: "Sign in to transfer campaign control.", outcome: "rejected" },
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
    targetPlayerEntryId?: unknown;
  } | null;

  if (typeof payload?.targetPlayerEntryId !== "string") {
    return Response.json(
      { error: "Host transfer payload is invalid.", outcome: "rejected" },
      { status: 400 },
    );
  }

  const targetPlayerEntryId = payload.targetPlayerEntryId.trim();

  if (targetPlayerEntryId.length === 0) {
    return Response.json(
      {
        error: "Select a player to receive campaign control.",
        outcome: "rejected",
      },
      { status: 400 },
    );
  }

  const response = await fetch(
    `${apiBaseUrl}/v1/games/${encodeURIComponent(gameNumber)}/transfer-host`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ targetPlayerEntryId }),
      cache: "no-store",
    },
  ).catch(() => null);

  const body = await response?.json().catch(() => null);
  if (response && !response.ok && isKnownRejectionStatus(response.status)) {
    const error = body?.message ?? body?.error;
    const message =
      Array.isArray(error) &&
      error.length > 0 &&
      error.every((item) => typeof item === "string")
        ? error.join(", ")
        : error;
    if (typeof message === "string" && message.trim()) {
      return Response.json(
        { error: message, outcome: "rejected" },
        { status: response.status },
      );
    }
  }

  if (
    response?.ok &&
    typeof body?.gameId === "string" &&
    body.gameId.length > 0 &&
    Number.isSafeInteger(body.gameNumber) &&
    body.gameNumber > 0 &&
    typeof body.organizerId === "string" &&
    body.organizerId.length > 0
  ) {
    return Response.json(body);
  }
  // A lost/malformed response or unknown server error is not evidence of rollback.
  return Response.json(
    {
      error: "The Overlord transfer could not be confirmed.",
      outcome: "unconfirmed",
    },
    { status: 502 },
  );
}
