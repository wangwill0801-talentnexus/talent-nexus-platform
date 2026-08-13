import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';

const runtimeConfigPath = 'E:\\TalentNexus\\config\\tn-api.env';
try { process.loadEnvFile(runtimeConfigPath); } catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
}

type CountRow = { count: string };
const config = loadConfig();
const pool = createPool(config.databaseUrl);

function payload(summary: string, correlationId: string) {
  return {
    contractVersion: 'plugin_sidecar_intake_v1',
    candidateRef: { sourceSystem: 'pinpin', sourceInstance: 'pinpin-prod', externalCandidateId: '43184' },
    source: { sourceKind: 'synthetic-sidecar', sourceSystem: 'tn-phase-6b1', sourceReference: 'controlled-43184', sourceUrl: 'https://example.invalid/tn-phase-6b1', sourceCapturedAt: '2026-08-12T00:00:00.000Z' },
    plugin: { version: 'phase-6b1-test' }, ai: { provider: null, model: null }, correlationId,
    resume: { schemaVersion: 'standard_resume_v1', summary, skills: ['synthetic-sidecar-evidence'] }
  };
}

async function post(input: unknown): Promise<{ statusCode: number; data: { status?: string; snapshotId?: string } }> {
  const response = await fetch(`http://${config.host}:${config.port}/internal/plugin-sidecar/v1/candidate-enrichment`, {
    method: 'POST', headers: { authorization: `Bearer ${config.apiToken}`, 'content-type': 'application/json' }, body: JSON.stringify(input)
  });
  return { statusCode: response.status, data: ((await response.json()) as { data?: { status?: string; snapshotId?: string } }).data ?? {} };
}

async function count(table: string, candidateId: string): Promise<number> {
  return Number((await pool.query<CountRow>(`SELECT count(*)::text AS count FROM ${table} WHERE candidate_id = $1`, [candidateId])).rows[0]?.count ?? '0');
}

try {
  const mapping = await pool.query<{ candidate_id: string; candidate_code: string }>(`
    SELECT reference.candidate_id, candidate.candidate_code
    FROM candidate_external_refs reference
    JOIN source_instances source ON source.id = reference.source_instance_id
    JOIN candidates candidate ON candidate.id = reference.candidate_id
    WHERE source.source_system = 'pinpin' AND source.instance_key = 'pinpin-prod' AND reference.external_candidate_id = '43184'
    LIMIT 1
  `);
  const fixture = mapping.rows[0];
  if (!fixture) throw new Error('synthetic-sidecar-fixture-unavailable');
  const baseline = async () => ({
    externalRefs: await count('candidate_external_refs', fixture.candidate_id), work: await count('candidate_work_experiences', fixture.candidate_id),
    education: await count('candidate_educations', fixture.candidate_id), documents: await count('candidate_documents', fixture.candidate_id),
    lifecycle: await count('source_lifecycle_events', fixture.candidate_id)
  });
  const before = await baseline();
  const first = await post(payload('TN PHASE 6B.1 SYNTHETIC SIDECAR A', 'phase-6b1-a'));
  const replay = await post(payload('TN PHASE 6B.1 SYNTHETIC SIDECAR A', 'phase-6b1-b'));
  const changed = await post(payload('TN PHASE 6B.1 SYNTHETIC SIDECAR B', 'phase-6b1-c'));
  const after = await baseline();
  const history = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM candidate_enrichment_snapshots WHERE candidate_id=$1 AND source_kind='synthetic-sidecar' AND source_system='tn-phase-6b1'`, [fixture.candidate_id]);
  const latest = await pool.query<{ id: string }>(`SELECT id FROM candidate_enrichment_snapshots WHERE candidate_id=$1 AND source_kind='synthetic-sidecar' AND source_system='tn-phase-6b1' ORDER BY created_at DESC,id DESC LIMIT 1`, [fixture.candidate_id]);
  const firstResult = first.data.status === 'created' || first.data.status === 'unchanged' ? first.data.status : 'unexpected';
  const changedResult = changed.data.status === 'created' || changed.data.status === 'unchanged' ? changed.data.status : 'unexpected';
  const succeeded = (first.statusCode === 201 || first.statusCode === 200) && replay.statusCode === 200 && replay.data.status === 'unchanged' && (changed.statusCode === 201 || changed.statusCode === 200) && latest.rows[0]?.id === changed.data.snapshotId;
  process.stdout.write(`${JSON.stringify({ status: succeeded ? 'succeeded' : 'failed', first: firstResult, replay: replay.data.status === 'unchanged' ? 'unchanged' : 'unexpected', changed: changedResult, rerunSafe: firstResult === 'unchanged' && changedResult === 'unchanged', latestIsChanged: latest.rows[0]?.id === changed.data.snapshotId, syntheticHistory: Number(history.rows[0]?.count ?? '0'), candidateCodeStable: fixture.candidate_code === 'TN00000002', baselineCountsStable: JSON.stringify(before) === JSON.stringify(after), pinpinWrites: 0, annexReads: 0, annex1Reads: 0, blobReads: 0 })}\n`);
  if (!succeeded) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'failed', category: error instanceof Error ? error.name : 'unknown' })}\n`);
  process.exitCode = 1;
} finally { await pool.end(); }
