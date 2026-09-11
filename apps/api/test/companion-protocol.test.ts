import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import rootPackage from '../../../package.json';
import { CompanionProtocolController } from '../src/companion/protocol.controller';

class ProtocolTestModule {}
Module({ controllers: [CompanionProtocolController] })(ProtocolTestModule);

let app: INestApplication | undefined;
afterEach(async () => app?.close());

it('advertises the repository release as the exact Companion protocol over HTTP', async () => {
  app = await NestFactory.create(ProtocolTestModule, { logger: false });
  app.setGlobalPrefix('v1');
  await app.listen(0, '127.0.0.1');
  const response = await fetch(`${await app.getUrl()}/v1/companion/protocol`);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(await response.json()).toEqual({
    protocolVersion: rootPackage.version,
  });
});
