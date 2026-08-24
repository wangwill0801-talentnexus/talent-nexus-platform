import assert from 'node:assert/strict';
import test from 'node:test';
import { DataType, newDb } from 'pg-mem';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v7 as uuidv7 } from 'uuid';
import { runMigrations } from '../src/db/migrations.js';
import type { DatabaseClient, DatabasePool } from '../src/db/pool.js';
import { HistoricalEvidencePilotService, selectHistoricalEvidencePilotCohort } from '../src/services/historical-evidence-pilot-service.js';

async function database(): Promise<DatabasePool> {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.public.registerOperator({ operator: '~', left: DataType.text, right: DataType.text, returns: DataType.bool, implementation: (value: string, pattern: string) => new RegExp(pattern).test(value) });
  memory.public.registerFunction({ name: 'trim', args: [DataType.text], returns: DataType.text, implementation: (value: string) => value.trim() });
  memory.public.registerFunction({ name: 'length', args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
  const pool = new (memory.adapters.createPg().Pool)();
  await runMigrations(pool as never, join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'));
  return {
    query: (text: string, params?: unknown[]) => pool.query(text.replace(' SKIP LOCKED', ''), params),
    connect: async () => {
      const client = await pool.connect();
      return { query: (text: string, params?: unknown[]) => client.query(text.replace(' SKIP LOCKED', ''), params), release: () => client.release() } as DatabaseClient;
    },
    end: () => pool.end()
  } as unknown as DatabasePool;
}

async function seedEligible(pool: DatabasePool, atsId: string, processingStatus: 'completed' | 'queued' = 'completed'): Promise<string> {
  const candidateId = uuidv7();
  const sourceId = uuidv7();
  const snapshotId = uuidv7();
  const evidenceId = uuidv7();
  const extractionId = uuidv7();
  const jobId = uuidv7();
  const contentSha = 'a'.repeat(64);
  const evidenceKey = 'b'.repeat(64);
  await pool.query("INSERT INTO source_instances (id,source_system,instance_key,display_name) VALUES ($1,'pinpin','pinpin-prod','Controlled') ON CONFLICT (source_system,instance_key) DO NOTHING", [sourceId]);
  const scopedSourceId = (await pool.query<{ id: string }>("SELECT id FROM source_instances WHERE source_system='pinpin' AND instance_key='pinpin-prod' LIMIT 1")).rows[0]!.id;
  await pool.query("INSERT INTO candidates (id,candidate_code,display_name) VALUES ($1,$2,'Fixture')", [candidateId, `TN${atsId.padStart(8, '0')}`]);
  await pool.query("INSERT INTO candidate_external_refs (id,candidate_id,source_instance_id,external_candidate_id) VALUES ($1,$2,$3,$4)", [uuidv7(), candidateId, scopedSourceId, atsId]);
  await pool.query(`INSERT INTO candidate_enrichment_snapshots (id,candidate_id,schema_version,source_kind,source_reference,payload,payload_fingerprint,idempotency_key,plugin_version,parser_version,ai_provider,ai_model) VALUES ($1,$2,'standard_resume_v1','docx','controlled://fixture',$3::jsonb,$4,$5,'5000.0.118','extractor-v1','gemini','model-v1')`, [snapshotId, candidateId, JSON.stringify({ schemaVersion: 'standard_resume_v1' }), 'c'.repeat(64), 'd'.repeat(64)]);
  await pool.query(`INSERT INTO candidate_resume_evidence (id,candidate_id,enrichment_snapshot_id,source_type,source_system,source_reference,attachment_name,content_sha256,evidence_fingerprint,extractor_version,representation_kind,processing_eligible,evidence_identity_key,hash_algorithm,normalization_version,capture_method,connector_version) VALUES ($1,$2,$3,'docx','pinpin','controlled://fixture','resume.docx',$4,$4,'extractor-v1','connector_text',true,$5,'sha256','tn-text-nfkc-v1','connector_file_extract','5000.0.118')`, [evidenceId, candidateId, snapshotId, contentSha, evidenceKey]);
  await pool.query(`INSERT INTO candidate_evidence_extractions (id,evidence_id,candidate_id,extractor_version,content_sha256,representation_kind,character_count,status,normalization_version) VALUES ($1,$2,$3,'extractor-v1',$4,'connector_text',42,'available','tn-text-nfkc-v1')`, [extractionId, evidenceId, candidateId, contentSha]);
  await pool.query(`INSERT INTO candidate_processing_jobs (id,candidate_id,evidence_id,extraction_id,operation,status,attempt_count,max_attempts,evidence_fingerprint,extractor_version,parser_version,schema_version,ai_provider,ai_model,idempotency_key,requested_by,output_snapshot_id) VALUES ($1,$2,$3,$4,'process_new_evidence',$5,1,3,$6,'extractor-v1','parser-v1','standard_resume_v1','gemini','model-v1',$7,'controlled',$8)`, [jobId, candidateId, evidenceId, extractionId, processingStatus, contentSha, 'job-key-' + atsId, snapshotId]);
  await pool.query(`INSERT INTO candidate_processing_state (candidate_id,status,latest_snapshot_id,latest_job_id,schema_version,parser_version,processor_version) VALUES ($1,$2,$3,$4,'standard_resume_v1','parser-v1','processor-v1')`, [candidateId, processingStatus, snapshotId, jobId]);
  return candidateId;
}

test('pilot dry-run selects deterministic content-backed metadata without exposing content', async () => {
  const pool = await database();
  await seedEligible(pool, '44002');
  await seedEligible(pool, '44001');
  const report = await new HistoricalEvidencePilotService(pool).dryRun(10);
  assert.equal(report.observed, 2);
  assert.equal(report.eligible, 2);
  assert.deepEqual(report.selectedAtsCandidateIds, ['44001', '44002']);
  assert.equal(report.secondRunNoOp, 'not_run');
  assert.equal(report.duplicateGroups, 0);
  assert.equal(report.items.every((item) => item.evidenceCount === 1 && item.extractionCount === 1), true);
  await pool.end();
});

test('pilot fails closed when processing is pending or evidence is metadata-only', async () => {
  const pool = await database();
  await seedEligible(pool, '44003', 'queued');
  const metadataCandidate = uuidv7();
  const sourceId = uuidv7();
  await pool.query("INSERT INTO source_instances (id,source_system,instance_key,display_name) VALUES ($1,'pinpin','pinpin-prod','Controlled') ON CONFLICT (source_system,instance_key) DO NOTHING", [sourceId]);
  const scopedSourceId = (await pool.query<{ id: string }>("SELECT id FROM source_instances WHERE source_system='pinpin' AND instance_key='pinpin-prod' LIMIT 1")).rows[0]!.id;
  await pool.query("INSERT INTO candidates (id,candidate_code,display_name) VALUES ($1,'TN00004404','Fixture')", [metadataCandidate]);
  await pool.query("INSERT INTO candidate_external_refs (id,candidate_id,source_instance_id,external_candidate_id) VALUES ($1,$2,$3,'44004')", [uuidv7(), metadataCandidate, scopedSourceId]);
  await pool.query("INSERT INTO candidate_resume_evidence (id,candidate_id,source_type,representation_kind,processing_eligible) VALUES ($1,$2,'html','metadata_only',false)", [uuidv7(), metadataCandidate]);
  const report = await new HistoricalEvidencePilotService(pool).dryRun();
  const pending = report.items.find((item) => item.atsCandidateId === '44003');
  const metadata = report.items.find((item) => item.atsCandidateId === '44004');
  assert.equal(pending?.reason, 'processing_pending');
  assert.equal(pending?.eligible, false);
  assert.equal(metadata?.reason, 'evidence_not_content_backed');
  assert.equal(metadata?.eligible, false);
  await pool.end();
});

test('cohort selector caps at twenty and uses ATS ID rather than candidate text', () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    candidateId: `uuid-${index}`,
    atsCandidateId: String(5000 - index),
    eligible: true,
    reason: 'eligible' as const,
    evidenceCount: 1,
    contentBackedEvidenceCount: 1,
    extractionCount: 1,
    snapshotCount: 1,
    latestSnapshotSchemaVersion: 'standard_resume_v1',
    latestProcessingStatus: 'completed',
    latestProcessingErrorCode: null,
    duplicateCounts: { evidenceIdentity: 0, extractionIdentity: 0, processingJobIdentity: 0, snapshotIdentity: 0 }
  }));
  assert.equal(selectHistoricalEvidencePilotCohort(items, 50).length, 12);
  assert.equal(selectHistoricalEvidencePilotCohort(items, 2)[0]?.atsCandidateId, '4989');
});
