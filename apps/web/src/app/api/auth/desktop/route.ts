import { createInternalApiToken, getServerAuthSession } from "@/auth";

type DesktopApprovalResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      apiBaseUrl: string;
      body?: string;
      error?: string;
      status?: number;
      statusText?: string;
    };

function getApiBaseUrl() {
  return process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function createHtmlResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, {
    ...init,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}

function createManualDesktopAuthResponse() {
  return createHtmlResponse(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Shadow-Cloud Desktop Auth</title>
  </head>
  <body style="background:#000;color:#fb923c;font-family:monospace;padding:2rem">
    <h1>Shadow-Cloud Desktop Auth</h1>
    <p>This endpoint is opened by the desktop app during sign-in.</p>
    <p>Open Shadow-Cloud Desktop and use the Sign in button to begin a desktop handoff.</p>
  </body>
</html>`);
}

function createDesktopDiscordSignInResponse(callbackUrl: string) {
  const escapedCallbackUrl = escapeHtml(callbackUrl);

  return createHtmlResponse(`<!doctype html>
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
</html>`);
}

function createDesktopApprovalResponse(handoffId: string) {
  const escapedHandoffId = escapeHtml(handoffId);
  const escapedAction = `/api/auth/desktop?handoff=${escapedHandoffId}`;

  return createHtmlResponse(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Approve Shadow-Cloud Desktop</title>
  </head>
  <body style="background:#000;color:#fb923c;font-family:monospace;padding:2rem">
    <h1>Approve Shadow-Cloud Desktop</h1>
    <p>Shadow-Cloud Desktop is waiting for this browser sign-in.</p>
    <form method="POST" action="${escapedAction}">
      <button type="submit">Approve desktop sign-in</button>
    </form>
  </body>
</html>`);
}

function createDesktopSuccessResponse() {
  return createHtmlResponse(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Shadow-Cloud Desktop Approved</title>
  </head>
  <body style="background:#000;color:#fb923c;font-family:monospace;padding:2rem">
    <h1>Shadow-Cloud Desktop Approved</h1>
    <p>Return to desktop.</p>
  </body>
</html>`);
}

function createDesktopApprovalErrorResponse(status = 400) {
  return createHtmlResponse(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Shadow-Cloud Desktop Auth Failed</title>
  </head>
  <body style="background:#000;color:#fb923c;font-family:monospace;padding:2rem">
    <h1>Could not approve Shadow-Cloud Desktop</h1>
    <p>Could not approve this desktop sign-in. Return to Shadow-Cloud Desktop and retry.</p>
  </body>
</html>`,
    { status },
  );
}

function getDesktopCallbackUrl(handoffId: string) {
  return `/api/auth/desktop?handoff=${encodeURIComponent(handoffId)}`;
}

function getCleanString(value: string | null | undefined) {
  return value && value.trim().length > 0 ? value.trim() : null;
}

function isSameOriginPost(request: Request, requestUrl: URL) {
  return request.headers.get("origin") === requestUrl.origin;
}

async function approveDesktopHandoff(
  handoffId: string,
  session: Awaited<ReturnType<typeof getServerAuthSession>>,
): Promise<DesktopApprovalResult> {
  const user = session?.user;
  const resolvedApiBaseUrl = getApiBaseUrl().replace(/\/+$/g, "");

  if (!user?.id) {
    return {
      ok: false,
      apiBaseUrl: resolvedApiBaseUrl,
      error: "Authenticated session is missing a user id.",
    };
  }

  const internalToken = await createInternalApiToken();
  const response = await fetch(
    `${resolvedApiBaseUrl}/v1/auth/desktop-handoffs/${encodeURIComponent(handoffId)}/approve`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${internalToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        userId: user.id,
        email: getCleanString(user.email),
        displayName: getCleanString(user.name),
        avatarUrl: getCleanString(user.image),
      }),
      cache: "no-store",
    },
  );

  if (response.ok) {
    return { ok: true };
  }

  return {
    ok: false,
    apiBaseUrl: resolvedApiBaseUrl,
    status: response.status,
    statusText: response.statusText,
    body: (await response.text().catch(() => "")).slice(0, 2_000),
  };
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const handoffId = getCleanString(requestUrl.searchParams.get("handoff"));

  if (!handoffId) {
    return createManualDesktopAuthResponse();
  }

  const session = await getServerAuthSession();

  if (!session?.user?.id) {
    return createDesktopDiscordSignInResponse(getDesktopCallbackUrl(handoffId));
  }

  return createDesktopApprovalResponse(handoffId);
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const handoffId = getCleanString(requestUrl.searchParams.get("handoff"));

  if (!handoffId || !isSameOriginPost(request, requestUrl)) {
    return createDesktopApprovalErrorResponse(handoffId ? 403 : 400);
  }

  const session = await getServerAuthSession();

  if (!session?.user?.id) {
    return createDesktopDiscordSignInResponse(getDesktopCallbackUrl(handoffId));
  }

  let approved: DesktopApprovalResult;

  try {
    approved = await approveDesktopHandoff(handoffId, session);
  } catch (error) {
    approved = {
      ok: false,
      apiBaseUrl: getApiBaseUrl().replace(/\/+$/g, ""),
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!approved.ok) {
    console.error("Desktop handoff approval failed.", {
      handoffId,
      ...approved,
    });

    return createDesktopApprovalErrorResponse(502);
  }

  return createDesktopSuccessResponse();
}
