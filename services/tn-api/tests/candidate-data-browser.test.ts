import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb } from 'pg-mem';
import { v7 as uuidv7 } from 'uuid';
import { runMigrations } from '../src/db/migrations.js';
import type { DatabasePool } from '../src/db/pool.js';
import { CandidateEnrichmentService } from '../src/services/candidate-enrichment-service.js';
import { CandidateDataBrowserService } from '../src/services/candidate-data-browser-service.js';

async function database(): Promise<DatabasePool> {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.public.registerOperator({ operator: '~', left: DataType.text, right: DataType.text, returns: DataType.bool, implementation: (value: string, pattern: string) => new RegExp(pattern).test(value) });
  memory.public.registerFunction({ name: 'trim', args: [DataType.text], returns: DataType.text, implementation: (value: string) => value.trim() });
  memory.public.registerFunction({ name: 'length', args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
  memory.public.registerFunction({ name: 'lpad', args: [DataType.text, DataType.integer, DataType.text], returns: DataType.text, implementation: (value: string, size: number, fill: string) => `${fill.repeat(Math.max(0, size - value.length))}${value}`.slice(-size) });
  const pool = new (memory.adapters.createPg().Pool)();
  await runMigrations(pool as never, join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'));
  return pool as unknown as DatabasePool;
}

test('data browser resolves consultant-facing ATS ID and separates baseline, AI, evidence, processing and raw snapshot', async () => {
  const pool = await database(); const candidateId = uuidv7(), sourceId = uuidv7();
  await pool.query("INSERT INTO source_instances (id,source_system,instance_key,display_name) VALUES ($1,'pinpin','pinpin-prod','Controlled Pinpin')", [sourceId]);
  await pool.query("INSERT INTO candidates (id,candidate_code,display_name) VALUES ($1,'TN00000183','Controlled Golden Candidate')", [candidateId]);
  await pool.query("INSERT INTO candidate_external_refs (id,candidate_id,source_instance_id,external_candidate_id) VALUES ($1,$2,$3,'43198')", [uuidv7(),candidateId,sourceId]);
  await pool.query('INSERT INTO candidate_work_experiences (id,candidate_id,source_instance_id,display_order) VALUES ($1,$2,$3,0)', [uuidv7(),candidateId,sourceId]);
  await new CandidateEnrichmentService(pool).storeCandidateEnrichment({ candidateId, source: { kind: 'linkedin', system: 'connector', reference: 'controlled-source', capturedAt: '2026-08-13T00:00:00.000Z' }, pluginVersion: 'controlled', parserVersion: 'controlled-parser', payload: { schemaVersion: 'standard_resume_v1', summary: 'Controlled summary', experience: [{ company: 'A' }, { company: 'B' }], education: [{ school: 'School' }], skills: ['Skill'], languages: ['English'], certifications: ['Cert'], targetRoles: ['Role'], coreKeywords: ['Keyword'] } });
  const result = await new CandidateDataBrowserService(pool).inspect('43198');
  assert.equal((result?.header as Record<string, unknown>).atsCandidateId, '43198');
  assert.equal((result?.identity as Record<string, unknown>).legacyTnCode, 'TN00000183');
  assert.equal((result?.atsBaseline as Record<string, unknown>).workCount, 1);
  assert.equal(((result?.aiProfile as Record<string, unknown>).work as unknown[]).length, 2);
  assert.deepEqual(result?.warnings, ['AI_WORK_RICHER_THAN_ATS', 'AI_EDUCATION_RICHER_THAN_ATS', 'SOURCE_NOT_HASHED']);
  assert.equal(((result?.processing as Record<string, unknown>).current as Record<string, unknown>).status, 'completed');
  assert.equal(((result?.processing as Record<string, unknown>).jobs as unknown[]).length, 1);
  assert.equal(((result?.evidence as Record<string, unknown>).current as unknown[]).length, 1);
  assert.ok((result?.rawAiSnapshot as Record<string, unknown>).payload);
  assert.equal(await new CandidateDataBrowserService(pool).inspect('does-not-exist'), null);
  await pool.end();
});
