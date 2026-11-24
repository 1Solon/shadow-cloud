import { createApiAccessToken, getServerAuthSession } from "@/auth";
import { getShadowOverrideEnabled } from "@/lib/shadow-override";

type ApprovalAction = {
  path: string;
  signedOutMessage: string;
  failureMessage: string;
  forbiddenMessage: string;
  conflictMessage: string;
  body: (body: Record<string, unknown>) => Record<string, unknown> | null;
  invalidMessage: string;
  response: (result: unknown) => Record<string, unknown> | null;
};

const unknownOutcome =
  "Outcome unknown. The request could not be confirmed. Refresh the campaign before another action.";

export async function proxyPasswordResetApproval(
  request: Request,
  context: { params: Promise<{ gameNumber: string }> },
  action: ApprovalAction,
) {
  const headers = { "Cache-Control": "no-store" };
  const fail = (error: string, status: number) =>
    Response.json({ error }, { status, headers });
  const session = await getServerAuthSession();
  if (!session?.user?.id) return fail(action.signedOutMessage, 401);
  const shadowOverrideEnabled = await getShadowOverrideEnabled();
  const token = await createApiAccessToken(session, {
    shadowOverrideEnabled,
  }).catch(() => null);
  if (!token) return fail("API authentication is unavailable.", 503);
  const { gameNumber } = await context.params;
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return fail(action.invalidMessage, 400);
  }
  const body =
    typeof parsed === "object" && parsed !== null
      ? action.body(parsed as Record<string, unknown>)
      : null;
  if (!body) return fail(action.invalidMessage, 400);
  try {
    const response = await fetch(
      `${process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001"}/v1/games/${encodeURIComponent(gameNumber)}/${action.path}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const upstream: unknown = await response.json().catch(() => null);
      const message =
        typeof upstream === "object" &&
        upstream !== null &&
        "message" in upstream &&
        typeof upstream.message === "string"
          ? upstream.message
          : null;
      return fail(
        response.status >= 500
          ? unknownOutcome
          : response.status === 403
            ? action.forbiddenMessage
            : response.status === 409 || response.status === 422
              ? (message ?? action.conflictMessage)
              : action.failureMessage,
        response.status,
      );
    }
    const result = action.response(await response.json());
    if (!result) return fail(unknownOutcome, 502);
    return Response.json(result, { headers });
  } catch {
    return fail(unknownOutcome, 502);
  }
}
