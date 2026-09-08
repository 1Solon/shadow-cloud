import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSqliteFixture } from './support/sqlite-fixture';
import {
  archiveKey,
  syntheticArchive,
  syntheticPayload,
} from './support/synthetic-save';
import { FileStorageService } from '../src/games/file-storage.service';
import { BotNotificationsService } from '../src/games/bot-notifications.service';
import { createHash } from 'node:crypto';
import { writeFile, readdir, readFile } from 'node:fs/promises';
import { TurnMutationsService } from '../src/games/services/turn-mutations.service';
import { TurnRecordsService } from '../src/games/services/turn-records.service';
import { Logger } from '@nestjs/common';

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
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  fixture = await createSqliteFixture();
  directory = await mkdtemp(join(tmpdir(), 'shadow-inspect-'));
  vi.stubEnv('SHADOW_CLOUD_SAVE_DIR', directory);
  vi.stubEnv('SHADOW_CLOUD_SAVE_ARCHIVE_KEY', archiveKey.toString('hex'));
  storage = new FileStorageService();
  service = new GamesFileService(
    { isUserShadowOverride } as never,
    storage,
    new BotNotificationsService(),
  );
  await fixture.db.user.create({
    data: {
      id: 'overlord',
      email: 'overlord@example.test',
      displayName: 'Overlord',
    },
  });
  await fixture.db.user.create({
    data: { id: 'player', email: 'player@example.test', displayName: 'Player' },
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
it('resets a non-current regime as an observable replacement, retaining immediate recovery and turn state', async () => {
  await seed();
  const before = await fixture.db.game.findUniqueOrThrow({
    where: { id: 'campaign' },
    include: { turnState: true, turnRecords: true, fileVersions: true },
  });
  const inspection = await service.inspectLatestSave('1', 'overlord');
  const result = await service.resetPassword('1', 'overlord', {
    ...inspection,
    regimeId: inspection.regimes[0].id,
    password: 'NewSecret',
    confirmed: true,
  });
  const after = await fixture.db.game.findUniqueOrThrow({
    where: { id: 'campaign' },
    include: { turnState: true, turnRecords: true, fileVersions: true },
  });
  expect(after.turnState).toEqual(before.turnState);
  expect(after.turnRecords).toEqual(before.turnRecords);
  expect(after.fileVersions[0]).toMatchObject({
    id: 'latest',
    versionNumber: 1,
    contentRevision: 1,
    replacedById: 'overlord',
  });
  const updatedInspection = await service.inspectLatestSave('1', 'overlord');
  expect(updatedInspection).toMatchObject({
    fileVersionId: 'latest',
    contentRevision: 1,
    sourceId: after.fileVersions[0].contentHash,
  });
  expect(updatedInspection.expectedSaveBaseline).not.toBe(
    inspection.expectedSaveBaseline,
  );
  const download = await new GamesQueryService(storage).downloadSave(
    '1',
    'latest',
  );
  const chunks: Buffer[] = [];
  for await (const chunk of download.stream) chunks.push(Buffer.from(chunk));
  expect(after.fileVersions[0].contentHash).toBe(
    `sha256:${createHash('sha256').update(Buffer.concat(chunks)).digest('hex')}`,
  );
  const recovery = await fixture.db.passwordReset.findFirstOrThrow();
  expect(recovery).toMatchObject({
    sourcePath: before.fileVersions[0].storagePath,
    sourceId: inspection.sourceId,
    outputId: after.fileVersions[0].contentHash,
    state: 'ACTIVE',
    actorId: 'overlord',
    regimeName: 'North Reach',
  });
  expect(
    JSON.stringify([
      result,
      await fixture.db.auditEvent.findMany(),
      await fixture.db.notificationDelivery.findMany(),
      recovery,
    ]),
  ).not.toContain('NewSecret');
  expect(
    await fixture.db.notificationDelivery.findFirstOrThrow(),
  ).toMatchObject({ event: 'SAVE_REPLACED' });
});

async function resetInput() {
  const inspection = await service.inspectLatestSave('1', 'overlord');
  return {
    ...inspection,
    regimeId: inspection.regimes[0].id,
    password: 'NewSecret',
    confirmed: true,
  };
}

it('enabled Shadow Override can inspect, reset, recover and undo without impersonating the Overlord', async () => {
  await seed();
  isUserShadowOverride.mockResolvedValue(true);
  const inspection = await service.inspectLatestSave('1', 'player', true);
  await service.resetPassword(
    '1',
    'player',
    {
      ...inspection,
      regimeId: inspection.regimes[0].id,
      password: 'NewSecret',
      confirmed: true,
    },
    true,
  );
  expect(await fixture.db.passwordReset.findFirstOrThrow()).toMatchObject({
    actorId: 'player',
  });
  const { undo } = await service.getPasswordResetRecovery('1', 'player', true);
  expect(undo).not.toBeNull();
  await service.undoPasswordReset(
    '1',
    'player',
    { ...undo!, confirmed: true },
    true,
  );
  expect(await service.getPasswordResetRecovery('1', 'player', true)).toEqual({
    undo: null,
  });
  expect(
    await fixture.db.game.findUniqueOrThrow({ where: { id: 'campaign' } }),
  ).toMatchObject({ organizerId: 'overlord' });
  expect(await fixture.db.auditEvent.findMany()).toEqual(
    expect.arrayContaining([expect.objectContaining({ actorId: 'player' })]),
  );
});

it.each([
  { actor: 'player', enabled: true, privileged: false, status: 403 },
  { actor: 'player', enabled: false, privileged: true, status: 403 },
  { actor: undefined, enabled: true, privileged: true, status: 401 },
])(
  'denies all password operations without both authority and intent: %j',
  async ({ actor, enabled, privileged, status }) => {
    await seed();
    const input = await resetInput();
    await service.resetPassword('1', 'overlord', input);
    const { undo } = await service.getPasswordResetRecovery('1', 'overlord');
    isUserShadowOverride.mockResolvedValue(privileged);
    for (const operation of [
      () => service.inspectLatestSave('1', actor, enabled),
      () => service.resetPassword('1', actor, input, enabled),
      () => service.getPasswordResetRecovery('1', actor, enabled),
      () =>
        service.undoPasswordReset(
          '1',
          actor,
          { ...undo!, confirmed: true },
          enabled,
        ),
    ])
      await expect(operation()).rejects.toMatchObject({ status });
  },
);

it.each(['reset', 'undo'] as const)(
  'revalidates override privilege inside the %s transaction and rolls back publication',
  async (operation) => {
    await seed();
    const input = await resetInput();
    if (operation === 'undo')
      await service.resetPassword('1', 'overlord', input);
    const { undo } = await service.getPasswordResetRecovery('1', 'overlord');
    const before = await fixture.db.fileVersion.findUniqueOrThrow({
      where: { id: 'latest' },
    });
    const gameBefore = await fixture.db.game.findUniqueOrThrow({
      where: { id: 'campaign' },
    });
    isUserShadowOverride.mockResolvedValueOnce(true).mockResolvedValue(false);
    await expect(
      operation === 'reset'
        ? service.resetPassword('1', 'player', input, true)
        : service.undoPasswordReset(
            '1',
            'player',
            { ...undo!, confirmed: true },
            true,
          ),
    ).rejects.toMatchObject({ status: 403 });
    expect(isUserShadowOverride).toHaveBeenCalledTimes(2);
    expect(
      await fixture.db.fileVersion.findUniqueOrThrow({
        where: { id: 'latest' },
      }),
    ).toEqual(before);
    expect(
      await fixture.db.game.findUniqueOrThrow({ where: { id: 'campaign' } }),
    ).toEqual(gameBefore);
  },
);

it.each(['inspection', 'recovery'] as const)(
  'rechecks override privilege before returning %s',
  async (operation) => {
    await seed();
    if (operation === 'recovery')
      await service.resetPassword('1', 'overlord', await resetInput());
    isUserShadowOverride.mockResolvedValueOnce(true).mockResolvedValue(false);
    await expect(
      operation === 'inspection'
        ? service.inspectLatestSave('1', 'player', true)
        : service.getPasswordResetRecovery('1', 'player', true),
    ).rejects.toMatchObject({ status: 403 });
    expect(isUserShadowOverride).toHaveBeenCalledTimes(2);
  },
);

it('undo restores the byte-exact immediate source as a replacement and consumes recovery without changing the turn', async () => {
  const original = await seed();
  const bytes = await readFile(original.storagePath);
  await service.resetPassword('1', 'overlord', await resetInput());
  const before = await fixture.db.game.findUniqueOrThrow({
    where: { id: 'campaign' },
    include: { turnState: true, turnRecords: true },
  });
  const { undo } = await service.getPasswordResetRecovery('1', 'overlord');
  expect(undo).toMatchObject({ regimeName: 'North Reach', outputRevision: 1 });
  const result = await service.undoPasswordReset('1', 'overlord', {
    ...undo!,
    confirmed: true,
  });
  expect(result).toMatchObject({ fileVersionId: 'latest', contentRevision: 2 });
  const restored = await fixture.db.fileVersion.findUniqueOrThrow({
    where: { id: 'latest' },
  });
  expect(await readFile(restored.storagePath)).toEqual(bytes);
  expect(restored.storagePath).not.toBe(original.storagePath);
  expect(restored).toMatchObject({
    versionNumber: 1,
    replacedById: 'overlord',
    contentHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  });
  const after = await fixture.db.game.findUniqueOrThrow({
    where: { id: 'campaign' },
    include: { turnState: true, turnRecords: true },
  });
  expect(after.turnState).toEqual(before.turnState);
  expect(after.turnRecords).toEqual(before.turnRecords);
  expect(await service.getPasswordResetRecovery('1', 'overlord')).toEqual({
    undo: null,
  });
  await service.cleanupRecovery();
  expect(await readFile(restored.storagePath)).toEqual(bytes);
  expect(await readdir(join(directory, 'saves', 'campaign'))).toHaveLength(1);
  await expect(
    service.undoPasswordReset('1', 'overlord', { ...undo!, confirmed: true }),
  ).rejects.toMatchObject({ status: 409 });
});

it.each([
  'upload',
  'replace',
  'reset',
  'undo',
  'transfer',
  'bytes',
  'artifact',
])(
  'undo rejects an overlapping %s without stale restoration',
  async (change) => {
    await seed();
    await service.resetPassword('1', 'overlord', await resetInput());
    const { undo } = await service.getPasswordResetRecovery('1', 'overlord');
    const input = { ...undo!, confirmed: true };
    const reset = await fixture.db.passwordReset.findFirstOrThrow({
      where: { state: 'ACTIVE' },
    });
    const stage = storage.stageReplacement.bind(storage);
    vi.spyOn(storage, 'stageReplacement').mockImplementationOnce(
      async (request) => {
        const staged = await stage(request);
        if (change === 'upload')
          await new TurnMutationsService(fixture.db, new TurnRecordsService(), {
            fileStorage: storage,
          }).uploadSave('1', 'player', {
            buffer: Buffer.from('later'),
            originalname: 'turn.se1',
            size: 5,
          });
        if (change === 'replace')
          await service.replaceSave('1', 'latest', 'player', {
            buffer: Buffer.from('later'),
            originalname: 'turn.se1',
            size: 5,
          });
        if (change === 'reset')
          await service.resetPassword('1', 'overlord', await resetInput());
        if (change === 'undo')
          await service.undoPasswordReset('1', 'overlord', input);
        if (change === 'transfer')
          await fixture.db.game.update({
            where: { id: 'campaign' },
            data: { organizerId: 'player', turnRevision: { increment: 1 } },
          });
        if (change === 'bytes') {
          const file = await fixture.db.fileVersion.findUniqueOrThrow({
            where: { id: 'latest' },
          });
          await writeFile(file.storagePath, 'changed output');
        }
        if (change === 'artifact')
          await writeFile(reset.sourcePath, 'changed recovery');
        return staged;
      },
    );
    await expect(
      service.undoPasswordReset('1', 'overlord', input),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await fixture.db.auditEvent.count({
        where: { payload: { contains: 'password-reset-undo' } },
      }),
    ).toBe(change === 'undo' ? 1 : 0);
    expect(await fixture.db.saveCleanup.count()).toBe(0);
  },
);

it('after two resets undo restores only the second source, with password-free audit and notifications', async () => {
  await seed();
  await service.resetPassword('1', 'overlord', await resetInput());
  const file = await fixture.db.fileVersion.findUniqueOrThrow({
    where: { id: 'latest' },
  });
  const immediate = await readFile(file.storagePath);
  await service.resetPassword('1', 'overlord', {
    ...(await resetInput()),
    password: 'SecondSecret',
  });
  const { undo } = await service.getPasswordResetRecovery('1', 'overlord');
  const remove = vi
    .spyOn(storage, 'removeFileOrThrow')
    .mockRejectedValue(new Error('busy'));
  await service.undoPasswordReset('1', 'overlord', {
    ...undo!,
    confirmed: true,
  });
  expect(await service.getPasswordResetRecovery('1', 'overlord')).toEqual({
    undo: null,
  });
  remove.mockRestore();
  await service.cleanupRecovery();
  const canonical = await fixture.db.fileVersion.findUniqueOrThrow({
    where: { id: 'latest' },
  });
  expect(await readFile(canonical.storagePath)).toEqual(immediate);
  expect(
    await fixture.db.passwordReset.count({ where: { state: 'ACTIVE' } }),
  ).toBe(0);
  const audit = JSON.stringify(await fixture.db.auditEvent.findMany());
  const notifications = JSON.stringify(
    await fixture.db.notificationDelivery.findMany(),
  );
  for (const secret of ['NewSecret', 'SecondSecret']) {
    expect(audit).not.toContain(secret);
    expect(notifications).not.toContain(secret);
  }
  expect(audit).toContain('password-reset-undo');
  expect(notifications).toContain('undo');
});

it.each(['missing', 'stage', 'integrity', 'commit'])(
  'failed undo (%s) leaves canonical untouched and does not consume recovery',
  async (failure) => {
    await seed();
    await service.resetPassword('1', 'overlord', await resetInput());
    const { undo } = await service.getPasswordResetRecovery('1', 'overlord');
    const before = await fixture.db.fileVersion.findUniqueOrThrow({
      where: { id: 'latest' },
    });
    const bytes = await readFile(before.storagePath);
    if (failure === 'missing')
      await storage.removeFileOrThrow(
        (await fixture.db.passwordReset.findFirstOrThrow()).sourcePath,
      );
    if (failure === 'stage')
      vi.spyOn(storage, 'stageReplacement').mockRejectedValueOnce(
        new Error('storage unavailable'),
      );
    if (failure === 'integrity') {
      const stage = storage.stageReplacement.bind(storage);
      vi.spyOn(storage, 'stageReplacement').mockImplementationOnce(
        async (request) => {
          const staged = await stage(request);
          await writeFile(staged.storagePath, 'corrupted');
          return staged;
        },
      );
    }
    if (failure === 'commit')
      await fixture.db.$executeRawUnsafe(
        "CREATE TRIGGER reject_undo BEFORE INSERT ON AuditEvent BEGIN SELECT RAISE(ABORT, 'simulated failure'); END",
      );
    await expect(
      service.undoPasswordReset('1', 'overlord', { ...undo!, confirmed: true }),
    ).rejects.toMatchObject({ status: 503 });
    expect(
      await fixture.db.fileVersion.findUniqueOrThrow({
        where: { id: 'latest' },
      }),
    ).toEqual(before);
    expect(await readFile(before.storagePath)).toEqual(bytes);
    expect(
      await fixture.db.passwordReset.count({ where: { state: 'ACTIVE' } }),
    ).toBe(1);
    if (failure !== 'missing')
      expect(
        (await service.getPasswordResetRecovery('1', 'overlord')).undo,
      ).toEqual(undo);
  },
);

it('only the current Overlord can inspect and confirm undo; transfer preserves the recovery opportunity', async () => {
  await seed();
  await service.resetPassword('1', 'overlord', await resetInput());
  const { undo } = await service.getPasswordResetRecovery('1', 'overlord');
  await expect(
    service.getPasswordResetRecovery('1', undefined),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    service.getPasswordResetRecovery('1', 'player'),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.undoPasswordReset('1', 'player', { ...undo!, confirmed: true }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.undoPasswordReset('1', 'overlord', { ...undo!, confirmed: false }),
  ).rejects.toMatchObject({ status: 400 });
  await fixture.db.game.update({
    where: { id: 'campaign' },
    data: { organizerId: 'player', turnRevision: { increment: 1 } },
  });
  const current = await service.getPasswordResetRecovery('1', 'player');
  expect(current.undo?.resetId).toBe(undo!.resetId);
  await service.undoPasswordReset('1', 'player', {
    ...current.undo!,
    confirmed: true,
  });
});

it.each(['stage', 'integrity', 'commit'])(
  'keeps canonical and existing recovery intact on %s failure without leaking a secret',
  async (failure) => {
    await seed();
    await service.resetPassword('1', 'overlord', await resetInput());
    const before = await fixture.db.game.findUniqueOrThrow({
      where: { id: 'campaign' },
      include: { fileVersions: true, turnState: true, turnRecords: true },
    });
    const input = await resetInput();
    const stage = storage.stageReplacement.bind(storage);
    if (failure === 'stage')
      vi.spyOn(storage, 'stageReplacement').mockRejectedValueOnce(
        new Error(input.password),
      );
    if (failure === 'integrity')
      vi.spyOn(storage, 'stageReplacement').mockImplementationOnce(
        async (request) => {
          const staged = await stage(request);
          await writeFile(staged.storagePath, 'corrupted');
          return staged;
        },
      );
    if (failure === 'commit')
      await fixture.db.$executeRawUnsafe(
        "CREATE TRIGGER reject_reset BEFORE INSERT ON AuditEvent BEGIN SELECT RAISE(ABORT, 'simulated commit failure'); END",
      );
    const error = await service
      .resetPassword('1', 'overlord', input)
      .catch((e: Error) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(JSON.stringify(error)).not.toContain(input.password);
    expect(
      await fixture.db.game.findUniqueOrThrow({
        where: { id: 'campaign' },
        include: { fileVersions: true, turnState: true, turnRecords: true },
      }),
    ).toEqual(before);
    expect(
      await fixture.db.passwordReset.count({ where: { state: 'ACTIVE' } }),
    ).toBe(1);
    expect(await fixture.db.saveCleanup.count()).toBe(0);
    expect(await readdir(join(directory, 'saves', 'campaign'))).toHaveLength(2);
  },
);

it('a second reset retains only its immediate source and normal upload closes it without enforcing passwords', async () => {
  await seed();
  await service.resetPassword('1', 'overlord', await resetInput());
  const first = await fixture.db.passwordReset.findFirstOrThrow();
  const immediate = await fixture.db.fileVersion.findUniqueOrThrow({
    where: { id: 'latest' },
  });
  const bytes = await readFile(immediate.storagePath);
  await service.resetPassword('1', 'overlord', {
    ...(await resetInput()),
    password: 'AnotherSecret',
  });
  const second = await fixture.db.passwordReset.findFirstOrThrow({
    where: { state: 'ACTIVE' },
  });
  expect(second.sourcePath).toBe(immediate.storagePath);
  expect(await readFile(second.sourcePath)).toEqual(bytes);
  expect(
    (
      await fixture.db.passwordReset.findUniqueOrThrow({
        where: { id: first.id },
      })
    ).state,
  ).toBe('CLEANED');
  const turns = new TurnMutationsService(fixture.db, new TurnRecordsService(), {
    fileStorage: storage,
  });
  const file = {
    buffer: Buffer.from('opaque later upload'),
    originalname: 'turn.se1',
    size: 19,
  };
  await expect(turns.uploadSave('1', 'overlord', file)).rejects.toMatchObject({
    status: 403,
  });
  expect(
    (
      await fixture.db.passwordReset.findUniqueOrThrow({
        where: { id: second.id },
      })
    ).state,
  ).toBe('ACTIVE');
  await turns.uploadSave('1', 'player', file);
  expect(
    (
      await fixture.db.passwordReset.findUniqueOrThrow({
        where: { id: second.id },
      })
    ).state,
  ).toBe('CLOSED');
  await service.cleanupRecovery();
  await expect(readFile(second.sourcePath)).rejects.toThrow();
});

it.each(['player', undefined])(
  'denies reset to a non-Overlord (%#)',
  async (actor) => {
    await seed();
    await expect(
      service.resetPassword('1', actor, await resetInput()),
    ).rejects.toMatchObject({ status: actor ? 403 : 401 });
    expect(await fixture.db.passwordReset.count()).toBe(0);
  },
);

it('supports a current regime and rejects ineligible, unconfirmed and stale inspection requests', async () => {
  await seed(
    syntheticArchive(
      syntheticPayload({ turn: 1 }),
      Buffer.from(archiveKey.toString('hex')),
    ),
  );
  const input = await resetInput();
  expect(input.regimes[0].current).toBe(true);
  await expect(
    service.resetPassword('1', 'overlord', { ...input, confirmed: false }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    service.resetPassword('1', 'overlord', {
      ...input,
      regimeId: input.regimes[1].id,
    }),
  ).rejects.toMatchObject({ status: 422 });
  await service.resetPassword('1', 'overlord', input);
  await expect(
    service.resetPassword('1', 'overlord', input),
  ).rejects.toMatchObject({ status: 409 });
});

it.each(['transfer', 'replace', 'bytes', 'reset', 'upload'])(
  'fences an overlapping %s before reset publication',
  async (change) => {
    const file = await seed();
    const input = await resetInput();
    const stage = storage.stageReplacement.bind(storage);
    vi.spyOn(storage, 'stageReplacement').mockImplementationOnce(
      async (request) => {
        const staged = await stage(request);
        if (change === 'transfer')
          await fixture.db.game.update({
            where: { id: 'campaign' },
            data: { organizerId: 'player', turnRevision: { increment: 1 } },
          });
        if (change === 'replace')
          await service.replaceSave('1', 'latest', 'player', {
            buffer: Buffer.from('newer bytes'),
            originalname: 'newer.se1',
            size: 11,
          });
        if (change === 'bytes')
          await writeFile(file.storagePath, syntheticArchive());
        if (change === 'reset')
          await service.resetPassword('1', 'overlord', input);
        if (change === 'upload')
          await new TurnMutationsService(fixture.db, new TurnRecordsService(), {
            fileStorage: storage,
          }).uploadSave('1', 'player', {
            buffer: Buffer.from('later'),
            originalname: 'turn.se1',
            size: 5,
          });
        return staged;
      },
    );
    await expect(
      service.resetPassword('1', 'overlord', input),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await fixture.db.passwordReset.count({ where: { state: 'ACTIVE' } }),
    ).toBe(change === 'reset' ? 1 : 0);
    expect(await fixture.db.saveCleanup.count()).toBe(0);
  },
);

it('rejects an in-flight normal upload when a reset publishes first', async () => {
  await seed();
  const stage = storage.stageUpload.bind(storage);
  vi.spyOn(storage, 'stageUpload').mockImplementationOnce(async (request) => {
    const staged = await stage(request);
    await service.resetPassword('1', 'overlord', await resetInput());
    return staged;
  });
  const turns = new TurnMutationsService(fixture.db, new TurnRecordsService(), {
    fileStorage: storage,
  });
  await expect(
    turns.uploadSave('1', 'player', {
      buffer: Buffer.from('later'),
      originalname: 'turn.se1',
      size: 5,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await fixture.db.fileVersion.count()).toBe(1);
  expect(
    (await service.getPasswordResetRecovery('1', 'overlord')).undo,
  ).not.toBeNull();
});

it('a byte-identical generic replacement still invalidates undo', async () => {
  await seed();
  await service.resetPassword('1', 'overlord', await resetInput());
  const { undo } = await service.getPasswordResetRecovery('1', 'overlord');
  const file = await fixture.db.fileVersion.findUniqueOrThrow({
    where: { id: 'latest' },
  });
  const bytes = await readFile(file.storagePath);
  await service.replaceSave('1', 'latest', 'player', {
    buffer: bytes,
    originalname: 'same.se1',
    size: bytes.length,
  });
  expect(await service.getPasswordResetRecovery('1', 'overlord')).toEqual({
    undo: null,
  });
  await expect(
    service.undoPasswordReset('1', 'overlord', { ...undo!, confirmed: true }),
  ).rejects.toMatchObject({ status: 409 });
});

it.each(['reset', 'undo', 'replace'] as const)(
  'rolls back %s when durable notification enqueue fails, preserving recovery and downloaded bytes',
  async (operation) => {
    await seed();
    await service.resetPassword('1', 'overlord', await resetInput());
    const input = await resetInput();
    const recovery = await service.getPasswordResetRecovery('1', 'overlord');
    const query = new GamesQueryService(storage);
    const before = await query.getGameDetail('1');
    const download = async () => {
      const result = await query.downloadSave('1', 'latest');
      const chunks: Buffer[] = [];
      for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    };
    const bytes = await download();
    const files = await readdir(join(directory, 'saves', 'campaign'));
    const notifications = await fixture.db.notificationDelivery.findMany();
    const audit = await fixture.db.auditEvent.findMany();
    await fixture.db.$executeRawUnsafe(
      "CREATE TRIGGER reject_notification BEFORE INSERT ON NotificationDelivery BEGIN SELECT RAISE(ABORT, 'enqueue unavailable'); END",
    );

    await expect(
      operation === 'reset'
        ? service.resetPassword('1', 'overlord', input)
        : operation === 'undo'
          ? service.undoPasswordReset('1', 'overlord', {
              ...recovery.undo!,
              confirmed: true,
            })
          : service.replaceSave('1', 'latest', 'player', {
              buffer: Buffer.from('replacement'),
              originalname: 'replacement.se1',
              size: 11,
            }),
    ).rejects.toThrow();

    expect(await query.getGameDetail('1')).toEqual(before);
    expect(await fixture.db.auditEvent.findMany()).toEqual(audit);
    expect(await download()).toEqual(bytes);
    expect(await service.getPasswordResetRecovery('1', 'overlord')).toEqual(
      recovery,
    );
    expect(await fixture.db.notificationDelivery.findMany()).toEqual(
      notifications,
    );
    expect(await readdir(join(directory, 'saves', 'campaign'))).toEqual(files);
  },
);

it('startup cleanup removes expired abandoned staging without touching canonical bytes', async () => {
  const file = await seed();
  const source = await readFile(file.storagePath);
  const abandoned = await storage.stageReplacement({
    gameId: 'campaign',
    canonicalName: file.originalName,
    content: Buffer.from('abandoned'),
    prepare: async (storagePath) => {
      await fixture.db.saveCleanup.create({
        data: { storagePath, dueAt: new Date(0) },
      });
    },
  });
  service.onModuleInit();
  try {
    await vi.waitFor(async () =>
      expect(await fixture.db.saveCleanup.count()).toBe(0),
    );
    await expect(readFile(abandoned.storagePath)).rejects.toThrow();
    expect(await readFile(file.storagePath)).toEqual(source);
  } finally {
    service.onModuleDestroy();
  }
});

it('closes recovery only after successful generic replacement and retries failed cleanup', async () => {
  await seed();
  await service.resetPassword('1', 'overlord', await resetInput());
  const recovery = await fixture.db.passwordReset.findFirstOrThrow();
  await expect(
    service.replaceSave('1', 'latest', 'overlord', {
      buffer: Buffer.from('newer'),
      originalname: 'newer.se1',
      size: 5,
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(
    (
      await fixture.db.passwordReset.findUniqueOrThrow({
        where: { id: recovery.id },
      })
    ).state,
  ).toBe('ACTIVE');
  const remove = vi
    .spyOn(storage, 'removeFileOrThrow')
    .mockRejectedValue(new Error('disk busy'));
  await service.replaceSave('1', 'latest', 'player', {
    buffer: Buffer.from('newer'),
    originalname: 'newer.se1',
    size: 5,
  });
  expect(
    (
      await fixture.db.passwordReset.findUniqueOrThrow({
        where: { id: recovery.id },
      })
    ).state,
  ).toBe('CLOSED');
  expect(
    await fixture.db.saveCleanup.findUnique({
      where: { storagePath: recovery.sourcePath },
    }),
  ).not.toBeNull();
  remove.mockRestore();
  await service.cleanupRecovery();
  expect(
    (
      await fixture.db.passwordReset.findUniqueOrThrow({
        where: { id: recovery.id },
      })
    ).state,
  ).toBe('CLEANED');
  await expect(storage.openDownload(recovery.sourcePath)).rejects.toThrow();
});
afterEach(async () => {
  for (const method of ['log', 'warn', 'error'] as const) {
    const logged = JSON.stringify(
      vi.mocked(Logger.prototype[method]).mock.calls,
    );
    expect(logged).not.toContain('NewSecret');
    expect(logged).not.toContain('SecondSecret');
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fixture?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function seed(
  content = syntheticArchive(
    undefined,
    Buffer.from(archiveKey.toString('hex')),
  ),
) {
  const stored = await storage.stageUpload({
    gameId: 'campaign',
    gameNumber: 1,
    turn: 3,
    seat: 1,
    playerName: 'Player',
    originalName: 'synthetic.se1',
    content,
  });
  return fixture.db.fileVersion.create({
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
it('inspects actual latest storage bytes for the Overlord without mutating the save or campaign', async () => {
  const file = await seed();
  const before = await fixture.db.game.findUnique({
    where: { id: 'campaign' },
    include: { fileVersions: true, turnState: true, turnRecords: true },
  });
  const result = await service.inspectLatestSave('1', 'overlord');
  expect(result).toMatchObject({
    fileVersionId: 'latest',
    contentRevision: 0,
    sourceId: expect.stringMatching(/^sha256:/),
    regimes: [
      { name: 'North Reach', eligible: true, current: false },
      { name: 'South Reach', eligible: false, current: true },
    ],
  });
  expect(
    await fixture.db.game.findUnique({
      where: { id: 'campaign' },
      include: { fileVersions: true, turnState: true, turnRecords: true },
    }),
  ).toEqual(before);
  expect(await fixture.db.auditEvent.count()).toBe(0);
  const download = await new GamesQueryService(storage).downloadSave(
    '1',
    file.id,
  );
  const chunks: Buffer[] = [];
  for await (const chunk of download.stream) chunks.push(Buffer.from(chunk));
  const { createHash } = await import('node:crypto');
  expect(result.sourceId).toBe(
    `sha256:${createHash('sha256').update(Buffer.concat(chunks)).digest('hex')}`,
  );
});
it('requires the current Overlord, not the uploader, and reports no-save distinctly', async () => {
  await expect(service.inspectLatestSave('1', undefined)).rejects.toMatchObject(
    { status: 401 },
  );
  await expect(service.inspectLatestSave('1', 'player')).rejects.toMatchObject({
    status: 403,
  });
  await expect(service.inspectLatestSave('1', 'overlord')).rejects.toThrow(
    'This campaign has no save to inspect.',
  );
  await seed();
  await fixture.db.game.update({
    where: { id: 'campaign' },
    data: { organizerId: 'player' },
  });
  await expect(
    service.inspectLatestSave('1', 'overlord'),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.inspectLatestSave('1', 'player'),
  ).resolves.toHaveProperty('regimes');
});
it('returns password-free format and storage failures', async () => {
  const file = await seed(Buffer.from('invalid'));
  await expect(service.inspectLatestSave('1', 'overlord')).rejects.toThrow(
    'Unsupported save format.',
  );
  await storage.removeFileOrThrow(file.storagePath);
  await expect(service.inspectLatestSave('1', 'overlord')).rejects.toThrow(
    'The latest save is unavailable. Refresh and try again.',
  );
});

it.each(['transfer', 'replacement', 'revision'])(
  'rejects a %s while the storage read is in flight',
  async (change) => {
    await seed();
    const open = storage.openDownload.bind(storage);
    vi.spyOn(storage, 'openDownload').mockImplementationOnce(async (path) => {
      const download = await open(path);
      if (change === 'transfer') {
        await fixture.db.game.update({
          where: { id: 'campaign' },
          data: { organizerId: 'player' },
        });
      } else if (change === 'revision') {
        await fixture.db.fileVersion.update({
          where: { id: 'latest' },
          data: { contentRevision: { increment: 1 } },
        });
      } else {
        const staged = await storage.stageReplacement({
          gameId: 'campaign',
          canonicalName: 'synthetic.se1',
          content: syntheticArchive(),
        });
        await fixture.db.fileVersion.update({
          where: { id: 'latest' },
          data: { storagePath: staged.storagePath },
        });
      }
      return download;
    });
    await expect(
      service.inspectLatestSave('1', 'overlord'),
    ).rejects.toMatchObject({ status: change === 'transfer' ? 403 : 409 });
  },
);

it('reports missing archive configuration without accepting an unconfigured key', async () => {
  await seed();
  vi.stubEnv('SHADOW_CLOUD_SAVE_ARCHIVE_KEY', '');
  await expect(service.inspectLatestSave('1', 'overlord')).rejects.toThrow(
    'Save inspection is not configured on this server.',
  );
});
