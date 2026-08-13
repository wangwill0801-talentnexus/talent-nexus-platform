import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DataType, newDb } from 'pg-mem';
import { v7 as uuidv7 } from 'uuid';
import { runMigrations } from '../src/db/migrations.js';
import type { DatabasePool } from '../src/db/pool.js';
import { parseStandardResumeV1 } from '../src/domain/standard-resume.js';
import { CandidateEnrichmentError, CandidateEnrichmentService } from '../src/services/candidate-enrichment-service.js';

const here = dirname(fileURLToPath(import.meta.url));
async function makeDatabase(): Promise<DatabasePool> {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.public.registerOperator({ operator: '~', left: DataType.text, right: DataType.text, returns: DataType.bool, implementation: (value: string, pattern: string) => new RegExp(pattern).test(value) });
  memory.public.registerFunction({ name: 'trim', args: [DataType.text], returns: DataType.text, implementation: (value: string) => value.trim() });
  memory.public.registerFunction({ name: 'length', args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
  memory.public.registerFunction({ name: 'lpad', args: [DataType.text, DataType.integer, DataType.text], returns: DataType.text, implementation: (value: string, size: number, fill: string) => `${fill.repeat(Math.max(0, size - value.length))}${value}`.slice(-size) });
  const pool = new (memory.adapters.createPg().Pool)();
  await runMigrations(pool as unknown as { query: DatabasePool['query']; connect: DatabasePool['connect'] }, join(here, '..', 'migrations'));
  return pool as unknown as DatabasePool;
}

async function seed(pool: DatabasePool): Promise<{ candidateId: string }> {
  const candidateId = uuidv7(), sourceId = uuidv7();
  await pool.query("INSERT INTO source_instances (id,source_system,instance_key,display_name) VALUES ($1,'pinpin','pinpin-prod','Synthetic Pinpin')", [sourceId]);
  await pool.query("INSERT INTO candidates (id,candidate_code,display_name,primary_email,primary_phone,location_text,current_company,current_title,raw_source_metadata) VALUES ($1,'TN00000001','Synthetic Baseline','synthetic@example.invalid','0913755058','Taipei','Synthetic Co','Synthetic Title','{}'::jsonb)", [candidateId]);
  await pool.query("INSERT INTO candidate_external_refs (id,candidate_id,source_instance_id,external_candidate_id) VALUES ($1,$2,$3,'43184')", [uuidv7(), candidateId, sourceId]);
  await pool.query("INSERT INTO candidate_work_experiences (id,candidate_id) VALUES ($1,$2)", [uuidv7(), candidateId]);
  await pool.query("INSERT INTO candidate_educations (id,candidate_id) VALUES ($1,$2)", [uuidv7(), candidateId]);
  await pool.query("INSERT INTO candidate_documents (id,candidate_id,storage_provider) VALUES ($1,$2,'synthetic')", [uuidv7(), candidateId]);
  await pool.query("INSERT INTO source_lifecycle_events (id,candidate_id,source_instance_id,event_type) VALUES ($1,$2,$3,'observed')", [uuidv7(), candidateId, sourceId]);
  return { candidateId };
}

async function baselineState(pool: DatabasePool, candidateId: string): Promise<Record<string, string | null>> {
  const candidate = await pool.query<{ display_name: string | null }>('SELECT display_name FROM candidates WHERE id=$1', [candidateId]);
  const count = async (table: string) => (await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table} WHERE candidate_id=$1`, [candidateId])).rows[0]?.count ?? '0';
  return { displayName: candidate.rows[0]?.display_name ?? null, externalRefs: await count('candidate_external_refs'), work: await count('candidate_work_experiences'), education: await count('candidate_educations'), documents: await count('candidate_documents'), lifecycle: await count('source_lifecycle_events') };
}

test('StandardResumeV1 accepts full and sparse evidence but rejects unsupported or oversized payloads', () => {
  assert.equal(parseStandardResumeV1({ schemaVersion: 'standard_resume_v1', name: 'Synthetic', experience: [{ company: 'Co', title: 'Role' }], education: [{ school: 'School', degree: '蝖ㄚ' }], unknownFutureField: { retained: true } }).education[0]?.degree, '蝖ㄚ');
  assert.deepEqual(parseStandardResumeV1({ schemaVersion: 'standard_resume_v1' }).skills, []);
  assert.throws(() => parseStandardResumeV1({ schemaVersion: 'standard_resume_v2' }));
  assert.throws(() => parseStandardResumeV1({ schemaVersion: 'standard_resume_v1', summary: 'x'.repeat(20_001) }));
});

test('enrichment persistence is idempotent, versioned, latest-readable, and baseline-protecting', async () => {
  const pool = await makeDatabase(); const { candidateId } = await seed(pool); const service = new CandidateEnrichmentService(pool);
  const input = { candidateId, source: { kind: 'pdf', system: 'synthetic', reference: 'source-1', url: 'https://example.invalid/resume', capturedAt: '2026-08-12T00:00:00.000Z', attachmentName: 'controlled-fixture.pdf', attachmentType: 'application/pdf', attachmentReference: 'fixture-1', contentSha256: 'a'.repeat(64) }, pluginVersion: 'test', parserVersion: 'standard-resume-parser-test', atsSavedAt: '2026-08-12T00:01:00.000Z', aiMetadata: { provider: 'gemini', model: 'configured-elsewhere' }, correlationId: 'test-correlation', payload: { schemaVersion: 'standard_resume_v1', name: 'Synthetic Only', summary: 'first', recruiterSummary: 'controlled recruiter view', skills: ['TypeScript'], languages: ['English'], certifications: ['Controlled Certification'], targetRoles: ['Engineer'], coreKeywords: ['API'], experience: [{ company: 'Controlled Co', title: 'Engineer' }], education: [{ school: 'Controlled University', degree: 'Master' }] } };
  const baseline = await baselineState(pool, candidateId);
  const first = await service.storeCandidateEnrichment(input); const replay = await service.storeCandidateEnrichment(input);
  const changed = await service.storeCandidateEnrichment({ ...input, payload: { ...input.payload, summary: 'changed' } }); const latest = await service.getLatestCandidateEnrichment(candidateId);
  assert.equal(first.status, 'created'); assert.equal(replay.status, 'unchanged'); assert.equal(replay.snapshot.id, first.snapshot.id); assert.equal(changed.status, 'created'); assert.equal(changed.snapshot.supersedesId, first.snapshot.id); assert.equal(latest?.id, changed.snapshot.id);
  const history = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM candidate_enrichment_snapshots WHERE candidate_id=$1', [candidateId]); assert.equal(history.rows[0]?.count, '2');
  const normalized = async (table: string) => Number((await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table} WHERE candidate_id=$1`, [candidateId])).rows[0]?.count ?? '0');
  assert.equal(await normalized('candidate_ai_profiles'), 2);
  assert.equal(await normalized('candidate_ai_work_experiences'), 2);
  assert.equal(await normalized('candidate_ai_educations'), 2);
  assert.equal(await normalized('candidate_ai_terms'), 10);
  assert.equal(await normalized('candidate_resume_evidence'), 2);
  const processing = await pool.query<{ status: string; latest_snapshot_id: string; parser_version: string }>('SELECT status,latest_snapshot_id,parser_version FROM candidate_processing_state WHERE candidate_id=$1', [candidateId]);
  assert.equal(processing.rows[0]?.status, 'completed'); assert.equal(processing.rows[0]?.latest_snapshot_id, changed.snapshot.id); assert.equal(processing.rows[0]?.parser_version, 'standard-resume-parser-test');
  const after = await baselineState(pool, candidateId);
  assert.deepEqual(after, baseline);
  const audit = CandidateEnrichmentService.auditFields(candidateId, first); assert.equal(JSON.stringify(audit).includes('Synthetic Only'), false);
  await assert.rejects(service.storeCandidateEnrichment({ ...input, candidateId: uuidv7(), payload: { schemaVersion: 'standard_resume_v2' } }), (error: unknown) => error instanceof CandidateEnrichmentError);
  await pool.end();
});

