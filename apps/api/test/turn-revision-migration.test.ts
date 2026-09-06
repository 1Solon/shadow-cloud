import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  applySqliteMigrations,
  migrationsDirectory,
} from './support/sqlite-migrations';

const migrationName = '20260906170000_add_turn_revision';

describe('turn revision migration', () => {
  it('initializes revision zero without changing initialized or uninitialized campaign data', async () => {
    const database = new Database(':memory:');

    try {
      await applySqliteMigrations(database, migrationName);

      expect(() =>
        database.prepare('SELECT "turnRevision" FROM "Game"').all(),
      ).toThrow('no such column');
      database.pragma('foreign_keys = ON');

      database.exec(`
        INSERT INTO "User" ("id", "email", "displayName", "createdAt", "updatedAt") VALUES
          ('overlord', 'overlord@example.com', 'Campaign Overlord', '2026-08-01T01:02:03.456Z', '2026-08-02T02:03:04.567Z'),
          ('player', 'player@example.com', 'Current Player', '2026-08-03T03:04:05.678Z', '2026-08-04T04:05:06.789Z');

        INSERT INTO "Game" (
          "id", "gameNumber", "name", "slug", "organizerId", "playerCount", "hasAiPlayers",
          "dlcMode", "gameMode", "techLevel", "zoneCount", "armyCount", "notes",
          "discordGuildId", "discordChannelId", "discordThreadId", "retentionLimit",
          "turnTargetHours", "turnReminderGraceHours", "turnReminderRepeatHours", "turnRemindersEnabled",
          "createdAt", "updatedAt"
        ) VALUES
          ('initialized', 17, 'Initialized Campaign', 'initialized-campaign', 'overlord', 4, 1,
           'BOTH', 'FFA_AI', 4, 'TWO_ZONE_START', 'ONE_PER_ZONE', 'Keep campaign notes',
           'guild', 'channel', 'initialized-thread', 9, 48, 6, 18, 1,
           '2026-08-05T05:06:07.890Z', '2026-09-05T06:07:08.901Z'),
          ('uninitialized', 29, 'Uninitialized Campaign', 'uninitialized-campaign', 'player', NULL, NULL,
           NULL, NULL, NULL, NULL, NULL, 'Waiting for initialization',
           'guild', 'channel', 'uninitialized-thread', 3, 72, 8, 36, 0,
           '2026-08-06T06:07:08.901Z', '2026-09-04T07:08:09.012Z');

        INSERT INTO "GamePlayer" ("id", "gameId", "userId", "turnOrder", "role", "createdAt") VALUES
          ('seat-overlord', 'initialized', 'overlord', 1, 'ORGANIZER', '2026-08-07T00:00:00.001Z'),
          ('seat-player-first', 'initialized', 'player', 2, 'PLAYER', '2026-08-07T00:00:00.002Z'),
          ('seat-open', 'initialized', NULL, 3, 'PLAYER', '2026-08-07T00:00:00.003Z'),
          ('seat-player-active', 'initialized', 'player', 4, 'PLAYER', '2026-08-07T00:00:00.004Z'),
          ('waiting-overlord', 'uninitialized', 'player', 1, 'ORGANIZER', '2026-08-08T00:00:00.001Z'),
          ('waiting-player', 'uninitialized', 'overlord', 2, 'PLAYER', '2026-08-08T00:00:00.002Z'),
          ('waiting-open', 'uninitialized', NULL, 3, 'PLAYER', '2026-08-08T00:00:00.003Z');

        INSERT INTO "TurnState" (
          "id", "gameId", "activePlayerId", "activePlayerEntryId", "roundNumber", "updatedAt"
        ) VALUES (
          'turn-state', 'initialized', 'player', 'seat-player-active', 7, '2026-09-01T01:02:03.456Z'
        );

        INSERT INTO "TurnRecord" (
          "id", "gameId", "roundNumber", "gamePlayerId", "userId", "seatNumber", "playerDisplayName",
          "startedAt", "endedAt", "completionReason", "reminderCount", "lastReminderAt", "nextReminderAt",
          "createdAt", "updatedAt"
        ) VALUES
          ('turn-completed', 'initialized', 6, 'seat-player-first', 'player', 2, 'Historical Player Name',
           '2026-08-28T01:02:03.456Z', '2026-08-30T02:03:04.567Z', 'SAVE_UPLOADED', 1,
           '2026-08-29T03:04:05.678Z', NULL, '2026-08-28T04:05:06.789Z', '2026-08-30T05:06:07.890Z'),
          ('turn-resigned', 'initialized', 6, NULL, NULL, 3, 'Former Player',
           '2026-08-30T06:07:08.901Z', '2026-08-31T07:08:09.012Z', 'RESIGNED', 0,
           NULL, NULL, '2026-08-30T08:09:10.123Z', '2026-08-31T09:10:11.234Z'),
          ('turn-open', 'initialized', 7, 'seat-player-active', 'player', 4, 'Current Player',
           '2026-09-01T01:02:03.456Z', NULL, NULL, 3,
           '2026-09-04T10:11:12.345Z', '2026-09-05T04:11:12.345Z',
           '2026-09-01T02:03:04.567Z', '2026-09-04T11:12:13.456Z');

        INSERT INTO "FileVersion" (
          "id", "gameId", "uploadedById", "storagePath", "originalName", "versionNumber",
          "contentHash", "idempotencyKey", "clientOriginalName", "clientFileSize", "uploadedAt",
          "replacedAt", "replacedById"
        ) VALUES
          ('save-previous', 'initialized', 'player', 'campaigns/initialized/6.se1', '6.se1', 6,
           'previous-hash', 'previous-upload', 'old-turn.se1', 1234, '2026-08-30T02:03:04.567Z', NULL, NULL),
          ('save-replaced', 'initialized', 'overlord', 'campaigns/initialized/7.se1', '7.se1', 7,
           'replacement-hash', 'replacement-upload', 'replacement.se1', 5678, '2026-09-01T01:02:03.456Z',
           '2026-09-02T03:04:05.678Z', 'player');

        INSERT INTO "NotificationDelivery" (
          "id", "event", "status", "gameId", "gameSlug", "turnRecordId", "payload", "attempts",
          "nextAttemptAt", "processingStartedAt", "deliveredAt", "lastError", "createdAt", "updatedAt"
        ) VALUES
          ('reminder-pending', 'TURN_NUDGE', 'PENDING', 'initialized', 'initialized-campaign', 'turn-open',
           '{"reminder":"pending","count":3}', 2, '2026-09-05T04:11:12.345Z',
           '2026-09-04T10:12:13.456Z', NULL, 'Retry after rate limit',
           '2026-09-04T10:11:12.345Z', '2026-09-04T10:13:14.567Z'),
          ('reminder-delivered', 'TURN_NUDGE', 'DELIVERED', 'initialized', 'initialized-campaign', 'turn-completed',
           '{"reminder":"historical"}', 1, '2026-08-29T03:04:05.678Z',
           '2026-08-29T03:05:06.789Z', '2026-08-29T03:06:07.890Z', NULL,
           '2026-08-29T03:03:04.567Z', '2026-08-29T03:07:08.901Z'),
          ('waiting-delivery', 'THREAD_RENAMED', 'FAILED', 'uninitialized', 'uninitialized-campaign', NULL,
           '{"name":"Uninitialized Campaign"}', 5, '2026-09-04T07:08:09.012Z',
           '2026-09-04T07:09:10.123Z', NULL, 'Thread unavailable',
           '2026-09-04T07:07:08.901Z', '2026-09-04T07:10:11.234Z');

        INSERT INTO "AuditEvent" ("id", "gameId", "actorId", "eventType", "payload", "createdAt") VALUES
          ('audit-roster', 'initialized', 'overlord', 'ROSTER_UPDATED', '{"seats":[1,2,3,4]}', '2026-08-07T01:02:03.456Z'),
          ('audit-turn', 'initialized', 'player', 'TURN_ADVANCED', '{"roundNumber":7,"seatNumber":4}', '2026-09-01T01:02:03.456Z'),
          ('audit-waiting', 'uninitialized', 'player', 'GAME_CREATED', '{"gameNumber":29}', '2026-08-06T06:07:08.901Z');

        INSERT INTO "RegistrationRequest" (
          "id", "gameId", "playerDiscordId", "playerDisplayName", "playerUsername", "status",
          "discordMessageId", "requestedAt", "respondedAt"
        ) VALUES
          ('registration-approved', 'initialized', 'discord-player', 'Original Player Name', 'player', 'APPROVED',
           'approved-message', '2026-08-06T01:02:03.456Z', '2026-08-07T01:02:03.456Z'),
          ('registration-pending', 'uninitialized', 'discord-new-player', 'New Player', 'new-player', 'PENDING',
           'pending-message', '2026-08-09T01:02:03.456Z', NULL);
      `);

      // Compare every column, including timestamps and nullable historical links.
      const tables = [
        'Game',
        'User',
        'GamePlayer',
        'TurnState',
        'TurnRecord',
        'FileVersion',
        'NotificationDelivery',
        'AuditEvent',
        'RegistrationRequest',
      ];
      const before = tables.map((table) => ({
        table,
        rows: database
          .prepare(`SELECT * FROM "${table}" ORDER BY "id"`)
          .all() as Record<string, unknown>[],
      }));
      expect(database.pragma('foreign_key_check')).toEqual([]);

      database.exec(
        await readFile(
          join(migrationsDirectory, migrationName, 'migration.sql'),
          'utf8',
        ),
      );

      for (const { table, rows } of before) {
        expect(
          database.prepare(`SELECT * FROM "${table}" ORDER BY "id"`).all(),
          `${table} data after migration`,
        ).toEqual(
          table === 'Game'
            ? rows.map((row) => ({ ...row, turnRevision: 0 }))
            : rows,
        );
      }

      expect(database.pragma('table_info("Game")')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'turnRevision',
            type: 'INTEGER',
            notnull: 1,
            dflt_value: '0',
          }),
        ]),
      );
      expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(database.pragma('foreign_key_check')).toEqual([]);
      expect(database.pragma('integrity_check')).toEqual([
        { integrity_check: 'ok' },
      ]);

      database.exec(`
        INSERT INTO "Game" ("id", "gameNumber", "name", "slug", "organizerId", "updatedAt")
        VALUES ('new-campaign', 31, 'New Campaign', 'new-campaign', 'overlord', '2026-09-06T17:00:00.000Z');
      `);
      expect(
        database
          .prepare('SELECT "turnRevision" FROM "Game" WHERE "id" = ?')
          .get('new-campaign'),
      ).toEqual({ turnRevision: 0 });
      expect(() =>
        database
          .prepare('UPDATE "Game" SET "turnRevision" = NULL WHERE "id" = ?')
          .run('initialized'),
      ).toThrow('NOT NULL constraint failed: Game.turnRevision');
    } finally {
      database.close();
    }
  });
});
