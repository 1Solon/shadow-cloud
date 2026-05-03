import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { resolveCorsOrigins } from './api-cors';
import { resolveApiPort } from './api-port';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  app.enableCors({
    allowedHeaders: ['authorization', 'content-type'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    origin: resolveCorsOrigins(process.env),
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(resolveApiPort(process.env));
}
void bootstrap();
