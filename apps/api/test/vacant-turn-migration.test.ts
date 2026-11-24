import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  applySqliteMigrations,
  migrationsDirectory,
} from './support/sqlite-migrations';

const migrationName = '20261124120000_allow_vacant_turn';

describe('vacant turn migration', () => {
  it('keeps every campaign active player and allows a vacant turn afterwards', async () => {
    const database = new Database(':memory:');

    try {
      await applySqliteMigrations(database, migrationName);
      database.pragma('foreign_keys = ON');
      database.exec(`
        INSERT INTO "User" ("id", "email", "displayName", "createdAt", "updatedAt") VALUES
          ('overlord', 'overlord@example.com', 'Overlord', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
          ('player', 'player@example.com', 'Player', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
        INSERT INTO "Game" ("id", "gameNumber", "name", "slug", "organizerId", "updatedAt") VALUES
          ('first', 1, 'First', 'first', 'overlord', '2026-09-01T00:00:00.000Z'),
          ('second', 2, 'Second', 'second', 'overlord', '2026-09-01T00:00:00.000Z');
        INSERT INTO "GamePlayer" ("id", "gameId", "userId", "turnOrder", "role") VALUES
          ('first-overlord', 'first', 'overlord', 1, 'ORGANIZER'),
          ('first-player', 'first', 'player', 2, 'PLAYER'),
          ('second-overlord', 'second', 'overlord', 1, 'ORGANIZER');
        INSERT INTO "TurnState" ("id", "gameId", "activePlayerId", "activePlayerEntryId", "roundNumber", "updatedAt") VALUES
          ('first-turn', 'first', 'player', 'first-player', 7, '2026-09-02T01:02:03.456Z'),
          ('second-turn', 'second', 'overlord', NULL, 2, '2026-09-03T01:02:03.456Z');
      `);
      const before = database
        .prepare('SELECT * FROM "TurnState" ORDER BY "id"')
        .all();

      database.exec(
        await readFile(
          join(migrationsDirectory, migrationName, 'migration.sql'),
          'utf8',
        ),
      );

      expect(
        database.prepare('SELECT * FROM "TurnState" ORDER BY "id"').all(),
      ).toEqual(before);
      expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(database.pragma('foreign_key_check')).toEqual([]);
      database
        .prepare(
          'UPDATE "TurnState" SET "activePlayerId" = NULL WHERE "id" = ?',
        )
        .run('first-turn');
      expect(
        database
          .prepare(
            'SELECT "activePlayerId", "activePlayerEntryId" FROM "TurnState" WHERE "id" = ?',
          )
          .get('first-turn'),
      ).toEqual({ activePlayerId: null, activePlayerEntryId: 'first-player' });
    } finally {
      database.close();
    }
  });
});
