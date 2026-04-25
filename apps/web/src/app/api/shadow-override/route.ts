import { cookies } from "next/headers";
import { getServerAuthSession } from "@/auth";
import { shadowOverrideCookieName } from "@/lib/shadow-override";

export async function POST(request: Request) {
  const session = await getServerAuthSession();

  if (!session?.user?.isShadowOverride) {
    return Response.json(
      { error: "Shadow override is not available for this user." },
      { status: 403 },
    );
  }

  const payload = (await request.json().catch(() => null)) as {
    enabled?: unknown;
  } | null;

  if (typeof payload?.enabled !== "boolean") {
    return Response.json(
      { error: "Shadow override payload is invalid." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();

  if (payload.enabled) {
    cookieStore.set(shadowOverrideCookieName, "enabled", {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  } else {
    cookieStore.delete(shadowOverrideCookieName);
  }

  return Response.json({ enabled: payload.enabled });
}