test('six controlled diverse Golden payloads preserve source richness without a second AI call', async () => {
  const pool = await makeDatabase();
  const fixtures = JSON.parse(readFileSync(join(here, 'fixtures', 'candidate-intake-diverse.json'), 'utf8')) as Array<{ sourceKind: string; function: string; resume: Record<string, unknown> }>;
  assert.equal(fixtures.length, 6);
  for (const [index, fixture] of fixtures.entries()) {
    const candidateId = uuidv7();
    await pool.query('INSERT INTO candidates (id,candidate_code,display_name) VALUES ($1,$2,$3)', [candidateId, `TN${String(index + 101).padStart(8, '0')}`, `Controlled Golden ${index + 1}`]);
    const result = await new CandidateEnrichmentService(pool).storeCandidateEnrichment({ candidateId, source: { kind: fixture.sourceKind, system: 'controlled-golden-set', reference: fixture.function }, pluginVersion: 'golden-test', parserVersion: 'standard-resume-v1', payload: fixture.resume });
    assert.equal(result.status, 'created');
  }
  assert.equal((await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM candidate_ai_profiles')).rows[0]?.count, '6');
  assert.equal((await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM candidate_processing_state WHERE status=\'completed\'')).rows[0]?.count, '6');
  assert.equal((await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM candidate_resume_evidence')).rows[0]?.count, '6');
  await pool.end();
});

test('a transient projection failure rolls back the logical intake and a retry converges once', async () => {
  const pool = await makeDatabase(); const { candidateId } = await seed(pool); let failOnce = true;
  const flaky = {
    query: pool.query.bind(pool), end: pool.end.bind(pool),
    connect: async () => {
      const client = await pool.connect();
      return {
        query: async (sql: string, values?: readonly unknown[]) => {
          if (failOnce && sql.includes('INSERT INTO candidate_enrichment_snapshots')) { failOnce = false; throw new Error('controlled-transient'); }
          return client.query(sql, values as unknown[]);
        },
        release: () => client.release()
      };
    }
  } as unknown as DatabasePool;
  const input = { candidateId, source: { kind: 'pdf', system: 'controlled-retry' }, payload: { schemaVersion: 'standard_resume_v1', summary: 'Controlled retry', experience: [{ company: 'Retry Co' }] } };
  await assert.rejects(new CandidateEnrichmentService(flaky).storeCandidateEnrichment(input));
  assert.equal((await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM candidate_enrichment_snapshots WHERE candidate_id=$1', [candidateId])).rows[0]?.count, '0');
  const replay = await new CandidateEnrichmentService(flaky).storeCandidateEnrichment(input);
  assert.equal(replay.status, 'created');
  assert.equal((await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM candidate_ai_work_experiences WHERE candidate_id=$1', [candidateId])).rows[0]?.count, '1');
  await pool.end();
});

test('an unchanged legacy snapshot replay repairs missing projections without creating another snapshot', async () => {
  const pool = await makeDatabase(); const { candidateId } = await seed(pool); const service = new CandidateEnrichmentService(pool);
  const input = { candidateId, source: { kind: 'linkedin', system: 'controlled-legacy', reference: 'legacy-snapshot' }, pluginVersion: 'legacy-plugin', payload: { schemaVersion: 'standard_resume_v1', summary: 'Controlled legacy snapshot', experience: [{ company: 'Legacy Co' }], education: [{ school: 'Legacy School' }], skills: ['Legacy Skill'] } };
  const first = await service.storeCandidateEnrichment(input);
  for (const table of ['candidate_ai_terms','candidate_ai_work_experiences','candidate_ai_educations','candidate_ai_profiles','candidate_processing_jobs','candidate_resume_evidence','candidate_processing_state']) {
    await pool.query(`DELETE FROM ${table} WHERE candidate_id=$1`, [candidateId]);
  }
  const replay = await service.storeCandidateEnrichment(input);
  assert.equal(replay.status, 'unchanged'); assert.equal(replay.snapshot.id, first.snapshot.id);
  assert.equal((await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM candidate_enrichment_snapshots WHERE candidate_id=$1', [candidateId])).rows[0]?.count, '1');
  assert.equal((await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM candidate_ai_profiles WHERE candidate_id=$1', [candidateId])).rows[0]?.count, '1');
  assert.equal((await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM candidate_ai_work_experiences WHERE candidate_id=$1', [candidateId])).rows[0]?.count, '1');
  assert.equal((await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM candidate_ai_educations WHERE candidate_id=$1', [candidateId])).rows[0]?.count, '1');
  assert.equal((await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM candidate_resume_evidence WHERE candidate_id=$1', [candidateId])).rows[0]?.count, '1');
  await pool.end();
});
