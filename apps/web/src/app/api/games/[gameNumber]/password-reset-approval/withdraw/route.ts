import { proxyPasswordResetApproval } from "@/lib/password-reset-approval-proxy";

export function POST(
  request: Request,
  context: { params: Promise<{ gameNumber: string }> },
) {
  return proxyPasswordResetApproval(request, context, {
    path: "password-reset-approval/withdraw",
    signedOutMessage: "Sign in to withdraw an approval.",
    invalidMessage: "Invalid withdrawal request.",
    forbiddenMessage:
      "Only the current Overlord or an enabled Shadow Override can withdraw an approval.",
    conflictMessage: "This approval has already ended.",
    failureMessage:
      "The withdrawal failed. Refresh the campaign and try again.",
    body: (body) =>
      typeof body.approvalId === "string"
        ? { approvalId: body.approvalId }
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
