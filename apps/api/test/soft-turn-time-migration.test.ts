import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

const migrationsDirectory = join(process.cwd(), 'prisma', 'migrations');
const migrationName = '20260710213000_add_soft_turn_timing';
let temporaryDirectory: string | undefined;

async function applyMigrationsBefore(
  database: InstanceType<typeof Database>,
): Promise<void> {
  const migrationNames = await readdir(migrationsDirectory);

  for (const name of migrationNames.sort()) {
    if (name >= migrationName) {
      continue;
    }

    database.exec(
      await readFile(join(migrationsDirectory, name, 'migration.sql'), 'utf8'),
    );
  }
}

afterEach(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { force: true, recursive: true });
    temporaryDirectory = undefined;
  }
});

describe('soft turn timing migration', () => {
  it('backfills current turns and preserves the one-open-turn invariant', async () => {
    temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'shadow-cloud-migration-'),
    );
    const database = new Database(join(temporaryDirectory, 'migration.db'));
    const startedAt = '2026-07-10T00:00:00.000Z';

    try {
      await applyMigrationsBefore(database);

      database
        .prepare(
          `INSERT INTO "User" ("id", "email", "displayName", "updatedAt")
           VALUES (?, ?, ?, ?)`,
        )
        .run('user-active', 'active@example.com', 'Active Player', startedAt);
      database
        .prepare(
          `INSERT INTO "Game" ("id", "gameNumber", "name", "slug", "organizerId", "updatedAt")
           VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'game-active',
          1,
          'Active Game',
          'active-game',
          'user-active',
          startedAt,
          'game-without-turn-state',
          2,
          'Inactive Game',
          'inactive-game',
          'user-active',
          startedAt,
        );
      database
        .prepare(
          `INSERT INTO "GamePlayer" ("id", "gameId", "userId", "turnOrder")
           VALUES (?, ?, ?, ?)`,
        )
        .run('entry-active', 'game-active', 'user-active', 2);
      database
        .prepare(
          `INSERT INTO "TurnState" (
             "id", "gameId", "activePlayerId", "activePlayerEntryId", "roundNumber", "updatedAt"
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'turn-state-active',
          'game-active',
          'user-active',
          null,
          3,
          startedAt,
        );
      database
        .prepare(
          `INSERT INTO "NotificationDelivery" (
             "id", "event", "status", "gameId", "gameSlug", "payload", "attempts", "nextAttemptAt",
             "processingStartedAt", "deliveredAt", "lastError", "createdAt", "updatedAt"
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'delivery-existing',
          'THREAD_RENAMED',
          'FAILED',
          'delivery-game-id',
          'delivery-game-slug',
          '{"delivery":"preserved"}',
          7,
          '2026-07-12T01:02:03.456Z',
          '2026-07-12T02:03:04.567Z',
          '2026-07-12T03:04:05.678Z',
          'delivery failed distinctively',
          '2026-07-12T04:05:06.789Z',
          '2026-07-12T05:06:07.890Z',
        );

      database.exec(
        await readFile(
          join(migrationsDirectory, migrationName, 'migration.sql'),
          'utf8',
        ),
      );

      const game = database
        .prepare(
          `SELECT "turnTargetHours", "turnReminderGraceHours", "turnReminderRepeatHours", "turnRemindersEnabled"
           FROM "Game" WHERE "id" = ?`,
        )
        .get('game-active') as {
        turnTargetHours: number;
        turnReminderGraceHours: number;
        turnReminderRepeatHours: number;
        turnRemindersEnabled: number;
      };
      const turnRecord = database
        .prepare(
          `SELECT "gamePlayerId", "userId", "seatNumber", "playerDisplayName", "roundNumber", "startedAt", "nextReminderAt"
           FROM "TurnRecord" WHERE "gameId" = ?`,
        )
        .get('game-active') as {
          gamePlayerId: string;
          userId: string;
          seatNumber: number;
          playerDisplayName: string;
          roundNumber: number;
          startedAt: string;
          nextReminderAt: string;
        };

      expect(game).toEqual({
        turnTargetHours: 24,
        turnReminderGraceHours: 12,
        turnReminderRepeatHours: 24,
        turnRemindersEnabled: 1,
      });
      expect(turnRecord).toMatchObject({
        gamePlayerId: 'entry-active',
        userId: 'user-active',
        seatNumber: 2,
        playerDisplayName: 'Active Player',
        roundNumber: 3,
      });
      expect(turnRecord.startedAt).toBe(startedAt);
      expect(turnRecord.nextReminderAt).toBe('2026-07-11 12:00:00');
      expect(
        database
          .prepare(
            `SELECT "id", "event", "status", "gameId", "gameSlug", "turnRecordId", "payload", "attempts",
                    strftime('%Y-%m-%dT%H:%M:%fZ', "nextAttemptAt") AS "nextAttemptAt",
                    strftime('%Y-%m-%dT%H:%M:%fZ', "processingStartedAt") AS "processingStartedAt",
                    strftime('%Y-%m-%dT%H:%M:%fZ', "deliveredAt") AS "deliveredAt",
                    "lastError",
                    strftime('%Y-%m-%dT%H:%M:%fZ', "createdAt") AS "createdAt",
                    strftime('%Y-%m-%dT%H:%M:%fZ', "updatedAt") AS "updatedAt"
             FROM "NotificationDelivery" WHERE "id" = ?`,
          )
          .get('delivery-existing'),
      ).toEqual({
        id: 'delivery-existing',
        event: 'THREAD_RENAMED',
        status: 'FAILED',
        gameId: 'delivery-game-id',
        gameSlug: 'delivery-game-slug',
        turnRecordId: null,
        payload: '{"delivery":"preserved"}',
        attempts: 7,
        nextAttemptAt: '2026-07-12T01:02:03.456Z',
        processingStartedAt: '2026-07-12T02:03:04.567Z',
        deliveredAt: '2026-07-12T03:04:05.678Z',
        lastError: 'delivery failed distinctively',
        createdAt: '2026-07-12T04:05:06.789Z',
        updatedAt: '2026-07-12T05:06:07.890Z',
      });
      database
        .prepare(
          `INSERT INTO "TurnRecord" (
             "id", "gameId", "roundNumber", "playerDisplayName", "startedAt", "endedAt", "updatedAt"
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'turn-completed',
          'game-active',
          2,
          'Completed Player',
          startedAt,
          startedAt,
          startedAt,
        );
      database
        .prepare(
          `UPDATE "NotificationDelivery" SET "turnRecordId" = ? WHERE "id" = ?`,
        )
        .run('turn-completed', 'delivery-existing');
      database
        .prepare(`DELETE FROM "TurnRecord" WHERE "id" = ?`)
        .run('turn-completed');
      expect(
        database
          .prepare(
            `SELECT "turnRecordId" FROM "NotificationDelivery" WHERE "id" = ?`,
          )
          .get('delivery-existing'),
      ).toEqual({ turnRecordId: null });
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM "TurnRecord"').get(),
      ).toEqual({ count: 1 });
      expect(() =>
        database
          .prepare(
            `INSERT INTO "TurnRecord" (
               "id", "gameId", "roundNumber", "playerDisplayName", "startedAt", "updatedAt"
             ) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            'second-open-turn',
            'game-active',
            4,
            'Another Player',
            startedAt,
            startedAt,
          ),
      ).toThrow('UNIQUE constraint failed: TurnRecord.gameId');
    } finally {
      database.close();
    }
  });
});
