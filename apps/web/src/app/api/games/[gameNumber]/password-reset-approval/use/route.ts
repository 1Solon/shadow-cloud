import { isPasswordReceipt } from "@/lib/save-inspection";
import { proxyPasswordResetApproval } from "@/lib/password-reset-approval-proxy";

export function POST(
  request: Request,
  context: { params: Promise<{ gameNumber: string }> },
) {
  return proxyPasswordResetApproval(request, context, {
    path: "password-reset-approval/use",
    signedOutMessage: "Sign in to set a password.",
    invalidMessage:
      "Confirm the regime and use 1 to 128 printable ASCII characters.",
    forbiddenMessage:
      "Only the active player named in the approval can set this password.",
    conflictMessage: "This approval has ended. Ask the Overlord for a new one.",
    failureMessage: "Setting the password failed. Refresh and try again.",
    body: (body) =>
      body.confirmed === true &&
      typeof body.approvalId === "string" &&
      typeof body.expectedSaveBaseline === "string" &&
      typeof body.password === "string" &&
      /^[\x20-\x7e]{1,128}$/.test(body.password)
        ? {
            approvalId: body.approvalId,
            expectedSaveBaseline: body.expectedSaveBaseline,
            password: body.password,
            confirmed: true,
          }
        : null,
    response: (result) =>
      isPasswordReceipt(result)
        ? {
            resetId: result.resetId,
            fileVersionId: result.fileVersionId,
            contentRevision: result.contentRevision,
            regimeName: result.regimeName,
            replacedAt: result.replacedAt,
          }
        : null,
  });
}
