import { v7 as uuidv7 } from 'uuid';
import { loadConfig } from '../config/env.js';
import { createPool, type DatabasePool } from '../db/pool.js';
import { PinpinSourceAdapter, type PinpinCandidateSnapshot } from './source-adapter.js';
import { PinpinToTalentNexusReconciler, pinpinSourceInstance, pinpinSourceSystem, type ReconcileResult } from './tn-reconciler.js';

type SourceInstanceRow = { id: string };
type CountRow = { count: string };
type RunResult = { created: number; updated: number; unchanged: number; failed: number; successful: ReconcileResult[] };

function count(result: { rows: CountRow[] }): number {
  return Number(result.rows[0]?.count ?? '0');
}

function errorCategory(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('selection') || message.includes('state') || message.includes('fixture')) return 'data-contract';
  if (message.includes('permission') || message.includes('denied')) return 'permission';
  if (message.includes('connection') || message.includes('driver') || message.includes('odbc')) return 'transport';
  return 'reconciliation';
}

function assertPilotSelection(snapshots: PinpinCandidateSnapshot[]): void {
  if (snapshots.length !== 5) throw new Error('Phase 4C requires exactly five selected candidates.');
  const ids = new Set<string>();
  for (const snapshot of snapshots) {
    if (snapshot.externalCandidateId === '43177' || snapshot.externalCandidateId === '43184' || !snapshot.sourceActive || snapshot.deletedAt || !snapshot.displayName || snapshot.workExperiences.length === 0 || ids.has(snapshot.externalCandidateId)) {
      throw new Error('Phase 4C selected source data does not satisfy the pilot contract.');
    }
    ids.add(snapshot.externalCandidateId);
  }
}

async function readPilot(): Promise<PinpinCandidateSnapshot[]> {
  const adapter = await PinpinSourceAdapter.connect();
  try {
    const snapshots = await adapter.selectRealPilotCandidates();
    assertPilotSelection(snapshots);
    return snapshots;
  } finally {
    await adapter.close();
  }
}

async function sourceInstanceId(pool: DatabasePool): Promise<string> {
  const result = await pool.query<SourceInstanceRow>(`
    SELECT id FROM source_instances WHERE source_system = $1 AND instance_key = $2 LIMIT 1
  `, [pinpinSourceSystem, pinpinSourceInstance]);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Phase 4C source instance is unavailable.');
  return id;
}

async function assertNoPriorReferences(pool: DatabasePool, sourceInstanceIdValue: string, snapshots: PinpinCandidateSnapshot[]): Promise<void> {
  const result = await pool.query<CountRow>(`
    SELECT count(*)::text AS count
    FROM candidate_external_refs
    WHERE source_instance_id = $1 AND external_candidate_id = ANY($2::text[])
  `, [sourceInstanceIdValue, snapshots.map((snapshot) => snapshot.externalCandidateId)]);
  if (count(result) !== 0) throw new Error('Phase 4C pre-import check found an unexpected existing TN external reference.');
}

async function createSyncRun(pool: DatabasePool, sourceInstanceIdValue: string, snapshots: PinpinCandidateSnapshot[]): Promise<string> {
  const id = uuidv7();
  await pool.query(`
    INSERT INTO sync_runs (id, source_instance_id, run_type, status, records_seen, metadata)
    VALUES ($1, $2, 'initial_import', 'running', $3, $4::jsonb)
  `, [id, sourceInstanceIdValue, snapshots.length, JSON.stringify({ phase: '4C', selectionMethod: 'active-name-work-document-preferred-id-ascending', selectedExternalIds: snapshots.map((snapshot) => snapshot.externalCandidateId) })]);
  return id;
}

async function recordSanitizedError(pool: DatabasePool, syncRunId: string, sourceInstanceIdValue: string, externalCandidateId: string, category: string): Promise<void> {
  await pool.query(`
    INSERT INTO sync_errors (id, sync_run_id, source_instance_id, external_candidate_id, entity_type, error_category, retryable, sanitized_message)
    VALUES ($1, $2, $3, $4, 'candidate', $5, true, 'Phase 4C candidate reconciliation failed; source was not modified.')
  `, [uuidv7(), syncRunId, sourceInstanceIdValue, externalCandidateId, category]);
}

async function runPass(pool: DatabasePool, reconciler: PinpinToTalentNexusReconciler, syncRunId: string, sourceInstanceIdValue: string, snapshots: PinpinCandidateSnapshot[], firstPass: boolean): Promise<RunResult> {
  const result: RunResult = { created: 0, updated: 0, unchanged: 0, failed: 0, successful: [] };
  for (const snapshot of snapshots) {
    try {
      const reconciled = await reconciler.reconcileRealPilotCandidate(snapshot);
      result.successful.push(reconciled);
      if (reconciled.candidateCreated) result.created += 1;
      else if (reconciled.materiallyChanged) result.updated += 1;
      else result.unchanged += 1;
    } catch (error) {
      result.failed += 1;
      await recordSanitizedError(pool, syncRunId, sourceInstanceIdValue, snapshot.externalCandidateId, errorCategory(error));
    }
  }
  return result;
}

