import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CompanionController } from '../src/companion/companion.controller';
import { CompanionService } from '../src/companion/companion.service';
import { CompanionAuthGuard } from '../src/auth/companion-auth.guard';
import { DeviceSessionsService } from '../src/auth/device-sessions.service';
import { CompanionProtocolController } from '../src/companion/protocol.controller';
import { FileStorageService } from '../src/games/file-storage.service';
import { TurnMutationsService } from '../src/games/services/turn-mutations.service';
import { TurnRecordsService } from '../src/games/services/turn-records.service';
import { createSqliteFixture } from './support/sqlite-fixture';

let app: INestApplication;
let fixture: Awaited<ReturnType<typeof createSqliteFixture>>;
let directory: string;
let base: string;
let headers: Record<string, string>;
let mutations: TurnMutationsService;
let sessions: DeviceSessionsService;
let refreshToken: string;

beforeEach(async () => {
  process.env.NEXTAUTH_SECRET = 'companion-receive-test';
  delete process.env.AUTH_SECRET;
  fixture = await createSqliteFixture();
  directory = await mkdtemp(join(tmpdir(), 'companion-receive-'));
  const previous = process.env.SHADOW_CLOUD_SAVE_DIR;
  process.env.SHADOW_CLOUD_SAVE_DIR = directory;
  const storage = new FileStorageService();
  if (previous === undefined) delete process.env.SHADOW_CLOUD_SAVE_DIR;
  else process.env.SHADOW_CLOUD_SAVE_DIR = previous;
  for (const id of ['player', 'other', 'outsider']) {
    await fixture.db.user.create({
      data: { id, email: `${id}@example.test`, displayName: id },
    });
  }
  await fixture.db.game.create({
    data: {
      id: 'campaign',
      gameNumber: 42,
      name: 'Campaign',
      slug: 'campaign',
      organizerId: 'player',
      retentionLimit: 1,
      players: {
        create: [
          { id: 'seat', userId: 'player', turnOrder: 1 },
          { id: 'other-seat', userId: 'other', turnOrder: 2 },
        ],
      },
      turnState: {
        create: { activePlayerId: 'player', activePlayerEntryId: 'seat' },
      },
      turnRecords: {
        create: {
          gamePlayerId: 'seat',
          userId: 'player',
          seatNumber: 1,
          playerDisplayName: 'player',
          roundNumber: 1,
          startedAt: new Date(),
        },
      },
    },
  });
  sessions = new DeviceSessionsService(fixture.db);
  const handoff = await sessions.createHandoff();
  const approval = await sessions.approveHandoff(handoff.handoffId, 'player');
  const credentials = await sessions.exchangeHandoff({
    handoffToken: approval.pasteToken,
  });
  if (credentials.status !== 'approved')
    throw new Error('Expected approved session');
  refreshToken = credentials.refreshToken;
  headers = {
    authorization: `Bearer ${credentials.accessToken}`,
    'x-companion-protocol': new CompanionProtocolController().protocol()
      .protocolVersion,
  };
  mutations = new TurnMutationsService(fixture.db, new TurnRecordsService(), {
    fileStorage: storage,
  });
  class TestModule {}
  Module({
    controllers: [CompanionController],
    providers: [
      CompanionAuthGuard,
      { provide: DeviceSessionsService, useValue: sessions },
      {
        provide: CompanionService,
        useValue: new CompanionService(fixture.db, storage),
      },
    ],
  })(TestModule);
  app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('v1');
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/v1/companion`;
});
afterEach(async () => {
  await app?.close();
  await fixture?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function upload(user: string, content: string) {
  const buffer = Buffer.from(content);
  return mutations.uploadSave('campaign', user, {
    originalname: 'turn.se1',
    buffer,
    size: buffer.length,
  });
}

it('observes the current save and catches every later publication across players beyond the website retention window', async () => {
  await upload('player', 'first');
  const activation = await fetch(`${base}/campaigns`, { headers });
  expect(activation.status).toBe(200);
  const { campaigns } = await activation.json();
  expect(campaigns).toHaveLength(1);
  expect(campaigns[0]).toMatchObject({
    id: 'campaign',
    number: 42,
    current: { publication: 1, size: 5 },
  });
  await upload('other', 'second');
  await upload('player', 'third');
  const response = await fetch(
    `${base}/campaigns/campaign/publications?after=1`,
    { headers },
  );
  expect(response.status).toBe(200);
  const page = await response.json();
  expect(
    page.publications.map((save: { publication: number }) => save.publication),
  ).toEqual([2, 3]);
  expect(page.current.publication).toBe(3);
  const save = page.publications[0];
  const downloaded = await fetch(
    `${base}/campaigns/campaign/saves/${save.fileVersionId}?revision=${save.contentRevision}&hash=${encodeURIComponent(save.contentHash)}`,
    { headers },
  );
  expect(downloaded.status).toBe(200);
  expect(await downloaded.text()).toBe('second');
});

it('binds downloads to replacement revision and content while enforcing protocol, membership and revocation', async () => {
  await upload('player', 'first');
  const activation = await (
    await fetch(`${base}/campaigns`, { headers })
  ).json();
  const save = activation.campaigns[0].current;
  const url = `${base}/campaigns/campaign/saves/${save.fileVersionId}?revision=${save.contentRevision}&hash=${encodeURIComponent(save.contentHash)}`;
  const changed = await fixture.db.fileVersion.update({
    where: { id: save.fileVersionId },
    data: { contentRevision: { increment: 1 } },
  });
  expect((await fetch(url, { headers })).status).toBe(409);
  const page = await (
    await fetch(`${base}/campaigns/campaign/publications?after=0`, { headers })
  ).json();
  expect(page.publications).toHaveLength(1);
  expect(page.current).toMatchObject({
    publication: 1,
    contentRevision: changed.contentRevision,
  });
  expect(
    (
      await fetch(`${base}/campaigns`, {
        headers: { authorization: headers.authorization },
      })
    ).status,
  ).toBe(426);
  expect(
    (
      await fetch(`${base}/campaigns`, {
        headers: { ...headers, 'x-companion-protocol': 'old' },
      })
    ).status,
  ).toBe(426);
  expect(
    (
      await fetch(`${base}/campaigns/campaign/publications?after=-1`, {
        headers,
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await fetch(`${base}/campaigns/campaign/publications?after=100`, {
        headers,
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await fetch(`${base}/campaigns/unrelated/publications?after=0`, {
        headers,
      })
    ).status,
  ).toBe(403);
  await fixture.db.game.update({
    where: { id: 'campaign' },
    data: { organizerId: 'other' },
  });
  await fixture.db.gamePlayer.update({
    where: { id: 'seat' },
    data: { userId: 'outsider' },
  });
  expect(await (await fetch(`${base}/campaigns`, { headers })).json()).toEqual({
    campaigns: [],
  });
  expect((await fetch(url, { headers })).status).toBe(403);
  await sessions.revoke(refreshToken);
  expect((await fetch(`${base}/campaigns`, { headers })).status).toBe(401);
});
