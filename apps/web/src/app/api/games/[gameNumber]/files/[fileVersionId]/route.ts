import { createApiAccessToken, getServerAuthSession } from "@/auth";
import { getShadowOverrideEnabled } from "@/lib/shadow-override";

const apiBaseUrl = process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001";

type ReplacementSaveResponsePayload = {
  fileVersionId?: string;
  versionNumber?: number;
  originalName?: string;
  replacedAt?: string;
  replacedByDisplayName?: string;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ gameNumber: string; fileVersionId: string }> },
) {
  const { gameNumber, fileVersionId } = await context.params;

  const response = await fetch(
    `${apiBaseUrl}/v1/games/${encodeURIComponent(gameNumber)}/files/${encodeURIComponent(fileVersionId)}`,
    {
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

export async function PUT(
  request: Request,
  context: { params: Promise<{ gameNumber: string; fileVersionId: string }> },
) {
  const { gameNumber, fileVersionId } = await context.params;
  const session = await getServerAuthSession();

  if (!session?.user?.id) {
    return Response.json(
      { error: "Sign in to replace save files." },
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

  const source = await request.formData();
  const file = source.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return Response.json(
      { error: "Choose a replacement save file." },
      { status: 400 },
    );
  }

  const body = new FormData();
  body.set("file", file, file.name);

  const response = await fetch(
    `${apiBaseUrl}/v1/games/${encodeURIComponent(gameNumber)}/files/${encodeURIComponent(fileVersionId)}`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
      },
      body,
      cache: "no-store",
    },
  ).catch(() => null);

  if (!response) {
    return Response.json(
      { error: "The save replacement could not reach the API." },
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
      : (payload?.message ?? payload?.error ?? "The save replacement failed.");

    return Response.json(
      { error: message },
      { status: response.status || 500 },
    );
  }

  const payload = (await response
    .json()
    .catch(() => null)) as ReplacementSaveResponsePayload | null;

  return Response.json({
    ok: true,
    fileVersionId: payload?.fileVersionId,
    versionNumber: payload?.versionNumber,
    originalName: payload?.originalName,
    replacedAt: payload?.replacedAt,
    replacedByDisplayName: payload?.replacedByDisplayName,
  });
}