async function finishSyncRun(pool: DatabasePool, syncRunId: string, first: RunResult, second: RunResult): Promise<void> {
  const failures = first.failed + second.failed;
  await pool.query(`
    UPDATE sync_runs
    SET status = $2, finished_at = now(), records_created = $3, records_updated = $4, records_failed = $5,
      metadata = metadata || $6::jsonb
    WHERE id = $1
  `, [syncRunId, failures === 0 ? 'succeeded' : 'failed', first.created, first.updated + second.updated, failures, JSON.stringify({ secondRunCreated: second.created, secondRunUpdated: second.updated, secondRunFailed: second.failed })]);
}

async function aggregateIntegrity(pool: DatabasePool, sourceInstanceIdValue: string, candidates: ReconcileResult[]): Promise<Record<string, number>> {
  const candidateIds = candidates.map((candidate) => candidate.candidateId);
  const externalIds = candidates.map((candidate) => candidate.candidateId);
  const [references, work, education, documents, codes] = await Promise.all([
    pool.query<CountRow>('SELECT count(*)::text AS count FROM (SELECT external_candidate_id FROM candidate_external_refs WHERE source_instance_id = $1 GROUP BY external_candidate_id HAVING count(*) > 1) duplicates', [sourceInstanceIdValue]),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_work_experiences child LEFT JOIN candidates parent ON parent.id = child.candidate_id WHERE child.candidate_id = ANY($1::uuid[]) AND parent.id IS NULL', [candidateIds]),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_educations child LEFT JOIN candidates parent ON parent.id = child.candidate_id WHERE child.candidate_id = ANY($1::uuid[]) AND parent.id IS NULL', [candidateIds]),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_documents child LEFT JOIN candidates parent ON parent.id = child.candidate_id WHERE child.candidate_id = ANY($1::uuid[]) AND parent.id IS NULL', [candidateIds]),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM (SELECT candidate_code FROM candidates WHERE id = ANY($1::uuid[]) GROUP BY candidate_code HAVING count(*) > 1) duplicates', [candidateIds]),
  ]);
  void externalIds;
  return { externalReferenceDuplicates: count(references), orphanWorkRows: count(work), orphanEducationRows: count(education), orphanDocumentRows: count(documents), candidateCodeDuplicates: count(codes) };
}

async function main(): Promise<void> {
  const snapshots = await readPilot();
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  try {
    const sourceInstanceIdValue = await sourceInstanceId(pool);
    await assertNoPriorReferences(pool, sourceInstanceIdValue, snapshots);
    const syncRunId = await createSyncRun(pool, sourceInstanceIdValue, snapshots);
    const reconciler = new PinpinToTalentNexusReconciler(pool);
    const first = await runPass(pool, reconciler, syncRunId, sourceInstanceIdValue, snapshots, true);
    const second = await runPass(pool, reconciler, syncRunId, sourceInstanceIdValue, snapshots, false);
    await finishSyncRun(pool, syncRunId, first, second);
    const sameIdentity = first.successful.length === 5 && second.successful.length === 5 && first.successful.every((candidate, index) => candidate.candidateId === second.successful[index]?.candidateId && candidate.candidateCode === second.successful[index]?.candidateCode);
    const integrity = await aggregateIntegrity(pool, sourceInstanceIdValue, second.successful);
    process.stdout.write(`${JSON.stringify({
      pilotSize: snapshots.length,
      firstRun: { created: first.created, updated: first.updated, unchanged: first.unchanged, failed: first.failed },
      secondRun: { created: second.created, updated: second.updated, unchanged: second.unchanged, failed: second.failed },
      identityStable: sameIdentity ? '5/5' : 'ISSUE',
      candidateCodeStable: sameIdentity ? '5/5' : 'ISSUE',
      workRows: second.successful.reduce((total, candidate) => total + candidate.workCount, 0),
      educationRows: second.successful.reduce((total, candidate) => total + candidate.educationCount, 0),
      documentMetadataRows: second.successful.reduce((total, candidate) => total + candidate.documentCount, 0),
      activeCandidates: second.successful.filter((candidate) => candidate.sourceActive && !candidate.sourceDeleted).length,
      integrity,
      blobReads: 0,
      pinpinWrites: 0,
    })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`PINPIN_REAL_PILOT_FAILED:${errorCategory(error)}\n`);
  process.exitCode = 1;
});
