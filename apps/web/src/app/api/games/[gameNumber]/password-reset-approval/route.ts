import { proxyPasswordResetApproval } from "@/lib/password-reset-approval-proxy";

export function POST(
  request: Request,
  context: { params: Promise<{ gameNumber: string }> },
) {
  return proxyPasswordResetApproval(request, context, {
    path: "password-reset-approval",
    signedOutMessage: "Sign in to approve a password reset.",
    invalidMessage: "Invalid approval request.",
    forbiddenMessage:
      "Only the current Overlord or an enabled Shadow Override can approve a password reset.",
    conflictMessage:
      "The campaign or latest save changed. Inspect it again before approving.",
    failureMessage: "The approval failed. Refresh the campaign and try again.",
    body: (body) =>
      typeof body.fileVersionId === "string" &&
      typeof body.sourceId === "string" &&
      typeof body.expectedSaveBaseline === "string"
        ? {
            fileVersionId: body.fileVersionId,
            sourceId: body.sourceId,
            expectedSaveBaseline: body.expectedSaveBaseline,
            ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
          }
        : null,
    response: (result) =>
      typeof result === "object" &&
      result !== null &&
      "approvalId" in result &&
      typeof result.approvalId === "string"
        ? { approvalId: result.approvalId }
        : null,
  });
}
