import { isAbsolute, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

declare global {
  var __shadowCloudPrisma__: PrismaClient | undefined;
}

function resolveSqliteDatabasePath(databaseUrl: string) {
  if (databaseUrl === ':memory:') {
    return databaseUrl;
  }

  const normalizedPath = databaseUrl.startsWith('file:')
    ? databaseUrl.slice('file:'.length)
    : databaseUrl;

  if (normalizedPath === ':memory:' || isAbsolute(normalizedPath)) {
    return normalizedPath;
  }

  return resolve(__dirname, '../prisma', normalizedPath);
}

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set before creating PrismaClient.');
  }

  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url: resolveSqliteDatabasePath(databaseUrl),
    }),
  });
}

export const prisma = globalThis.__shadowCloudPrisma__ ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__shadowCloudPrisma__ = prisma;
}

export * from '@prisma/client';
