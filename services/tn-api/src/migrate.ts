import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from './config/env.js';
import { runMigrations } from './db/migrations.js';
import { createPool } from './db/pool.js';

const here = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const pool = createPool(config.databaseUrl);

try {
  const executed = await runMigrations(pool, join(here, '..', 'migrations'));
  process.stdout.write(`Applied migrations: ${executed.length}\n`);
} finally {
  await pool.end();
}
