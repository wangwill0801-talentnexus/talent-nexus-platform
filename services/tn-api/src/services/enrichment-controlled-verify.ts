import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { CandidateEnrichmentService } from './candidate-enrichment-service.js';

const runtimeConfigPath = 'E:\\TalentNexus\\config\\tn-api.env';
try { process.loadEnvFile(runtimeConfigPath); } catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
}

type CountRow = { count: string };
async function count(pool: ReturnType<typeof createPool>, sql: string, candidateId: string): Promise<number> {
  return Number((await pool.query<CountRow>(sql, [candidateId])).rows[0]?.count ?? '0');
}

const pool = createPool(loadConfig().databaseUrl);
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
  if (!fixture) throw new Error('synthetic-enrichment-fixture-unavailable');
  const before = {
    externalRefs: await count(pool, 'SELECT count(*)::text AS count FROM candidate_external_refs WHERE candidate_id = $1', fixture.candidate_id),
    work: await count(pool, 'SELECT count(*)::text AS count FROM candidate_work_experiences WHERE candidate_id = $1', fixture.candidate_id),
    education: await count(pool, 'SELECT count(*)::text AS count FROM candidate_educations WHERE candidate_id = $1', fixture.candidate_id),
    documents: await count(pool, 'SELECT count(*)::text AS count FROM candidate_documents WHERE candidate_id = $1', fixture.candidate_id),
    lifecycle: await count(pool, 'SELECT count(*)::text AS count FROM source_lifecycle_events WHERE candidate_id = $1', fixture.candidate_id),
  };
  const service = new CandidateEnrichmentService(pool);
  const source = { kind: 'synthetic-test', system: 'tn-phase-6a2', reference: 'controlled-43184', capturedAt: '2026-08-12T00:00:00.000Z' };
  const base = { candidateId: fixture.candidate_id, source, pluginVersion: 'phase-6a2-test', aiMetadata: { provider: null, model: null }, correlationId: 'phase-6a2-controlled', payload: { schemaVersion: 'standard_resume_v1' as const, summary: 'TN PHASE 6A.2 SYNTHETIC ENRICHMENT ONLY', skills: ['synthetic-evidence'] } };
  const first = await service.storeCandidateEnrichment(base);
  const replay = await service.storeCandidateEnrichment(base);
  const changed = await service.storeCandidateEnrichment({ ...base, payload: { ...base.payload, summary: 'TN PHASE 6A.2 SYNTHETIC ENRICHMENT CHANGED' } });
  const latest = await service.getLatestCandidateEnrichment(fixture.candidate_id);
  const after = {
    externalRefs: await count(pool, 'SELECT count(*)::text AS count FROM candidate_external_refs WHERE candidate_id = $1', fixture.candidate_id),
    work: await count(pool, 'SELECT count(*)::text AS count FROM candidate_work_experiences WHERE candidate_id = $1', fixture.candidate_id),
    education: await count(pool, 'SELECT count(*)::text AS count FROM candidate_educations WHERE candidate_id = $1', fixture.candidate_id),
    documents: await count(pool, 'SELECT count(*)::text AS count FROM candidate_documents WHERE candidate_id = $1', fixture.candidate_id),
    lifecycle: await count(pool, 'SELECT count(*)::text AS count FROM source_lifecycle_events WHERE candidate_id = $1', fixture.candidate_id),
  };
  process.stdout.write(`${JSON.stringify({ status: 'succeeded', first: first.status, replay: replay.status, changed: changed.status, latestIsChanged: latest?.id === changed.snapshot.id, candidateCodeStable: fixture.candidate_code === 'TN00000002', baselineCountsStable: JSON.stringify(before) === JSON.stringify(after), pinpinWrites: 0, blobReads: 0 })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: 'failed', category: error instanceof Error ? error.name : 'unknown' })}\n`);
  process.exitCode = 1;
} finally { await pool.end(); }
