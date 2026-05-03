import { createDesktopApiAccessToken, getServerAuthSession } from "@/auth";

function createManualDesktopAuthResponse() {
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Shadow-Cloud Desktop Auth</title>
  </head>
  <body style="background:#000;color:#fb923c;font-family:monospace;padding:2rem">
    <h1>Shadow-Cloud Desktop Auth</h1>
    <p>This endpoint is opened by the desktop app during sign-in.</p>
    <p>Open Shadow-Cloud Desktop and use the Sign in button so the app can register the <code>shadow-cloud://</code> protocol first.</p>
  </body>
</html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    },
  );
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const isDesktopHandoff = requestUrl.searchParams.get("handoff") === "1";
  const session = await getServerAuthSession();

  if (!session?.user?.id) {
    const signInUrl = new URL(
      "/api/auth/signin/discord",
      process.env.NEXTAUTH_URL ??
        process.env.AUTH_URL ??
        "http://localhost:3000",
    );
    signInUrl.searchParams.set(
      "callbackUrl",
      isDesktopHandoff ? "/api/auth/desktop?handoff=1" : "/api/auth/desktop",
    );
    return Response.redirect(signInUrl);
  }

  if (!isDesktopHandoff) {
    return createManualDesktopAuthResponse();
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
