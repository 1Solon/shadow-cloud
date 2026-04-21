import { NextResponse } from "next/server";
import { createApiAccessToken, getServerAuthSession } from "@/auth";

const apiBaseUrl = process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001";

function buildGameRedirect(
  request: Request,
  slug: string,
  status: string,
  message?: string,
) {
  const redirectUrl = new URL(`/games/${slug}`, request.url);
  redirectUrl.searchParams.set("upload", status);

  if (message) {
    redirectUrl.searchParams.set("message", message);
  }

  return redirectUrl;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  const session = await getServerAuthSession();

  if (!session?.user?.id) {
    return NextResponse.redirect(
      buildGameRedirect(request, slug, "error", "Sign in to upload saves."),
    );
  }

  const token = await createApiAccessToken(session).catch(() => null);

  if (!token) {
    return NextResponse.redirect(
      buildGameRedirect(
        request,
        slug,
        "error",
        "API authentication is unavailable.",
      ),
    );
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.redirect(
      buildGameRedirect(
        request,
        slug,
        "error",
        "Choose a save file to upload.",
      ),
    );
  }

  const apiFormData = new FormData();
  apiFormData.set("file", file, file.name);

  const response = await fetch(
    `${apiBaseUrl}/v1/games/${encodeURIComponent(slug)}/files`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
      },
      body: apiFormData,
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(payload?.message)
      ? payload.message.join(", ")
      : (payload?.message ?? "The save upload failed.");

    return NextResponse.redirect(
      buildGameRedirect(request, slug, "error", message),
    );
  }

  return NextResponse.redirect(buildGameRedirect(request, slug, "success"));
}
