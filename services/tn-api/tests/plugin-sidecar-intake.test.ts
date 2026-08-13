import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DataType, newDb } from 'pg-mem';
import { v7 as uuidv7 } from 'uuid';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config/env.js';
import { runMigrations } from '../src/db/migrations.js';
import type { DatabasePool } from '../src/db/pool.js';
import { PostgresCandidateRepository } from '../src/repositories/postgres-candidate-repository.js';
import { PluginSidecarIntakeService } from '../src/services/plugin-sidecar-intake-service.js';

const here = dirname(fileURLToPath(import.meta.url));
const config: AppConfig = { environment: 'test', host: '127.0.0.1', port: 3333, databaseUrl: 'postgres://test:test@127.0.0.1:5432/talentnexus_test', apiToken: 'test-token-that-is-long-enough' };
const headers = { authorization: `Bearer ${config.apiToken}` };

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
  await pool.query("INSERT INTO candidates (id,candidate_code,display_name,raw_source_metadata) VALUES ($1,'TN00000001','Synthetic Baseline','{}'::jsonb)", [candidateId]);
  await pool.query("INSERT INTO candidate_external_refs (id,candidate_id,source_instance_id,external_candidate_id) VALUES ($1,$2,$3,'43184')", [uuidv7(), candidateId, sourceId]);
  await pool.query('INSERT INTO candidate_work_experiences (id,candidate_id) VALUES ($1,$2)', [uuidv7(), candidateId]);
  await pool.query('INSERT INTO candidate_educations (id,candidate_id) VALUES ($1,$2)', [uuidv7(), candidateId]);
  await pool.query("INSERT INTO candidate_documents (id,candidate_id,storage_provider) VALUES ($1,$2,'synthetic')", [uuidv7(), candidateId]);
  await pool.query("INSERT INTO source_lifecycle_events (id,candidate_id,source_instance_id,event_type) VALUES ($1,$2,$3,'observed')", [uuidv7(), candidateId, sourceId]);
  return { candidateId };
}

async function baseline(pool: DatabasePool, candidateId: string): Promise<Record<string, string>> {
  const count = async (table: string) => (await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${table} WHERE candidate_id=$1`, [candidateId])).rows[0]?.count ?? '0';
  return { candidates: (await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM candidates WHERE id=$1', [candidateId])).rows[0]?.count ?? '0', externalRefs: await count('candidate_external_refs'), work: await count('candidate_work_experiences'), education: await count('candidate_educations'), documents: await count('candidate_documents'), lifecycle: await count('source_lifecycle_events') };
}

function request(summary = 'Synthetic side-car evidence', correlationId = 'run-a') {
  return { contractVersion: 'plugin_sidecar_intake_v1', candidateRef: { sourceSystem: 'pinpin', sourceInstance: 'pinpin-prod', externalCandidateId: '43184' }, source: { sourceKind: 'pdf', sourceSystem: 'synthetic-plugin', sourceReference: 'sidecar-test', sourceUrl: 'https://example.invalid/synthetic', sourceCapturedAt: '2026-08-12T00:00:00.000Z' }, plugin: { version: 'test-plugin' }, ai: { provider: null, model: null }, correlationId, resume: { schemaVersion: 'standard_resume_v1', summary, skills: ['Synthetic'] } };
}

test('side-car intake resolves an exact Pinpin ref, reuses enrichment idempotency, and protects baseline', async () => {
  const pool = await makeDatabase(); const { candidateId } = await seed(pool);
  const app = buildApp(config, new PostgresCandidateRepository(pool), new PluginSidecarIntakeService(pool));
  const before = await baseline(pool, candidateId);
  const first = await app.inject({ method: 'POST', url: '/internal/plugin-sidecar/v1/candidate-enrichment', headers, payload: request() });
  const replay = await app.inject({ method: 'POST', url: '/internal/plugin-sidecar/v1/candidate-enrichment', headers, payload: request('Synthetic side-car evidence', 'run-b') });
  const changed = await app.inject({ method: 'POST', url: '/internal/plugin-sidecar/v1/candidate-enrichment', headers, payload: request('Synthetic side-car changed', 'run-c') });
  assert.equal(first.statusCode, 201); assert.equal(replay.statusCode, 200); assert.equal(changed.statusCode, 201);
  assert.equal(first.json().data.status, 'created'); assert.equal(replay.json().data.status, 'unchanged'); assert.equal(first.json().data.snapshotId, replay.json().data.snapshotId);
  assert.equal(changed.json().data.status, 'created'); assert.notEqual(changed.json().data.snapshotId, first.json().data.snapshotId); assert.equal(changed.json().data.candidateId, candidateId);
  assert.equal(JSON.stringify(first.json()).includes('Synthetic side-car evidence'), false);
  const history = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM candidate_enrichment_snapshots WHERE candidate_id=$1', [candidateId]);
  const latest = await pool.query<{ id: string }>('SELECT id FROM candidate_enrichment_snapshots WHERE candidate_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [candidateId]);
  assert.equal(history.rows[0]?.count, '2'); assert.equal(latest.rows[0]?.id, changed.json().data.snapshotId); assert.deepEqual(await baseline(pool, candidateId), before);
  await app.close(); await pool.end();
});

test('side-car intake rejects malformed or missing identity without creating data or leaking payload', async () => {
  const pool = await makeDatabase(); const { candidateId } = await seed(pool);
  const app = buildApp(config, new PostgresCandidateRepository(pool), new PluginSidecarIntakeService(pool));
  const before = await baseline(pool, candidateId);
  const invalid = await app.inject({ method: 'POST', url: '/internal/plugin-sidecar/v1/candidate-enrichment', headers, payload: { ...request(), contractVersion: 'plugin_sidecar_intake_v2', resume: { schemaVersion: 'standard_resume_v1', name: 'MUST NOT LEAK' } } });
  const missing = await app.inject({ method: 'POST', url: '/internal/plugin-sidecar/v1/candidate-enrichment', headers, payload: { ...request(), candidateRef: { sourceSystem: 'pinpin', sourceInstance: 'pinpin-prod', externalCandidateId: 'does-not-exist' }, resume: { schemaVersion: 'standard_resume_v1', name: 'MUST NOT LEAK' } } });
  assert.equal(invalid.statusCode, 400); assert.equal(invalid.json().error.code, 'SIDECAR_INVALID_PAYLOAD');
  assert.equal(missing.statusCode, 404); assert.equal(missing.json().error.code, 'SIDECAR_CANDIDATE_NOT_FOUND');
  assert.equal(JSON.stringify(missing.json()).includes('MUST NOT LEAK'), false);
  assert.deepEqual(await baseline(pool, candidateId), before);
  assert.equal((await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM candidate_enrichment_snapshots')).rows[0]?.count, '0');
  await app.close(); await pool.end();
});

test('side-car endpoint uses the existing backend bearer guard and does not process unauthenticated data', async () => {
  const pool = await makeDatabase(); const { candidateId } = await seed(pool);
  const app = buildApp(config, new PostgresCandidateRepository(pool), new PluginSidecarIntakeService(pool));
  const response = await app.inject({ method: 'POST', url: '/internal/plugin-sidecar/v1/candidate-enrichment', payload: request() });
  assert.equal(response.statusCode, 401);
  assert.equal((await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM candidate_enrichment_snapshots WHERE candidate_id=$1', [candidateId])).rows[0]?.count, '0');
  await app.close(); await pool.end();
});
