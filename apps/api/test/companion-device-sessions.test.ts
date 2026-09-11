import 'reflect-metadata';
import { Module, UnauthorizedException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SignJWT } from 'jose';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { InternalAuthGuard } from '../src/auth/internal-auth.guard';
import { CompanionAuthController } from '../src/auth/companion-auth.controller';
import { DeviceSessionsService } from '../src/auth/device-sessions.service';
import { createSqliteFixture } from './support/sqlite-fixture';

const authSecret = 'companion-contract-secret';
let app: INestApplication | undefined;
let closeDatabase: (() => Promise<void>) | undefined;

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = authSecret;
  delete process.env.AUTH_SECRET;
});

afterEach(async () => {
  await app?.close();
  await closeDatabase?.();
  app = undefined;
  closeDatabase = undefined;
});

it('exchanges either one-use handoff proof for a rotating scoped Device session', async () => {
  const fixture = await createSqliteFixture();
  closeDatabase = fixture.close;
  await fixture.db.user.create({
    data: {
      id: 'user-1',
      email: 'solon@example.com',
      displayName: 'Solon',
    },
  });
  const sessions = new DeviceSessionsService(fixture.db);

  class CompanionAuthTestModule {}
  Module({
    controllers: [CompanionAuthController],
    providers: [
      InternalAuthGuard,
      { provide: DeviceSessionsService, useValue: sessions },
    ],
  })(CompanionAuthTestModule);

  app = await NestFactory.create(CompanionAuthTestModule, { logger: false });
  app.setGlobalPrefix('v1');
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();

  const created = await fetch(`${baseUrl}/v1/auth/companion-handoffs`, {
    method: 'POST',
  });
  expect(created.status).toBe(201);
  const handoff = (await created.json()) as {
    handoffId: string;
    pollSecret: string;
    expiresAt: string;
  };
  expect(Date.parse(handoff.expiresAt) - Date.now()).toBeGreaterThan(
    9 * 60_000,
  );

  const internalToken = await new SignJWT({ purpose: 'discord-identity-sync' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('60s')
    .setIssuer('shadow-cloud-web')
    .setAudience('shadow-cloud-internal')
    .setSubject('discord-identity-sync')
    .sign(new TextEncoder().encode(authSecret));
  const approved = await fetch(
    `${baseUrl}/v1/auth/companion-handoffs/${handoff.handoffId}/approve`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${internalToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userId: 'user-1' }),
    },
  );
  expect(approved.status).toBe(201);
  const { pasteToken } = (await approved.json()) as { pasteToken: string };
  expect(pasteToken).not.toContain(handoff.pollSecret);

  const exchanged = await fetch(`${baseUrl}/v1/auth/device-sessions/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      handoffId: handoff.handoffId,
      pollSecret: handoff.pollSecret,
    }),
  });
  expect(exchanged.status).toBe(201);
  const credentials = (await exchanged.json()) as {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresAt: string;
    deviceSession: {
      id: string;
      scopes: string[];
      user: { id: string; displayName: string };
    };
  };
  expect(credentials.deviceSession).toMatchObject({
    scopes: ['campaigns:observe', 'saves:download', 'turns:submit'],
    user: { id: 'user-1', displayName: 'Solon' },
  });
  expect(credentials.refreshToken).not.toContain(handoff.pollSecret);
  expect(
    Date.parse(credentials.accessTokenExpiresAt) - Date.now(),
  ).toBeLessThanOrEqual(15 * 60_000);

  const replay = await fetch(`${baseUrl}/v1/auth/device-sessions/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handoffToken: pasteToken }),
  });
  expect(replay.status).toBe(401);

  const refreshed = await fetch(`${baseUrl}/v1/auth/device-sessions/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: credentials.refreshToken }),
  });
  expect(refreshed.status).toBe(201);
  const rotated = (await refreshed.json()) as {
    accessToken: string;
    refreshToken: string;
  };
  expect(rotated.refreshToken).not.toBe(credentials.refreshToken);

  const staleRefresh = await fetch(
    `${baseUrl}/v1/auth/device-sessions/refresh`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: credentials.refreshToken }),
    },
  );
  expect(staleRefresh.status).toBe(401);

  const revoked = await fetch(`${baseUrl}/v1/auth/device-sessions/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: rotated.refreshToken }),
  });
  expect(revoked.status).toBe(201);
  await expect(
    sessions.verifyAccessToken(rotated.accessToken),
  ).rejects.toBeInstanceOf(Error);

  const storedHandoff = await fixture.db.companionHandoff.findUniqueOrThrow({
    where: { id: handoff.handoffId },
  });
  const storedSession = await fixture.db.deviceSession.findFirstOrThrow();
  expect(JSON.stringify({ storedHandoff, storedSession })).not.toContain(
    handoff.pollSecret,
  );
  expect(JSON.stringify({ storedHandoff, storedSession })).not.toContain(
    credentials.refreshToken,
  );

  for (const endpoint of [
    'device-sessions/exchange',
    'device-sessions/refresh',
    'device-sessions/revoke',
  ]) {
    const malformed = await fetch(`${baseUrl}/v1/auth/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'null',
    });
    expect(malformed.status, endpoint).toBeGreaterThanOrEqual(400);
    expect(malformed.status, endpoint).toBeLessThan(500);
  }
});

it('accepts the self-contained paste token once and never before approval', async () => {
  const fixture = await createSqliteFixture();
  closeDatabase = fixture.close;
  await fixture.db.user.create({
    data: {
      id: 'user-1',
      email: 'solon@example.com',
      displayName: 'Solon',
    },
  });
  const sessions = new DeviceSessionsService(fixture.db);
  const handoff = await sessions.createHandoff();

  await expect(
    sessions.exchangeHandoff({
      handoffId: handoff.handoffId,
      pollSecret: handoff.pollSecret,
    }),
  ).resolves.toMatchObject({ status: 'pending' });

  const approved = await sessions.approveHandoff(handoff.handoffId, 'user-1');
  expect(approved.pasteToken.split('.')).toHaveLength(2);
  expect(approved.pasteToken.length).toBeGreaterThan(80);
  await expect(
    sessions.exchangeHandoff({ handoffToken: approved.pasteToken }),
  ).resolves.toMatchObject({
    status: 'approved',
    deviceSession: { user: { id: 'user-1' } },
  });
  await expect(
    sessions.exchangeHandoff({
      handoffId: handoff.handoffId,
      pollSecret: handoff.pollSecret,
    }),
  ).rejects.toBeInstanceOf(UnauthorizedException);
});
