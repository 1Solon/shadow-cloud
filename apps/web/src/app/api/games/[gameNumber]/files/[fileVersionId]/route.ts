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

function isMultipartFormData(
  contentType: string | null,
): contentType is string {
  if (!contentType) {
    return false;
  }

  const [mediaType, ...parameters] = contentType.split(";");

  return (
    mediaType.trim().toLowerCase() === "multipart/form-data" &&
    parameters.some((parameter) =>
      /^boundary\s*=\s*(?:"[^"]+"|[^;\s]+)$/i.test(parameter.trim()),
    )
  );
}

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

  const contentType = request.headers.get("content-type");

  if (!request.body || !isMultipartFormData(contentType)) {
    return Response.json(
      { error: "A multipart replacement upload is required." },
      { status: 400 },
    );
  }

  const response = await fetch(
    `${apiBaseUrl}/v1/games/${encodeURIComponent(gameNumber)}/files/${encodeURIComponent(fileVersionId)}`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": contentType,
      },
      body: request.body,
      cache: "no-store",
      duplex: "half",
    } as RequestInit & { duplex: "half" },
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
