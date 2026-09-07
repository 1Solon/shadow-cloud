import { createApiAccessToken, getServerAuthSession } from "@/auth";

export async function POST(
  request: Request,
  context: { params: Promise<{ gameNumber: string }> },
) {
  const headers = { "Cache-Control": "no-store" };
  const fail = (error: string, status: number) =>
    Response.json({ error }, { status, headers });
  const session = await getServerAuthSession();
  if (!session?.user?.id)
    return fail("Sign in to manage password recovery.", 401);
  const token = await createApiAccessToken(session).catch(() => null);
  if (!token) return fail("API authentication is unavailable.", 503);
  const { gameNumber } = await context.params;
  let body;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid undo request.", 400);
  }
  if (!body || body.confirmed !== true)
    return fail("Confirm that undo restores the previous password.", 400);
  try {
    const response = await fetch(
      `${process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001"}/v1/games/${encodeURIComponent(gameNumber)}/password-reset/undo`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          resetId: body.resetId,
          outputId: body.outputId,
          outputRevision: body.outputRevision,
          expectedSaveBaseline: body.expectedSaveBaseline,
          confirmed: true,
        }),
      },
    );
    if (!response.ok)
      return fail(
        response.status === 409
          ? "This reset can no longer be undone. Refresh the campaign and download the latest save."
          : response.status === 403
            ? "Only the current Overlord can manage password recovery."
            : "Undo failed. Refresh the campaign and check recovery before trying again.",
        response.status,
      );
    const result = await response.json();
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
    return fail(
      "The request could not be confirmed. Refresh the campaign before trying again.",
      502,
    );
  }
}
