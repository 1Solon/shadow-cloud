import { createApiAccessToken, getServerAuthSession } from "@/auth";

const apiBaseUrl = process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001";

export async function GET(
  _request: Request,
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
  const response = await fetch(
    `${apiBaseUrl}/v1/games/${encodeURIComponent(gameNumber)}/seat-order`,
    {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  return seatOrderResponse(response);
}

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
    baseline?: unknown;
  } | null;

  const baseline = payload?.baseline;
  if (
    baseline == null ||
    typeof baseline !== "object" ||
    Array.isArray(baseline) ||
    !("campaignId" in baseline) ||
    typeof baseline.campaignId !== "string" ||
    baseline.campaignId.trim().length === 0 ||
    !("revision" in baseline) ||
    typeof baseline.revision !== "number" ||
    !Number.isSafeInteger(baseline.revision) ||
    baseline.revision < 0
  ) {
    return Response.json(
      {
        error: "Reload the latest roster before saving seat order.",
        code: "SEAT_ORDER_BASELINE_REQUIRED",
      },
      { status: 400 },
    );
  }

  // The invariant owner checks authority and freshness before validating intent.
  const response = await fetch(
    `${apiBaseUrl}/v1/games/${encodeURIComponent(gameNumber)}/seat-order`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        seatEntryIds: payload?.seatEntryIds,
        clearedSeatEntryIds: payload?.clearedSeatEntryIds,
        removedSeatEntryIds: payload?.removedSeatEntryIds,
        activePlayerEntryId: payload?.activePlayerEntryId,
        baseline,
      }),
      cache: "no-store",
    },
  );

  return seatOrderResponse(response);
}

async function seatOrderResponse(response: Response) {
  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as {
      message?: string | string[];
      error?: string;
      code?: string;
    } | null;
    const message = Array.isArray(errorPayload?.message)
      ? errorPayload.message.join(", ")
      : (errorPayload?.message ??
        errorPayload?.error ??
        "The seat order update failed.");

    return Response.json(
      { error: message, code: errorPayload?.code },
      { status: response.status || 500 },
    );
  }

  return Response.json(await response.json().catch(() => ({ ok: true })));
}
