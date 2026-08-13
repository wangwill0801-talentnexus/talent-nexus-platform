import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  let candidateCode: string | undefined;
  try {
    const result = await pool.query<{ candidate_code: string }>(`
      SELECT candidate.candidate_code
      FROM candidate_external_refs AS reference
      JOIN source_instances AS source ON source.id = reference.source_instance_id
      JOIN candidates AS candidate ON candidate.id = reference.candidate_id
      WHERE source.source_system = 'pinpin'
        AND source.instance_key = 'pinpin-prod'
        AND reference.source_active = true
        AND reference.external_candidate_id NOT IN ('43177', '43184')
      ORDER BY candidate.created_at ASC
      LIMIT 1
    `);
    candidateCode = result.rows[0]?.candidate_code;
  } finally {
    await pool.end();
  }
  if (!candidateCode) throw new Error('Pilot candidate API target unavailable.');
  const headers = { authorization: `Bearer ${config.apiToken}` };
  const responses = await Promise.all([
    fetch('http://127.0.0.1:3333/health'),
    fetch('http://127.0.0.1:3333/api/v1/candidates', { headers }),
    fetch(`http://127.0.0.1:3333/api/v1/candidates/${encodeURIComponent(candidateCode)}`, { headers }),
    fetch('http://127.0.0.1:3333/api/v1/candidates/TN99999999', { headers }),
    fetch('http://127.0.0.1:3333/api/v1/candidates'),
  ]);
  process.stdout.write(`${JSON.stringify({ health: responses[0].status, list: responses[1].status, detail: responses[2].status, missing: responses[3].status, unauthenticated: responses[4].status })}\n`);
}

main().catch(() => {
  process.stderr.write('PINPIN_REAL_PILOT_API_SMOKE_FAILED:api\n');
  process.exitCode = 1;
});
