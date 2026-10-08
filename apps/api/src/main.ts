import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { resolveCorsOptions } from './api-cors';
import { resolveApiPort } from './api-port';
import { AppModule } from './app.module';
import { resolveSaveRetentionLimit } from './games/support/save-retention';

async function bootstrap() {
  // Refuse to start rather than prune saves under a misconfigured limit.
  resolveSaveRetentionLimit(process.env);
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  app.enableCors(resolveCorsOptions(process.env));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(resolveApiPort(process.env));
}
void bootstrap();
