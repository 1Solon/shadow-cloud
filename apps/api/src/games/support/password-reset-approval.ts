import type { Prisma } from '../../database';

export type ApproverRole = 'overlord' | 'shadowLord';

type BindableGame = { id: string; saveRevision: number };

export type ApprovalBinding = {
  saveRevision: number;
  fileVersionId: string;
  contentRevision: number;
};

export function approvalBinding(
  game: BindableGame,
  file: { id: string; contentRevision: number },
): ApprovalBinding {
  return {
    saveRevision: game.saveRevision,
    fileVersionId: file.id,
    contentRevision: file.contentRevision,
  };
}

export function isApprovalBound(
  approval: ApprovalBinding,
  binding: ApprovalBinding | null,
) {
  return (
    binding !== null &&
    approval.saveRevision === binding.saveRevision &&
    approval.fileVersionId === binding.fileVersionId &&
    approval.contentRevision === binding.contentRevision
  );
}

export async function lapseUnboundApprovals(
  tx: Prisma.TransactionClient,
  gameId: string,
  binding: ApprovalBinding | null,
) {
  await tx.passwordResetApproval.updateMany({
    where: {
      gameId,
      state: 'OPEN',
      ...(binding ? { NOT: binding } : {}),
    },
    data: { state: 'LAPSED', endedAt: new Date() },
  });
}

async function displayNames(tx: Prisma.TransactionClient, ids: string[]) {
  const users = ids.length
    ? await tx.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, displayName: true },
      })
    : [];
  return (id: string) =>
    users.find((user) => user.id === id)?.displayName ?? 'Former player';
}

export type PasswordResetApprovalPayload = {
  id: string;
  state: 'OPEN' | 'USED';
  regimeId: string;
  regimeName: string;
  playerId: string;
  playerDisplayName: string;
  approverDisplayName: string;
  approverRole: ApproverRole;
  reason: string | null;
  grantedAt: string;
};

export async function currentPasswordResetApproval(
  tx: Prisma.TransactionClient,
  game: BindableGame,
  latestFile: { id: string; contentRevision: number } | undefined,
): Promise<PasswordResetApprovalPayload | null> {
  if (!latestFile) return null;
  const approval = await tx.passwordResetApproval.findFirst({
    where: { gameId: game.id, state: { in: ['OPEN', 'USED'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!approval) return null;
  if (approval.state === 'OPEN') {
    if (!isApprovalBound(approval, approvalBinding(game, latestFile)))
      return null;
  } else if (
    !(await tx.passwordReset.findFirst({
      where: {
        approvalId: approval.id,
        state: 'ACTIVE',
        fileVersionId: latestFile.id,
        outputRevision: latestFile.contentRevision,
        saveRevision: game.saveRevision,
      },
    }))
  )
    return null;
  const displayName = await displayNames(tx, [
    approval.playerId,
    approval.approverId,
  ]);
  return {
    id: approval.id,
    state: approval.state as 'OPEN' | 'USED',
    regimeId: approval.regimeId,
    regimeName: approval.regimeName,
    playerId: approval.playerId,
    playerDisplayName: displayName(approval.playerId),
    approverDisplayName: displayName(approval.approverId),
    approverRole: approval.approverRole as ApproverRole,
    reason: approval.reason,
    grantedAt: approval.createdAt.toISOString(),
  };
}

export type PasswordResetApprovalSummary = {
  approverDisplayName: string;
  approverRole: ApproverRole;
  reason: string | null;
};

export async function withApprovalSummaries<
  T extends { approvalId: string | null },
>(tx: Prisma.TransactionClient, resets: T[]) {
  const ids = resets.flatMap((reset) =>
    reset.approvalId ? [reset.approvalId] : [],
  );
  const approvals = ids.length
    ? await tx.passwordResetApproval.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          approverId: true,
          approverRole: true,
          reason: true,
        },
      })
    : [];
  const displayName = await displayNames(
    tx,
    approvals.map((approval) => approval.approverId),
  );
  return resets.map((reset) => {
    const approval = approvals.find(
      (candidate) => candidate.id === reset.approvalId,
    );
    return {
      ...reset,
      approval: approval
        ? {
            approverDisplayName: displayName(approval.approverId),
            approverRole: approval.approverRole as ApproverRole,
            reason: approval.reason,
          }
        : null,
    };
  });
}
