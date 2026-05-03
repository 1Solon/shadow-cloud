import { createDesktopApiAccessToken, getServerAuthSession } from "@/auth";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

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

function createDesktopDiscordSignInResponse(callbackUrl: string) {
  const escapedCallbackUrl = escapeHtml(callbackUrl);

  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Shadow-Cloud Desktop Sign In</title>
  </head>
  <body style="background:#000;color:#fb923c;font-family:monospace;padding:2rem">
    <h1>Shadow-Cloud Desktop Sign In</h1>
    <p>Opening Discord sign-in...</p>
    <form id="desktop-sign-in" method="POST" action="/api/auth/signin/discord">
      <input id="csrf-token" type="hidden" name="csrfToken" value="" />
      <input type="hidden" name="callbackUrl" value="${escapedCallbackUrl}" />
      <button id="submit-button" type="submit" disabled>Continue with Discord</button>
    </form>
    <script>
      (async () => {
        const form = document.getElementById("desktop-sign-in");
        const csrfToken = document.getElementById("csrf-token");
        const submitButton = document.getElementById("submit-button");
        const response = await fetch("/api/auth/csrf", { credentials: "same-origin" });
        const payload = await response.json();
        csrfToken.value = payload.csrfToken;
        submitButton.disabled = false;
        form.submit();
      })().catch(() => {
        document.querySelector("p").textContent = "Could not start Discord sign-in. Refresh this page to retry.";
      });
    </script>
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
    return createDesktopDiscordSignInResponse(
      isDesktopHandoff ? "/api/auth/desktop?handoff=1" : "/api/auth/desktop",
    );
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
