import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb } from 'pg-mem';
import { v7 as uuidv7 } from 'uuid';
import { runMigrations } from '../src/db/migrations.js';
import type { DatabasePool } from '../src/db/pool.js';
import type { DatabaseClient } from '../src/db/pool.js';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config/env.js';
import { PostgresCandidateRepository } from '../src/repositories/postgres-candidate-repository.js';
import { HistoricalEvidenceIntakeService } from '../src/services/historical-evidence-intake-service.js';
import { CandidateProcessingService } from '../src/services/candidate-processing-service.js';
import { EvidenceAiProcessingExecutor } from '../src/services/evidence-ai-processing-executor.js';
import type { AiProvider } from '../src/ai/types.js';
import { canonicalizeEvidenceUrl, evidenceContentSha256, normalizeEvidenceText } from '../src/domain/evidence-intake.js';

const here = dirname(fileURLToPath(import.meta.url));
const config: AppConfig = { environment: 'test', host: '127.0.0.1', port: 3333, databaseUrl: 'postgres://test:test@127.0.0.1:5432/test', apiToken: 'controlled-test-token' };
const headers = { authorization: `Bearer ${config.apiToken}` };

async function database(): Promise<DatabasePool> {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.public.registerOperator({ operator: '~', left: DataType.text, right: DataType.text, returns: DataType.bool, implementation: (value: string, pattern: string) => new RegExp(pattern).test(value) });
  memory.public.registerFunction({ name: 'trim', args: [DataType.text], returns: DataType.text, implementation: (value: string) => value.trim() });
  memory.public.registerFunction({ name: 'length', args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
  memory.public.registerFunction({ name: 'lpad', args: [DataType.text, DataType.integer, DataType.text], returns: DataType.text, implementation: (value: string, size: number, fill: string) => `${fill.repeat(Math.max(0, size - value.length))}${value}`.slice(-size) });
  const pool = new (memory.adapters.createPg().Pool)();
  await runMigrations(pool as never, join(here, '..', 'migrations'));
  return {
    query: (text: string, params?: unknown[]) => pool.query(text.replace(' SKIP LOCKED', ''), params),
    connect: async () => {
      const client = await pool.connect();
      return { query: (text: string, params?: unknown[]) => client.query(text.replace(' SKIP LOCKED', ''), params), release: () => client.release() } as DatabaseClient;
    },
    end: () => pool.end()
  } as DatabasePool;
}

async function seed(pool: DatabasePool, atsId = '43184'): Promise<string> {
  const candidateId = uuidv7(), sourceId = uuidv7();
  await pool.query("INSERT INTO source_instances (id,source_system,instance_key,display_name) VALUES ($1,'pinpin','pinpin-prod','Controlled')", [sourceId]);
  await pool.query("INSERT INTO candidates (id,candidate_code,display_name) VALUES ($1,'TN00000999','Controlled Existing Candidate')", [candidateId]);
  await pool.query('INSERT INTO candidate_external_refs (id,candidate_id,source_instance_id,external_candidate_id) VALUES ($1,$2,$3,$4)', [uuidv7(), candidateId, sourceId, atsId]);
  return candidateId;
}

function request(sourceKind: '104_resume' | 'linkedin_public' | 'linkedin_recruiter' | 'pdf' | 'docx' | 'html' | 'connector_capture' = 'linkedin_public', text = 'Candidate\r\n  Experience\u00a0A') {
  const file = ['pdf', 'docx', 'html'].includes(sourceKind);
  return {
    contractVersion: 'candidate_evidence_intake_v1',
    candidateRef: { sourceSystem: 'pinpin', sourceInstance: 'pinpin-prod', externalCandidateId: '43184' },
    source: {
      sourceKind,
      sourceSystem: file ? 'controlled-file' : sourceKind,
      sourceReference: file ? `controlled-${sourceKind}-1` : sourceKind === 'linkedin_recruiter' ? 'linkedin-recruiter:controlled-1' : sourceKind === 'connector_capture' ? 'connector-run:controlled-1' : null,
      sourceUrl: sourceKind === 'linkedin_public' ? 'https://www.linkedin.com/in/controlled-profile/?trk=test' : sourceKind === '104_resume' ? 'https://www.104.com.tw/resume/controlled?jobsource=test' : null,
      sourceCapturedAt: '2026-08-13T00:00:00.000Z',
      attachmentName: file ? `controlled.${sourceKind}` : null,
      attachmentType: file ? `application/${sourceKind}` : null,
      attachmentReference: file ? `file:${sourceKind}:controlled` : null
    },
    capture: { method: file ? 'connector_file_extract' : 'connector_visible_page', connectorVersion: '5000.0.116-test', extractorVersion: `extractor-${sourceKind}-v1`, normalizationVersion: 'tn-text-nfkc-v1' },
    representation: { kind: file ? 'local_file_text' : 'connector_text', text },
    ai: { provider: 'gemini', model: 'controlled-model' },
    correlationId: `controlled-${sourceKind}`,
    resume: { schemaVersion: 'standard_resume_v1', summary: `Controlled ${sourceKind}`, skills: ['Controlled'] }
  };
}

test('normalization and SHA-256 are deterministic and URLs remove tracking safely', () => {
  const first = normalizeEvidenceText('Ａ\r\nB\u00a0 C\n\n\nD  ');
  const second = normalizeEvidenceText('A\nB  C\n\nD');
  assert.equal(first, second);
  assert.equal(evidenceContentSha256(first), evidenceContentSha256(second));
  assert.equal(canonicalizeEvidenceUrl('https://linkedin.com/in/example/?trk=abc'), 'https://www.linkedin.com/in/example/');
  assert.equal(canonicalizeEvidenceUrl('https://www.104.com.tw/resume/abc/?jobsource=x'), 'https://www.104.com.tw/resume/abc');
});

test('104, LinkedIn Public, LinkedIn Recruiter, PDF, DOCX, HTML and frozen Connector evidence create verified envelopes', async () => {
  for (const sourceKind of ['104_resume', 'linkedin_public', 'linkedin_recruiter', 'pdf', 'docx', 'html', 'connector_capture'] as const) {
    const pool = await database(); const candidateId = await seed(pool); const service = new HistoricalEvidenceIntakeService(pool);
    const result = await service.intake(request(sourceKind));
    assert.equal(result.status, 'created'); assert.equal(result.candidateId, candidateId); assert.equal(result.processingStatus, 'completed');
    const evidence = await pool.query<Record<string, unknown>>('SELECT * FROM candidate_resume_evidence WHERE id=$1', [result.evidenceId]);
    assert.equal(evidence.rows[0]?.processing_eligible, true); assert.equal(evidence.rows[0]?.hash_algorithm, 'sha256'); assert.equal(evidence.rows[0]?.normalization_version, 'tn-text-nfkc-v1');
    assert.equal(String(evidence.rows[0]?.content_sha256), result.contentSha256); assert.ok(evidence.rows[0]?.enrichment_snapshot_id);
    const extraction = await pool.query<Record<string, unknown>>('SELECT normalized_text,character_count FROM candidate_evidence_extractions WHERE evidence_id=$1', [result.evidenceId]);
    assert.equal(extraction.rows.length, 1); assert.equal(typeof extraction.rows[0]?.normalized_text, 'string');
    await pool.end();
  }
});

test('same evidence replay is a no-op while changed content creates a new immutable evidence/snapshot pair', async () => {
  const pool = await database(); await seed(pool); const service = new HistoricalEvidenceIntakeService(pool);
  const first = await service.intake(request()); const replay = await service.intake(request()); const changed = await service.intake(request('linkedin_public', 'Candidate\nExperience B'));
  assert.equal(replay.status, 'unchanged'); assert.equal(replay.evidenceId, first.evidenceId); assert.equal(replay.snapshotId, first.snapshotId);
  assert.equal(changed.status, 'created'); assert.notEqual(changed.evidenceId, first.evidenceId); assert.notEqual(changed.snapshotId, first.snapshotId);
  assert.equal((await pool.query<{ count: string }>('SELECT count(*)::text count FROM candidate_resume_evidence')).rows[0]?.count, '2');
  assert.equal((await pool.query<{ count: string }>('SELECT count(*)::text count FROM candidate_enrichment_snapshots')).rows[0]?.count, '2');
  await pool.end();
});

test('raw evidence queues once, client hash mismatch fails closed, and no candidate is inferred from profile data', async () => {
  const pool = await database(); await seed(pool); const service = new HistoricalEvidenceIntakeService(pool);
  const raw = { ...request('pdf'), resume: null, ai: {} };
  const first = await service.intake(raw); const replay = await service.intake(raw);
  assert.equal(first.processingStatus, 'queued'); assert.equal(replay.status, 'unchanged'); assert.equal(replay.evidenceId, first.evidenceId);
  assert.equal((await pool.query<{ count: string }>('SELECT count(*)::text count FROM candidate_processing_jobs')).rows[0]?.count, '1');
  await assert.rejects(service.intake({ ...request(), representation: { ...request().representation, contentSha256: '0'.repeat(64) } }), (error: unknown) => error instanceof Error && error.message === 'EVIDENCE_HASH_MISMATCH');
  await assert.rejects(service.intake({ ...request(), candidateRef: { sourceSystem: 'pinpin', sourceInstance: 'pinpin-prod', externalCandidateId: '999999' }, resume: { schemaVersion: 'standard_resume_v1', name: 'Same Name Must Not Match', email: 'controlled@example.invalid' } }), (error: unknown) => error instanceof Error && error.message === 'EVIDENCE_CANDIDATE_NOT_FOUND');
  assert.equal((await pool.query<{ count: string }>('SELECT count(*)::text count FROM candidates')).rows[0]?.count, '1');
  await pool.end();
});

test('scoped external identity uniqueness prevents an ambiguous candidate binding', async () => {
  const pool = await database();
  await seed(pool);
  const secondCandidate = uuidv7();
  await pool.query("INSERT INTO candidates (id,candidate_code,display_name) VALUES ($1,'TN00001000','Second Controlled Candidate')", [secondCandidate]);
  const source = await pool.query<{ id: string }>("SELECT id FROM source_instances WHERE source_system='pinpin' AND instance_key='pinpin-prod'");
  await assert.rejects(pool.query('INSERT INTO candidate_external_refs (id,candidate_id,source_instance_id,external_candidate_id) VALUES ($1,$2,$3,$4)', [uuidv7(), secondCandidate, source.rows[0]!.id, '43184']));
  const service = new HistoricalEvidenceIntakeService(pool);
  const result = await service.intake(request());
  assert.notEqual(result.candidateId, secondCandidate);
  await pool.end();
});

test('queued raw evidence uses the approved AI worker once and persists an immutable searchable projection', async () => {
  const pool = await database();
  await seed(pool);
  const intake = new HistoricalEvidenceIntakeService(pool);
  const raw = { ...request('docx'), resume: null, ai: {} };
  const accepted = await intake.intake(raw);
  let calls = 0;
  const provider: AiProvider = {
    providerName: 'gemini',
    isConfigured: () => true,
    async generateStructured() {
      calls += 1;
      return { text: '{}', json: { name: 'Controlled', currentEmployment: { company: 'Controlled Company', title: 'Controlled Role' }, experience: [], education: [], skills: ['SQL'], languages: [], languageDetails: [], certifications: [], projectExperience: [], targetRoles: ['Data Engineer'], coreKeywords: ['SQL'], summary: 'Evidence-backed controlled summary', recruiterSummary: 'Evidence-backed controlled recruiter summary' } };
    },
    async embedText() { return { values: [] }; },
    async healthCheck() { return { provider: 'gemini', configured: true, connectivity: 'pass', generation: 'pass', embedding: 'pass' }; }
  };
  const processing = new CandidateProcessingService(pool, new EvidenceAiProcessingExecutor(provider, 'controlled-model'));
  const completed = await processing.runOne();
  assert.equal(completed?.status, 'completed');
  assert.equal(calls, 1);
  const evidence = await pool.query<{ enrichment_snapshot_id: string | null }>('SELECT enrichment_snapshot_id FROM candidate_resume_evidence WHERE id=$1', [accepted.evidenceId]);
  assert.ok(evidence.rows[0]?.enrichment_snapshot_id);
  assert.equal((await pool.query<{ count: string }>('SELECT count(*)::text count FROM candidate_ai_profiles')).rows[0]?.count, '1');
  assert.equal((await pool.query<{ count: string }>("SELECT count(*)::text count FROM candidate_ai_terms WHERE term_type='skill' AND value='SQL'")).rows[0]?.count, '1');
  assert.equal(await processing.runOne(), null);
  assert.equal((await intake.intake(raw)).status, 'unchanged');
  assert.equal(calls, 1);
  await pool.end();
});

test('internal evidence endpoint is authenticated and never echoes resume text', async () => {
  const pool = await database(); await seed(pool); const evidenceIntake = new HistoricalEvidenceIntakeService(pool);
  const app = buildApp(config, new PostgresCandidateRepository(pool), undefined, { evidenceIntake });
  const unauthorized = await app.inject({ method: 'POST', url: '/internal/plugin-sidecar/v1/candidate-evidence', payload: request() });
  const accepted = await app.inject({ method: 'POST', url: '/internal/plugin-sidecar/v1/candidate-evidence', headers, payload: request() });
  assert.equal(unauthorized.statusCode, 401); assert.equal(accepted.statusCode, 201);
  assert.equal(accepted.body.includes('Experience'), false); assert.equal(accepted.body.includes('Controlled linkedin_public'), false);
  await app.close(); await pool.end();
});
