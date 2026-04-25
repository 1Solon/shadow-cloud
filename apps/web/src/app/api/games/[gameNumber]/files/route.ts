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
      { error: "Sign in to upload saves." },
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

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return Response.json(
      { error: "Choose a save file to upload." },
      { status: 400 },
    );
  }

  const apiFormData = new FormData();
  apiFormData.set("file", file, file.name);

  const response = await fetch(
    `${apiBaseUrl}/v1/games/${encodeURIComponent(gameNumber)}/files`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
      body: apiFormData,
      cache: "no-store",
    },
  ).catch(() => null);

  if (!response) {
    return Response.json(
      { error: "The save upload could not reach the API." },
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
      : (payload?.message ?? payload?.error ?? "The save upload failed.");

    return Response.json(
      { error: message },
      { status: response.status || 500 },
    );
  }

  return Response.json(
    {
      ok: true,
      redirectTo: `/games/${encodeURIComponent(gameNumber)}?upload=success`,
    },
    { status: 200 },
  );
}
