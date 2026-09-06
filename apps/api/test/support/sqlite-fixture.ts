import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { applySqliteMigrations } from './sqlite-migrations';

export async function createSqliteFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'shadow-cloud-turns-'));
  const path = join(directory, 'test.db');
  const clients: PrismaClient[] = [];

  const close = async () => {
    try {
      await Promise.all(clients.map((client) => client.$disconnect()));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };

  try {
    const database = new Database(path);
    try {
      await applySqliteMigrations(database);
    } finally {
      database.close();
    }

    const connect = () => {
      const client = new PrismaClient({
        adapter: new PrismaBetterSqlite3({ url: path, timeout: 100 }),
      });
      clients.push(client);
      return client;
    };

    return { db: connect(), connect, close };
  } catch (error) {
    await close();
    throw error;
  }
}
