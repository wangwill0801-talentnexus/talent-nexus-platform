import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

type Queryable = {
  query: (sql: string, values?: readonly unknown[]) => Promise<{ rows: Array<{ id: string }> }>;
};

type MigrationClient = Queryable & { release: () => void };
type MigratableDatabase = Queryable & { connect: () => Promise<MigrationClient> };

export async function runMigrations(db: MigratableDatabase, migrationDirectory: string): Promise<string[]> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const applied = new Set((await db.query('SELECT id FROM schema_migrations')).rows.map((row) => row.id));
  const files = (await readdir(migrationDirectory))
    .filter((file) => /^\d{3}_.+\.sql$/.test(file))
    .sort();
  const executed: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(migrationDirectory, file), 'utf8');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      executed.push(file);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return executed;
}
