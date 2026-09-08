import { createApiAccessToken, getServerAuthSession } from "@/auth";
import { getShadowOverrideEnabled } from "@/lib/shadow-override";
import { isPasswordReceipt, isPasswordRecovery } from "@/lib/save-inspection";

const unknownOutcome =
  "Outcome unknown. The request could not be confirmed. Check fresh inspection and recovery before another action.";

export async function GET(
  _request: Request,
  context: { params: Promise<{ gameNumber: string }> },
) {
  const headers = { "Cache-Control": "no-store" };
  const fail = (error: string, status: number) =>
    Response.json({ error }, { status, headers });
  const session = await getServerAuthSession();
  if (!session?.user?.id)
    return fail("Sign in to manage password recovery.", 401);
  const shadowOverrideEnabled = await getShadowOverrideEnabled();
  const token = await createApiAccessToken(session, {
    shadowOverrideEnabled,
  }).catch(() => null);
  if (!token) return fail("API authentication is unavailable.", 503);
  const { gameNumber } = await context.params;
  try {
    const response = await fetch(
      `${process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001"}/v1/games/${encodeURIComponent(gameNumber)}/password-reset`,
      { headers: { authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    if (!response.ok)
      return fail(
        response.status === 403
          ? "Only the current Overlord or an enabled Shadow Override can manage password recovery."
          : "Recovery is unavailable. Refresh the campaign and try again.",
        response.status,
      );
    const payload: unknown = await response.json();
    if (!isPasswordRecovery(payload))
      return fail("Recovery is unavailable. Retry recovery.", 502);
    const { undo } = payload;
    return Response.json(
      {
        undo: undo
          ? {
              resetId: undo.resetId,
              outputId: undo.outputId,
              outputRevision: undo.outputRevision,
              expectedSaveBaseline: undo.expectedSaveBaseline,
              regimeName: undo.regimeName,
            }
          : null,
      },
      { headers },
    );
  } catch {
    return fail(
      "Recovery is unavailable. Refresh the campaign and try again.",
      502,
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ gameNumber: string }> },
) {
  const headers = { "Cache-Control": "no-store" };
  const fail = (error: string, status: number) =>
    Response.json({ error }, { status, headers });
  const session = await getServerAuthSession();
  if (!session?.user?.id) return fail("Sign in to reset a password.", 401);
  const shadowOverrideEnabled = await getShadowOverrideEnabled();
  const token = await createApiAccessToken(session, {
    shadowOverrideEnabled,
  }).catch(() => null);
  if (!token) return fail("API authentication is unavailable.", 503);
  const { gameNumber } = await context.params;
  let body;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid reset request.", 400);
  }
  if (
    !body ||
    body.confirmed !== true ||
    typeof body.password !== "string" ||
    !/^[\x20-\x7e]{1,128}$/.test(body.password)
  )
    return fail(
      "Confirm the regime and use 1 to 128 printable ASCII characters.",
      400,
    );
  try {
    const response = await fetch(
      `${process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001"}/v1/games/${encodeURIComponent(gameNumber)}/password-reset`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          fileVersionId: body.fileVersionId,
          sourceId: body.sourceId,
          expectedSaveBaseline: body.expectedSaveBaseline,
          regimeId: body.regimeId,
          password: body.password,
          confirmed: true,
        }),
      },
    );
    if (!response.ok)
      return fail(
        response.status >= 500
          ? unknownOutcome
          : response.status === 409
            ? "The campaign or latest save changed. Inspect it again before resetting."
            : response.status === 403
              ? "Only the current Overlord or an enabled Shadow Override can reset passwords."
              : "Password reset failed. Inspect the latest save and try again.",
        response.status,
      );
    const result = await response.json();
    if (
      !isPasswordReceipt(result) ||
      result.fileVersionId !== body.fileVersionId
    )
      return fail(unknownOutcome, 502);
    return Response.json(
      {
        resetId: result.resetId,
        fileVersionId: result.fileVersionId,
        contentRevision: result.contentRevision,
        regimeName: result.regimeName,
        replacedAt: result.replacedAt,
      },
      { headers },
    );
  } catch {
    return fail(unknownOutcome, 502);
  }
}
