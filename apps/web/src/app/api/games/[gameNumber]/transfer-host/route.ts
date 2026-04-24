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
      { error: "Sign in to transfer campaign control." },
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
      { error: "Host transfer payload is invalid." },
      { status: 400 },
    );
  }

  const targetPlayerEntryId = payload.targetPlayerEntryId.trim();

  if (targetPlayerEntryId.length === 0) {
    return Response.json(
      { error: "Select a player to receive campaign control." },
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
        "The host transfer failed.");

    return Response.json(
      { error: message },
      { status: response.status || 500 },
    );
  }

  return Response.json(await response.json().catch(() => ({ ok: true })));
}