import { createDesktopApiAccessToken, getServerAuthSession } from "@/auth";

export async function GET() {
  const session = await getServerAuthSession();

  if (!session?.user?.id) {
    const signInUrl = new URL(
      "/api/auth/signin/discord",
      process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "http://localhost:3000",
    );
    signInUrl.searchParams.set("callbackUrl", "/api/auth/desktop");
    return Response.redirect(signInUrl);
  }

  const token = await createDesktopApiAccessToken(session).catch(() => null);

  if (!token) {
    return Response.json(
      { error: "Desktop API authentication is unavailable." },
      { status: 500 },
    );
  }

  const redirectUrl = new URL("shadow-cloud://auth");
  redirectUrl.searchParams.set("token", token);

  return Response.redirect(redirectUrl);
}
