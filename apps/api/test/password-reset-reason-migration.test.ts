import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  applySqliteMigrations,
  migrationsDirectory,
} from './support/sqlite-migrations';

const migrationName = '20261124130000_password_reset_reason';

describe('password reset reason migration', () => {
  it('keeps existing password resets and leaves their reasons empty', async () => {
    const database = new Database(':memory:');

    try {
      await applySqliteMigrations(database, migrationName);
      database.exec(`
        INSERT INTO "PasswordReset" ("id", "gameId", "fileVersionId", "sourcePath", "sourceId", "outputId", "outputRevision", "saveRevision", "actorId", "regimeId", "regimeName", "state") VALUES
          ('reset', 'campaign', 'latest', 'saves/source.se1', 'sha256:source', 'sha256:output', 1, 1, 'overlord', 'regime', 'North Reach', 'CLOSED');
      `);
      const before = database
        .prepare('SELECT * FROM "PasswordReset"')
        .get() as Record<string, unknown>;

      database.exec(
        await readFile(
          join(migrationsDirectory, migrationName, 'migration.sql'),
          'utf8',
        ),
      );

      expect(database.prepare('SELECT * FROM "PasswordReset"').get()).toEqual({
        ...before,
        reason: null,
        undoReason: null,
        undoRevision: null,
      });
    } finally {
      database.close();
    }
  });
});
