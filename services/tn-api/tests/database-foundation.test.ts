import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DataType, newDb } from 'pg-mem';
import { v7 as uuidv7 } from 'uuid';
import { runMigrations } from '../src/db/migrations.js';
import type { DatabasePool } from '../src/db/pool.js';
import { PostgresCandidateRepository } from '../src/repositories/postgres-candidate-repository.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = join(here, '..', 'migrations');

type TestPool = DatabasePool & { connect: () => Promise<{ query: DatabasePool['query']; release: () => void }> };

async function makeDatabase(): Promise<TestPool> {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.public.registerOperator({
    operator: '~',
    left: DataType.text,
    right: DataType.text,
    returns: DataType.bool,
    implementation: (value: string, pattern: string) => new RegExp(pattern).test(value)
  });
  memory.public.registerFunction({ name: 'trim', args: [DataType.text], returns: DataType.text, implementation: (value: string) => value.trim() });
  memory.public.registerFunction({ name: 'length', args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
  memory.public.registerFunction({
    name: 'lpad',
    args: [DataType.text, DataType.integer, DataType.text],
    returns: DataType.text,
    implementation: (value: string, size: number, fill: string) => `${fill.repeat(Math.max(0, size - value.length))}${value}`.slice(-size)
  });
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  await runMigrations(pool as unknown as TestPool, migrationDirectory);
  return pool as unknown as TestPool;
}

test('migration foundation supports UUIDv7 candidates and monotonic TN codes', async () => {
  const pool = await makeDatabase();
  const repository = new PostgresCandidateRepository(pool);
  const created = await Promise.all([
    repository.createSyntheticCandidate({ displayName: 'TN SYSTEM API TEST A' }),
    repository.createSyntheticCandidate({ displayName: 'TN SYSTEM API TEST B' })
  ]);
  assert.match(created[0]?.id ?? '', /^[0-9a-f-]{36}$/i);
  assert.deepEqual(created.map((candidate) => candidate.candidateCode).sort(), ['TN00000001', 'TN00000002']);
  await pool.end();
});

test('external identity is unique per source instance and documents remain metadata only', async () => {
  const pool = await makeDatabase();
  const repository = new PostgresCandidateRepository(pool);
  const candidate = await repository.createSyntheticCandidate({ displayName: 'TN SYSTEM API TEST' });
  const sourceId = uuidv7();
  await pool.query(`INSERT INTO source_instances (id, source_system, instance_key, display_name) VALUES ($1, 'test', 'test-pinpin', 'Synthetic test source')`, [sourceId]);
  await pool.query(`INSERT INTO candidate_external_refs (id, candidate_id, source_instance_id, external_candidate_id) VALUES ($1, $2, $3, '123')`, [uuidv7(), candidate.id, sourceId]);
  await assert.rejects(pool.query(`INSERT INTO candidate_external_refs (id, candidate_id, source_instance_id, external_candidate_id) VALUES ($1, $2, $3, '123')`, [uuidv7(), candidate.id, sourceId]));
  await pool.query(`INSERT INTO candidate_documents (id, candidate_id, source_instance_id, external_document_id, storage_provider, original_filename) VALUES ($1, $2, $3, '983', 'pinpin_sql_blob', 'synthetic-one.pdf'), ($4, $2, $3, '984', 'pinpin_sql_blob', 'synthetic-two.docx')`, [uuidv7(), candidate.id, sourceId, uuidv7()]);
  const detail = await repository.findByIdOrCode(candidate.candidateCode);
  assert.equal(detail?.documents.length, 2);
  assert.equal(detail?.documents.every((document) => Object.hasOwn(document, 'storageProvider')), true);
  assert.equal(JSON.stringify(detail).includes('BLOB'), false);
  await pool.end();
});

test('source deletion is captured as lifecycle state without deleting the candidate', async () => {
  const pool = await makeDatabase();
  const repository = new PostgresCandidateRepository(pool);
  const candidate = await repository.createSyntheticCandidate({ displayName: 'TN SYSTEM LIFECYCLE TEST' });
  const sourceId = uuidv7();
  await pool.query(`INSERT INTO source_instances (id, source_system, instance_key, display_name) VALUES ($1, 'test', 'lifecycle-source', 'Lifecycle test source')`, [sourceId]);
  await pool.query(`INSERT INTO source_lifecycle_events (id, candidate_id, source_instance_id, external_candidate_id, event_type) VALUES ($1, $2, $3, '123', 'deactivated')`, [uuidv7(), candidate.id, sourceId]);
  const stillPresent = await repository.findByIdOrCode(candidate.id);
  assert.equal(stillPresent?.candidateCode, candidate.candidateCode);
  const events = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM source_lifecycle_events WHERE candidate_id = $1', [candidate.id]);
  assert.equal(events.rows[0]?.count, '1');
  await pool.end();
});
