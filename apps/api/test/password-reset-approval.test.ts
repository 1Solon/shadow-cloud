import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BotNotificationsService } from '../src/games/bot-notifications.service';
import { FileStorageService } from '../src/games/file-storage.service';
import { createSqliteFixture } from './support/sqlite-fixture';
import {
  archiveKey,
  syntheticArchive,
  syntheticPayload,
} from './support/synthetic-save';

let fixture: Awaited<ReturnType<typeof createSqliteFixture>>;
vi.mock('../src/database', async () => ({
  ...(await import('@prisma/client')),
  get prisma() {
    return fixture.db;
  },
}));
const { GamesFileService } =
  await import('../src/games/services/games-file.service');
const { GamesQueryService } =
  await import('../src/games/services/games-query.service');

let directory: string;
let storage: FileStorageService;
let service: InstanceType<typeof GamesFileService>;
const isUserShadowOverride = vi.fn(async (_userId: string) => false);

beforeEach(async () => {
  isUserShadowOverride.mockReset().mockResolvedValue(false);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  fixture = await createSqliteFixture();
  directory = await mkdtemp(join(tmpdir(), 'shadow-approval-'));
  vi.stubEnv('SHADOW_CLOUD_SAVE_DIR', directory);
  vi.stubEnv('SHADOW_CLOUD_SAVE_ARCHIVE_KEY', archiveKey.toString('hex'));
  storage = new FileStorageService();
  service = new GamesFileService(
    { isUserShadowOverride } as never,
    storage,
    new BotNotificationsService(),
  );
  for (const [id, displayName] of [
    ['overlord', 'Overlord'],
    ['player', 'Player'],
    ['shadow-lord', 'Shadow Lord'],
  ])
    await fixture.db.user.create({
      data: {
        id,
        displayName,
        email: `${id}@example.test`,
        identities: {
          create: { provider: 'discord', providerId: `discord-${id}` },
        },
      },
    });
  await fixture.db.game.create({
    data: {
      id: 'campaign',
      gameNumber: 1,
      slug: 'campaign',
      name: 'Campaign',
      organizerId: 'overlord',
      discordThreadId: 'thread',
      players: {
        create: [
          { id: 'player-seat', userId: 'player', turnOrder: 1 },
          {
            id: 'overlord-seat',
            userId: 'overlord',
            turnOrder: 2,
            role: 'ORGANIZER',
          },
        ],
      },
      turnState: {
        create: {
          activePlayerId: 'player',
          activePlayerEntryId: 'player-seat',
          roundNumber: 3,
        },
      },
      turnRecords: {
        create: {
          userId: 'player',
          gamePlayerId: 'player-seat',
          playerDisplayName: 'Player',
          roundNumber: 3,
          startedAt: new Date('2026-09-01T00:00:00Z'),
        },
      },
    },
  });
});

