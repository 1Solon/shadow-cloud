import { createApiAccessToken, getServerAuthSession } from "@/auth";
import { getShadowOverrideEnabled } from "@/lib/shadow-override";
import type { SaveInspection } from "@/lib/save-inspection";

const apiBaseUrl = process.env.SHADOW_CLOUD_API_URL ?? "http://localhost:3001";
const safeErrors = new Set([
  "Unsupported save format.",
  "The save is malformed or failed its integrity check.",
  "The save exceeds safe inspection limits.",
  "Password protection is disabled for this save.",
  "This campaign has no save to inspect.",
  "Campaign not found.",
  "Only the current Overlord can inspect regimes.",
  "Only the current Overlord or an enabled Shadow Override can inspect regimes.",
  "The latest save changed. Inspect it again.",
  "Save inspection is not configured on this server.",
  "The latest save is unavailable. Refresh and try again.",
]);

export async function GET(
  _request: Request,
  context: { params: Promise<{ gameNumber: string }> },
) {
  const headers = { "Cache-Control": "no-store" };
  const fail = (error: string, status: number) =>
    Response.json({ error }, { status, headers });
  const session = await getServerAuthSession();
  if (!session?.user?.id) return fail("Sign in to inspect this save.", 401);
  const shadowOverrideEnabled = await getShadowOverrideEnabled();
  const token = await createApiAccessToken(session, {
    shadowOverrideEnabled,
  }).catch(() => null);
  if (!token) return fail("API authentication is unavailable.", 503);
  const { gameNumber } = await context.params;
  try {
    const response = await fetch(
      `${apiBaseUrl}/v1/games/${encodeURIComponent(gameNumber)}/save-inspection`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        cache: "no-store",
      },
    );
    const payload = await response.json();
    if (!response.ok)
      return fail(
        safeErrors.has(payload.message)
          ? payload.message
          : "Save inspection failed. Try again.",
        response.status,
      );
    const inspection: SaveInspection = {
      fileVersionId: payload.fileVersionId,
      contentRevision: payload.contentRevision,
      sourceId: payload.sourceId,
      expectedSaveBaseline: payload.expectedSaveBaseline,
      regimes: payload.regimes.map(
        ({
          id,
          name,
          current,
          eligible,
          reason,
        }: SaveInspection["regimes"][number]) => ({
          id,
          name,
          current,
          eligible,
          reason,
        }),
      ),
    };
    return Response.json(inspection, { headers });
  } catch {
    return fail("The save inspection request failed. Try again.", 502);
  }
}
