import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type Database from 'better-sqlite3';

export const migrationsDirectory = join(process.cwd(), 'prisma', 'migrations');

export async function applySqliteMigrations(
  database: InstanceType<typeof Database>,
  before?: string,
) {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory() && (!before || entry.name < before))
    .map((entry) => entry.name)
    .sort();

  // Preserve each migration's own transaction and foreign-key PRAGMAs.
  for (const name of names) {
    database.exec(
      await readFile(join(migrationsDirectory, name, 'migration.sql'), 'utf8'),
    );
  }
}
