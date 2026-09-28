import { createApiAccessToken, getServerAuthSession } from "@/auth";
import { getShadowOverrideEnabled } from "@/lib/shadow-override";

const apiBaseUrl = process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001";

type RejectSaveRequestPayload = {
  expectedSaveBaseline?: unknown;
};

type RejectSaveResponsePayload = {
  fileVersionId?: string;
  versionNumber?: number;
  roundNumber?: number;
  activePlayer?: {
    id: string;
    userId: string | null;
    displayName: string | null;
    turnOrder: number;
  };
};

export async function POST(
  request: Request,
  context: { params: Promise<{ gameNumber: string; fileVersionId: string }> },
) {
  const { gameNumber, fileVersionId } = await context.params;
  const session = await getServerAuthSession();

  if (!session?.user?.id) {
    return Response.json(
      { error: "Sign in to reject saves." },
      { status: 401 },
    );
  }

  const shadowOverrideEnabled = await getShadowOverrideEnabled();
  const token = await createApiAccessToken(session, {
    shadowOverrideEnabled,
  }).catch(() => null);

  if (!token) {
    return Response.json(
      { error: "API authentication is unavailable." },
      { status: 500 },
    );
  }

  const body = (await request
    .json()
    .catch(() => null)) as RejectSaveRequestPayload | null;
  const expectedSaveBaseline =
    typeof body?.expectedSaveBaseline === "string"
      ? body.expectedSaveBaseline
      : undefined;

  const response = await fetch(
    `${apiBaseUrl}/v1/games/${encodeURIComponent(gameNumber)}/files/${encodeURIComponent(fileVersionId)}/reject`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expectedSaveBaseline }),
      cache: "no-store",
    },
  ).catch(() => null);

  if (!response) {
    return Response.json(
      { error: "The save rejection could not reach the API." },
      { status: 502 },
    );
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string | string[];
      error?: string;
    } | null;
    const message = Array.isArray(payload?.message)
      ? payload.message.join(", ")
      : (payload?.message ?? payload?.error ?? "The save rejection failed.");

    return Response.json(
      { error: message },
      { status: response.status || 500 },
    );
  }

  const payload = (await response
    .json()
    .catch(() => null)) as RejectSaveResponsePayload | null;

  return Response.json({
    ok: true,
    fileVersionId: payload?.fileVersionId,
    versionNumber: payload?.versionNumber,
    roundNumber: payload?.roundNumber,
    activePlayer: payload?.activePlayer,
  });
}