afterEach(async () => {
  for (const method of ['log', 'warn'] as const)
    expect(
      JSON.stringify(vi.mocked(Logger.prototype[method]).mock.calls),
    ).not.toContain('PlayerSecret');
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fixture?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function seed({ currentRegimeEligible = true } = {}) {
  const stored = await storage.stageUpload({
    gameId: 'campaign',
    gameNumber: 1,
    turn: 3,
    seat: 1,
    playerName: 'Player',
    originalName: 'synthetic.se1',
    content: syntheticArchive(
      syntheticPayload({ turn: currentRegimeEligible ? 1 : 2 }),
      Buffer.from(archiveKey.toString('hex')),
    ),
  });
  await fixture.db.fileVersion.create({
    data: {
      id: 'latest',
      gameId: 'campaign',
      versionNumber: 1,
      storagePath: stored.storagePath,
      originalName: stored.fileName,
      uploadedById: 'player',
      contentHash: 'untrusted-metadata',
    },
  });
}

async function grantInput(actor = 'overlord', enabled = false) {
  const { fileVersionId, sourceId, expectedSaveBaseline } =
    await service.inspectLatestSave('1', actor, enabled);
  return { fileVersionId, sourceId, expectedSaveBaseline };
}

async function gameDetail() {
  return new GamesQueryService(storage).getGameDetail('1');
}

it('lets the Overlord grant an approval for the regime the latest save is waiting on', async () => {
  await seed();
  await service.grantPasswordResetApproval('1', 'overlord', await grantInput());
  expect((await gameDetail()).passwordResetApproval).toMatchObject({
    state: 'OPEN',
    regimeName: 'North Reach',
    playerId: 'player',
    playerDisplayName: 'Player',
    approverDisplayName: 'Overlord',
    approverRole: 'overlord',
    reason: null,
    grantedAt: expect.any(String),
  });
});

it('lets a Shadow Lord grant an approval only with a reason', async () => {
  await seed();
  isUserShadowOverride.mockResolvedValue(true);
  const input = await grantInput('shadow-lord', true);
  await expect(
    service.grantPasswordResetApproval('1', 'shadow-lord', input, true),
  ).rejects.toMatchObject({ status: 400 });
  await service.grantPasswordResetApproval(
    '1',
    'shadow-lord',
    { ...input, reason: 'Overlord asked in Discord' },
    true,
  );
  expect((await gameDetail()).passwordResetApproval).toMatchObject({
    approverDisplayName: 'Shadow Lord',
    approverRole: 'shadowLord',
    reason: 'Overlord asked in Discord',
  });
});

it('refuses to grant an approval during a vacant turn', async () => {
  await seed();
  const input = await grantInput();
  await fixture.db.turnState.update({
    where: { gameId: 'campaign' },
    data: { activePlayerId: null },
  });
  await expect(
    service.grantPasswordResetApproval('1', 'overlord', input),
  ).rejects.toThrow(/vacant/);
  expect(await fixture.db.passwordResetApproval.count()).toBe(0);
});

it('refuses to grant an approval when the waiting regime is not eligible', async () => {
  await seed({ currentRegimeEligible: false });
  await expect(
    service.grantPasswordResetApproval('1', 'overlord', await grantInput()),
  ).rejects.toMatchObject({ status: 422 });
  expect(await fixture.db.passwordResetApproval.count()).toBe(0);
});

it('keeps at most one approval open per campaign', async () => {
  await seed();
  const input = await grantInput();
  await service.grantPasswordResetApproval('1', 'overlord', input);
  await expect(
    service.grantPasswordResetApproval('1', 'overlord', input),
  ).rejects.toMatchObject({ status: 409 });
  expect(await fixture.db.passwordResetApproval.count()).toBe(1);
});

it('notifies the active player that they can set the password', async () => {
  await seed();
  await service.grantPasswordResetApproval('1', 'overlord', await grantInput());
  const delivery = await fixture.db.notificationDelivery.findFirstOrThrow({
    where: { event: 'PASSWORD_RESET_APPROVED' },
  });
  expect(JSON.parse(delivery.payload)).toMatchObject({
    player: { id: 'player', discordId: 'discord-player' },
    approval: {
      regimeName: 'North Reach',
      approverRole: 'overlord',
      approver: { id: 'overlord' },
    },
  });
});

async function saveBaseline() {
  const game = await fixture.db.game.findUniqueOrThrow({
    where: { id: 'campaign' },
  });
  return `campaign:${game.turnRevision}:${game.saveRevision}`;
}

async function grant() {
  const { approvalId } = await service.grantPasswordResetApproval(
    '1',
    'overlord',
    await grantInput(),
  );
  return {
    approvalId,
    expectedSaveBaseline: await saveBaseline(),
    password: 'PlayerSecret',
    confirmed: true,
  };
}

it('lets only the active player use an approval, once, recording them and the approver', async () => {
  await seed();
  const input = await grant();
  for (const actor of ['overlord', 'shadow-lord'])
    await expect(
      service.setApprovedPassword('1', actor, input),
    ).rejects.toMatchObject({ status: 403 });
  const receipt = await service.setApprovedPassword('1', 'player', input);
  expect(receipt).toMatchObject({ regimeName: 'North Reach' });
  expect(await fixture.db.passwordReset.findFirstOrThrow()).toMatchObject({
    actorId: 'player',
    approvalId: input.approvalId,
    regimeName: 'North Reach',
  });
  expect(
    await fixture.db.passwordResetApproval.findUniqueOrThrow({
      where: { id: input.approvalId },
    }),
  ).toMatchObject({ state: 'USED', approverId: 'overlord' });
  await expect(
    service.setApprovedPassword('1', 'player', {
      ...input,
      expectedSaveBaseline: await saveBaseline(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await fixture.db.passwordReset.count()).toBe(1);
});

it('lapses an approval when the latest save changes, so it cannot be used', async () => {
  await seed();
  const input = await grant();
  await service.resetPassword('1', 'overlord', {
    ...(await service.inspectLatestSave('1', 'overlord')),
    regimeId: (await service.inspectLatestSave('1', 'overlord')).regimes[0].id,
    password: 'OverlordSecret',
    confirmed: true,
  });
  expect((await gameDetail()).passwordResetApproval).toBeNull();
  await expect(
    service.setApprovedPassword('1', 'player', {
      ...input,
      expectedSaveBaseline: await saveBaseline(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await fixture.db.passwordResetApproval.findUniqueOrThrow({
      where: { id: input.approvalId },
    }),
  ).toMatchObject({ state: 'LAPSED' });
});

it('refuses a withdrawn approval', async () => {
  await seed();
  const input = await grant();
  await expect(
    service.withdrawPasswordResetApproval('1', 'player', input),
  ).rejects.toMatchObject({ status: 403 });
  await service.withdrawPasswordResetApproval('1', 'overlord', input);
  expect((await gameDetail()).passwordResetApproval).toBeNull();
  await expect(
    service.setApprovedPassword('1', 'player', input),
  ).rejects.toMatchObject({ status: 409 });
  expect(await fixture.db.passwordReset.count()).toBe(0);
});

it('lapses an approval when the uploader replaces the latest save', async () => {
  await seed();
  const input = await grant();
  await service.replaceSave('1', 'latest', 'player', {
    buffer: Buffer.from('newer bytes'),
    originalname: 'newer.se1',
    size: 11,
  });
  expect((await gameDetail()).passwordResetApproval).toBeNull();
  await expect(
    service.setApprovedPassword('1', 'player', {
      ...input,
      expectedSaveBaseline: await saveBaseline(),
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await fixture.db.passwordResetApproval.findUniqueOrThrow({
      where: { id: input.approvalId },
    }),
  ).toMatchObject({ state: 'LAPSED' });
});

it('lets the player who set the password undo it during the same turn', async () => {
  await seed();
  await service.setApprovedPassword('1', 'player', await grant());
  const { undo } = await service.getPasswordResetRecovery('1', 'player');
  expect(undo).toMatchObject({ regimeName: 'North Reach' });
  await service.undoPasswordReset('1', 'player', { ...undo!, confirmed: true });
  expect(await fixture.db.passwordReset.findFirstOrThrow()).toMatchObject({
    undoReason: null,
    undoRevision: 2,
  });
  const notices = await fixture.db.notificationDelivery.findMany({
    where: { event: 'SAVE_REPLACED' },
    orderBy: { createdAt: 'asc' },
  });
  expect(
    notices.map(
      (notice) => JSON.parse(notice.payload).replacement.passwordRecovery,
    ),
  ).toMatchObject([
    { operation: 'reset', actorRole: 'player', approverRole: 'overlord' },
    { operation: 'undo', actorRole: 'player' },
  ]);
});

it('stops the player undoing once the latest save changes', async () => {
  await seed();
  await service.setApprovedPassword('1', 'player', await grant());
  const { undo } = await service.getPasswordResetRecovery('1', 'player');
  await service.replaceSave('1', 'latest', 'player', {
    buffer: Buffer.from('newer bytes'),
    originalname: 'newer.se1',
    size: 11,
  });
  await expect(
    service.getPasswordResetRecovery('1', 'player'),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.undoPasswordReset('1', 'player', { ...undo!, confirmed: true }),
  ).rejects.toMatchObject({ status: 403 });
});

it("shows the setter, approver and a Shadow Lord's reason in save history without the password", async () => {
  await seed();
  isUserShadowOverride.mockResolvedValue(true);
  const { approvalId } = await service.grantPasswordResetApproval(
    '1',
    'shadow-lord',
    { ...(await grantInput('shadow-lord', true)), reason: 'Overlord away' },
    true,
  );
  await service.setApprovedPassword('1', 'player', {
    approvalId,
    expectedSaveBaseline: await saveBaseline(),
    password: 'PlayerSecret',
    confirmed: true,
  });
  const detail = await gameDetail();
  expect(detail.fileVersions[0]).toMatchObject({
    replacedByDisplayName: 'Player',
    replacementApproval: {
      approverDisplayName: 'Shadow Lord',
      approverRole: 'shadowLord',
    },
    replacementReason: 'Overlord away',
  });
  expect(
    JSON.stringify([
      detail,
      await fixture.db.notificationDelivery.findMany(),
      await fixture.db.auditEvent.findMany(),
    ]),
  ).not.toContain('PlayerSecret');
});

it('refuses to withdraw without naming the approval', async () => {
  await seed();
  await grant();
  await expect(
    service.withdrawPasswordResetApproval('1', 'overlord', {} as never),
  ).rejects.toMatchObject({ status: 400 });
  expect((await gameDetail()).passwordResetApproval).toMatchObject({
    state: 'OPEN',
  });
});

it('keeps an approval open when the Overlord transfers host control', async () => {
  await seed();
  await grant();
  await fixture.db.game.update({
    where: { id: 'campaign' },
    data: { turnRevision: { increment: 1 } },
  });
  expect((await gameDetail()).passwordResetApproval).toMatchObject({
    state: 'OPEN',
  });
});

it('stops the player undoing once they no longer hold the active seat', async () => {
  await seed();
  await service.setApprovedPassword('1', 'player', await grant());
  const { undo } = await service.getPasswordResetRecovery('1', 'player');
  await fixture.db.turnState.update({
    where: { gameId: 'campaign' },
    data: { activePlayerId: null },
  });
  await expect(
    service.undoPasswordReset('1', 'player', { ...undo!, confirmed: true }),
  ).rejects.toMatchObject({ status: 403 });
});
