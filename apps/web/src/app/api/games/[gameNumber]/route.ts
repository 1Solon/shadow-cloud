import { createApiAccessToken, getServerAuthSession } from "@/auth";

const apiBaseUrl = process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ gameNumber: string }> },
) {
  const { gameNumber } = await context.params;
  const session = await getServerAuthSession();

  if (!session?.user?.id) {
    return Response.json(
      { error: "Sign in to delete campaigns." },
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
    `${apiBaseUrl}/v1/games/${encodeURIComponent(gameNumber)}`,
    {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string | string[];
      error?: string;
    } | null;
    const message = Array.isArray(payload?.message)
      ? payload.message.join(", ")
      : (payload?.message ??
        payload?.error ??
        "The game delete failed.");

    return Response.json(
      { error: message },
      { status: response.status || 500 },
    );
  }

  return Response.json(await response.json().catch(() => ({ ok: true })));
}