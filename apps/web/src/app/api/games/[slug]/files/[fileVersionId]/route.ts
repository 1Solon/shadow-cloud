import { createApiAccessToken, getServerAuthSession } from "@/auth";

const apiBaseUrl = process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string; fileVersionId: string }> },
) {
  const { slug, fileVersionId } = await context.params;
  const session = await getServerAuthSession();

  if (!session?.user?.id) {
    return Response.json(
      { error: "Authentication is required." },
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
    `${apiBaseUrl}/v1/games/${encodeURIComponent(slug)}/files/${encodeURIComponent(fileVersionId)}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string | string[];
      error?: string;
    } | null;
    const message = Array.isArray(payload?.message)
      ? payload.message.join(", ")
      : (payload?.message ?? payload?.error ?? "The save download failed.");

    return Response.json(
      { error: message },
      { status: response.status || 500 },
    );
  }

  const headers = new Headers();

  for (const headerName of [
    "content-type",
    "content-disposition",
    "content-length",
    "last-modified",
  ]) {
    const headerValue = response.headers.get(headerName);

    if (headerValue) {
      headers.set(headerName, headerValue);
    }
  }

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}
