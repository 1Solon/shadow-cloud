import { createInternalApiToken, getServerAuthSession } from "@/auth";

type ApprovalResult =
  { ok: true; pasteToken: string } | { ok: false; detail: string };

function apiBaseUrl() {
  return (process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001").replace(
    /\/+$/g,
    "",
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function page(
  title: string,
  content: string,
  status = 200,
  allowDiscordOAuthRedirect = false,
) {
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: dark; font-family: ui-monospace, monospace; background: #000; color: #fb923c; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
      main { width: min(580px, 100%); border: 1px solid currentColor; border-radius: 8px; padding: 28px; box-sizing: border-box; }
      h1 { color: #fed7aa; font-size: 20px; font-weight: 500; }
      p { color: #c9a47b; line-height: 1.6; }
      button, input { width: 100%; min-height: 42px; box-sizing: border-box; border: 1px solid #fb923c; border-radius: 6px; background: transparent; color: #fb923c; font: inherit; }
      button { cursor: pointer; font-weight: 700; }
      input { padding: 0 12px; margin: 8px 0; }
      label { display: block; color: #c9a47b; font-size: 12px; }
    </style>
  </head>
  <body><main>${content}</main></body>
</html>`,
    {
      status,
      headers: {
        "cache-control": "no-store",
        "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'${allowDiscordOAuthRedirect ? " https://discord.com" : ""}; frame-ancestors 'none'; base-uri 'none'`,
        "content-type": "text/html; charset=utf-8",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
      },
    },
  );
}

function clean(value: string | null) {
  return value?.trim() || null;
}

function origin(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function sameOrigin(request: Request, requestUrl: URL) {
  const supplied = request.headers.get("origin");
  if (!supplied) return false;
  return new Set(
    [
      requestUrl.origin,
      origin(process.env.AUTH_URL),
      origin(process.env.NEXTAUTH_URL),
    ].filter((value): value is string => Boolean(value)),
  ).has(supplied);
}

function callbackPath(handoffId: string) {
  return `/api/auth/companion?handoff=${encodeURIComponent(handoffId)}`;
}

function signInPage(handoffId: string) {
  const callback = escapeHtml(callbackPath(handoffId));
  return page(
    "Shadow Cloud Companion sign in",
    `<h1>&gt; SHADOW CLOUD / COMPANION</h1>
    <p>Sign in with Discord, then review the Device session request.</p>
    <form id="companion-sign-in" method="POST" action="/api/auth/signin/discord">
      <input id="csrf-token" type="hidden" name="csrfToken" value="" />
      <input type="hidden" name="callbackUrl" value="${callback}" />
      <button id="submit-button" type="submit" disabled>CONTINUE WITH DISCORD</button>
    </form>
    <script>
      (async () => {
        const payload = await fetch("/api/auth/csrf", { credentials: "same-origin" }).then((response) => response.json());
        document.getElementById("csrf-token").value = payload.csrfToken;
        document.getElementById("submit-button").disabled = false;
        document.getElementById("companion-sign-in").submit();
      })().catch(() => { document.querySelector("p").textContent = "Could not start sign in. Refresh to retry."; });
    </script>`,
    200,
    true,
  );
}

function approvalPage(handoffId: string) {
  const action = escapeHtml(callbackPath(handoffId));
  return page(
    "Approve Shadow Cloud Companion",
    `<h1>&gt; APPROVE COMPANION</h1>
    <p>This creates a revocable Device session limited to observing Campaigns and transferring your seated turns. It cannot administer Campaigns or your account.</p>
    <form method="POST" action="${action}"><button type="submit">APPROVE DEVICE SESSION</button></form>`,
  );
}

function successPage(pasteToken: string) {
  const token = escapeHtml(pasteToken);
  return page(
    "Shadow Cloud Companion connected",
    `<h1>&gt; DEVICE SESSION APPROVED</h1>
    <p>Connected automatically. You can return to Shadow Cloud Companion.</p>
    <p>If the Companion is on another system, copy this ten-minute, one-use token and paste it there.</p>
    <label for="paste-token">ONE-USE TOKEN</label>
    <input id="paste-token" readonly value="${token}" />
    <button id="copy-token" type="button">COPY TOKEN</button>
    <script>
      document.getElementById("copy-token").addEventListener("click", async () => {
        await navigator.clipboard.writeText(document.getElementById("paste-token").value);
        document.getElementById("copy-token").textContent = "COPIED";
      });
    </script>`,
  );
}

function errorPage(status: number, detail?: string) {
  return page(
    "Shadow Cloud Companion authorization failed",
    `<h1>&gt; COULD NOT APPROVE COMPANION</h1>
    <p>The request is invalid, expired, or already used. Return to the Companion and start again.</p>${detail ? `<p>${escapeHtml(detail)}</p>` : ""}`,
    status,
  );
}

async function approve(
  handoffId: string,
  userId: string,
): Promise<ApprovalResult> {
  try {
    const internalToken = await createInternalApiToken();
    const response = await fetch(
      `${apiBaseUrl()}/v1/auth/companion-handoffs/${encodeURIComponent(handoffId)}/approve`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${internalToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ userId }),
        cache: "no-store",
      },
    );
    const payload = (await response.json().catch(() => null)) as {
      pasteToken?: unknown;
      message?: unknown;
    } | null;
    if (!response.ok || typeof payload?.pasteToken !== "string") {
      return {
        ok: false,
        detail: `API approval failed: HTTP ${response.status}`,
      };
    }
    return { ok: true, pasteToken: payload.pasteToken };
  } catch (cause) {
    return {
      ok: false,
      detail:
        cause instanceof Error ? cause.message : "Approval request failed.",
    };
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const handoffId = clean(requestUrl.searchParams.get("handoff"));
  if (!handoffId) {
    return page(
      "Shadow Cloud Companion authorization",
      `<h1>&gt; SHADOW CLOUD / COMPANION</h1><p>Start sign in from the Companion. If it cannot open a browser, copy the authorization link shown there into this browser.</p>`,
    );
  }
  const session = await getServerAuthSession();
  return session?.user?.id ? approvalPage(handoffId) : signInPage(handoffId);
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const handoffId = clean(requestUrl.searchParams.get("handoff"));
  if (!handoffId || !sameOrigin(request, requestUrl)) {
    return errorPage(handoffId ? 403 : 400);
  }
  const session = await getServerAuthSession();
  if (!session?.user?.id) return signInPage(handoffId);
  const result = await approve(handoffId, session.user.id);
  if (!result.ok) {
    console.error("Companion handoff approval failed.", {
      handoffId,
      detail: result.detail,
    });
    return errorPage(502, result.detail);
  }
  return successPage(result.pasteToken);
}
