import pg from 'pg';

const runId = process.argv[2];
if (!/^[0-9a-f-]{36}$/i.test(runId ?? '')) throw new Error('A valid sync run ID is required.');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const run = await pool.query(`
    SELECT id,status,records_seen,records_created,records_updated,records_failed,metadata,started_at,finished_at
    FROM sync_runs WHERE id=$1
  `, [runId]);
  const errors = await pool.query(`
    SELECT external_candidate_id,error_category,retryable,sanitized_message
    FROM sync_errors WHERE sync_run_id=$1 ORDER BY id
  `, [runId]);
  process.stdout.write(`${JSON.stringify({ run: run.rows[0] ?? null, errors: errors.rows })}\n`);
} finally {
  await pool.end();
}
