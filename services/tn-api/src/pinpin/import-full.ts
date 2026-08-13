import { v7 as uuidv7 } from 'uuid';
import { loadConfig } from '../config/env.js';
import { createPool, type DatabasePool } from '../db/pool.js';
import { PinpinSourceAdapter, type PinpinCandidateSnapshot, type PinpinSourcePreflight } from './source-adapter.js';
import { PinpinToTalentNexusReconciler, pinpinSourceInstance, pinpinSourceSystem, type ReconcileResult } from './tn-reconciler.js';

type CountRow = { count: string };
type SourceRow = { id: string };
type Metrics = { observed: number; created: number; materiallyUpdated: number; unchanged: number; failed: number; successful: ReconcileResult[] };

class ControlledRecoveryAbort extends Error {
  public constructor(readonly metrics: Metrics, readonly externalCandidateId: string) {
    super('controlled-recovery-abort');
  }
}

function count(result: { rows: CountRow[] }): number {
  return Number(result.rows[0]?.count ?? '0');
}

function errorCategory(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('permission') || message.includes('denied')) return 'permission';
  if (message.includes('connection') || message.includes('driver') || message.includes('odbc')) return 'transport';
  if (message.includes('constraint') || message.includes('duplicate') || message.includes('foreign key')) return 'target-constraint';
  if (message.includes('invalid') || message.includes('source')) return 'source-data-anomaly';
  return 'reconciliation';
}

async function sourceInstanceId(pool: DatabasePool): Promise<string> {
  const result = await pool.query<SourceRow>(`
    SELECT id FROM source_instances WHERE source_system = $1 AND instance_key = $2 LIMIT 1
  `, [pinpinSourceSystem, pinpinSourceInstance]);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Verified Pinpin source instance is unavailable.');
  return id;
}

async function readAll(adapter: PinpinSourceAdapter): Promise<PinpinCandidateSnapshot[]> {
  const snapshots: PinpinCandidateSnapshot[] = [];
  let after = 0;
  for (;;) {
    const page = await adapter.readPage(after, 200);
    if (page.length === 0) return snapshots;
    const last = Number(page[page.length - 1]?.externalCandidateId);
    if (!Number.isInteger(last) || last <= after) throw new Error('Pinpin pagination contract is invalid.');
    snapshots.push(...page);
    after = last;
  }
}

async function targetPreflight(pool: DatabasePool, sourceInstanceIdValue: string) {
  const [candidateCount, referenceCount, mappedCount, duplicateRefs, multiMappedExternal, multiMappedCandidate, orphanWork, orphanEducation, orphanDocuments, migrationCount] = await Promise.all([
    pool.query<CountRow>('SELECT count(*)::text AS count FROM candidates'),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_external_refs'),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_external_refs WHERE source_instance_id = $1', [sourceInstanceIdValue]),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM (SELECT source_instance_id, external_candidate_id FROM candidate_external_refs GROUP BY 1, 2 HAVING count(*) > 1) d'),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM (SELECT source_instance_id, external_candidate_id FROM candidate_external_refs WHERE source_instance_id = $1 GROUP BY 1, 2 HAVING count(DISTINCT candidate_id) > 1) d', [sourceInstanceIdValue]),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM (SELECT candidate_id FROM candidate_external_refs WHERE source_instance_id = $1 GROUP BY 1 HAVING count(*) > 1) d', [sourceInstanceIdValue]),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_work_experiences child LEFT JOIN candidates parent ON parent.id = child.candidate_id WHERE parent.id IS NULL'),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_educations child LEFT JOIN candidates parent ON parent.id = child.candidate_id WHERE parent.id IS NULL'),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_documents child LEFT JOIN candidates parent ON parent.id = child.candidate_id WHERE parent.id IS NULL'),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM schema_migrations'),
  ]);
  return {
    candidateCount: count(candidateCount), referenceCount: count(referenceCount), mappedCount: count(mappedCount),
    duplicateRefs: count(duplicateRefs), multiMappedExternal: count(multiMappedExternal), multiMappedCandidate: count(multiMappedCandidate),
    orphanWork: count(orphanWork), orphanEducation: count(orphanEducation), orphanDocuments: count(orphanDocuments), migrationCount: count(migrationCount),
  };
}

function assertPreflight(source: PinpinSourcePreflight, snapshots: PinpinCandidateSnapshot[], target: Awaited<ReturnType<typeof targetPreflight>>): void {
  if (source.totalCandidates < 7 || source.activeCandidates + source.inactiveCandidates !== source.totalCandidates || snapshots.length !== source.totalCandidates) {
    throw new Error('Source preflight population is inconsistent.');
  }
  if (target.duplicateRefs || target.multiMappedExternal || target.multiMappedCandidate || target.orphanWork || target.orphanEducation || target.orphanDocuments || target.migrationCount !== 1) {
    throw new Error('Target preflight integrity is not safe for full import.');
  }
}

async function createRun(pool: DatabasePool, sourceInstanceIdValue: string, seen: number): Promise<string> {
  const id = uuidv7();
  await pool.query(`
    INSERT INTO sync_runs (id, source_instance_id, run_type, status, records_seen, metadata)
    VALUES ($1, $2, 'initial_import', 'running', $3, $4::jsonb)
  `, [id, sourceInstanceIdValue, seen, JSON.stringify({ phase: process.env.TN_SYNC_RUN_LABEL ?? '4D', scope: 'full' })]);
  return id;
}

async function recordSanitizedError(pool: DatabasePool, runId: string, sourceInstanceIdValue: string, externalCandidateId: string, category: string): Promise<void> {
  await pool.query(`
    INSERT INTO sync_errors (id, sync_run_id, source_instance_id, external_candidate_id, entity_type, error_category, retryable, sanitized_message)
    VALUES ($1, $2, $3, $4, 'candidate', $5, true, 'Phase 4D candidate reconciliation failed; Pinpin source was not modified.')
  `, [uuidv7(), runId, sourceInstanceIdValue, externalCandidateId, category]);
}

function controlledRecoveryFaultAfter(): number | null {
  if (process.env.TN_RECOVERY_TEST_MODE !== '1') return null;
  const value = Number(process.env.TN_RECOVERY_TEST_ABORT_AFTER ?? '');
  if (!Number.isInteger(value) || value < 2) throw new Error('Controlled recovery fault requires an explicit integer threshold of at least 2.');
  return value;
}

async function runPass(pool: DatabasePool, reconciler: PinpinToTalentNexusReconciler, runId: string, sourceInstanceIdValue: string, snapshots: PinpinCandidateSnapshot[], abortAfter: number | null = null): Promise<Metrics> {
  const metrics: Metrics = { observed: snapshots.length, created: 0, materiallyUpdated: 0, unchanged: 0, failed: 0, successful: [] };
  for (const snapshot of snapshots) {
    try {
      const result = await reconciler.reconcileCandidate(snapshot);
      metrics.successful.push(result);
      if (result.candidateCreated) metrics.created += 1;
      else if (result.materiallyChanged) metrics.materiallyUpdated += 1;
      else metrics.unchanged += 1;
      if (abortAfter !== null && metrics.successful.length >= abortAfter) throw new ControlledRecoveryAbort(metrics, snapshot.externalCandidateId);
    } catch (error) {
      if (error instanceof ControlledRecoveryAbort) throw error;
      metrics.failed += 1;
      await recordSanitizedError(pool, runId, sourceInstanceIdValue, snapshot.externalCandidateId, errorCategory(error));
    }
  }
  return metrics;
}

async function finishRun(pool: DatabasePool, runId: string, first: Metrics, second: Metrics): Promise<void> {
  await pool.query(`
    UPDATE sync_runs SET status = $2, finished_at = now(), records_created = $3, records_updated = $4, records_failed = $5,
      metadata = metadata || $6::jsonb WHERE id = $1
  `, [runId, first.failed + second.failed === 0 ? 'succeeded' : 'failed', first.created, first.materiallyUpdated + second.materiallyUpdated, first.failed + second.failed,
    JSON.stringify({ secondRunCreated: second.created, secondRunMateriallyUpdated: second.materiallyUpdated, secondRunUnchanged: second.unchanged, secondRunFailed: second.failed })]);
}

async function finalAggregate(pool: DatabasePool, sourceInstanceIdValue: string) {
  const [candidates, refs, work, education, documents, activeRefs, inactiveRefs, duplicateRefs, duplicateCodes, orphanWork, orphanEducation, orphanDocuments, lifecycle] = await Promise.all([
    pool.query<CountRow>('SELECT count(DISTINCT candidate_id)::text AS count FROM candidate_external_refs WHERE source_instance_id = $1', [sourceInstanceIdValue]),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_external_refs WHERE source_instance_id = $1', [sourceInstanceIdValue]),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_work_experiences WHERE source_instance_id = $1', [sourceInstanceIdValue]),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_educations WHERE source_instance_id = $1', [sourceInstanceIdValue]),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_documents WHERE source_instance_id = $1', [sourceInstanceIdValue]),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_external_refs WHERE source_instance_id = $1 AND source_active AND source_deleted_at IS NULL', [sourceInstanceIdValue]),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_external_refs WHERE source_instance_id = $1 AND (NOT source_active OR source_deleted_at IS NOT NULL)', [sourceInstanceIdValue]),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM (SELECT external_candidate_id FROM candidate_external_refs WHERE source_instance_id = $1 GROUP BY 1 HAVING count(*) > 1) d', [sourceInstanceIdValue]),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM (SELECT candidate_code FROM candidates GROUP BY 1 HAVING count(*) > 1) d'),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_work_experiences child LEFT JOIN candidates parent ON parent.id = child.candidate_id WHERE parent.id IS NULL'),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_educations child LEFT JOIN candidates parent ON parent.id = child.candidate_id WHERE parent.id IS NULL'),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_documents child LEFT JOIN candidates parent ON parent.id = child.candidate_id WHERE parent.id IS NULL'),
    pool.query<CountRow>('SELECT count(*)::text AS count FROM source_lifecycle_events WHERE source_instance_id = $1', [sourceInstanceIdValue]),
  ]);
  return { candidates: count(candidates), refs: count(refs), work: count(work), education: count(education), documents: count(documents), activeRefs: count(activeRefs), inactiveRefs: count(inactiveRefs), duplicateRefs: count(duplicateRefs), duplicateCodes: count(duplicateCodes), orphanWork: count(orphanWork), orphanEducation: count(orphanEducation), orphanDocuments: count(orphanDocuments), lifecycleEvents: count(lifecycle) };
}

async function main(): Promise<void> {
  const started = Date.now();
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const adapter = await PinpinSourceAdapter.connect();
  try {
    const source = await adapter.readPreflight();
    const snapshots = await readAll(adapter);
    const sourceId = await sourceInstanceId(pool);
    const before = await targetPreflight(pool, sourceId);
    assertPreflight(source, snapshots, before);
    const runId = await createRun(pool, sourceId, snapshots.length);
    try {
      const reconciler = new PinpinToTalentNexusReconciler(pool);
      const faultAfter = controlledRecoveryFaultAfter();
      const firstStarted = Date.now();
      const first = await runPass(pool, reconciler, runId, sourceId, snapshots, faultAfter);
      const firstDurationMs = Date.now() - firstStarted;
      const secondStarted = Date.now();
      const second = await runPass(pool, reconciler, runId, sourceId, snapshots);
      const secondDurationMs = Date.now() - secondStarted;
      await finishRun(pool, runId, first, second);
      const final = await finalAggregate(pool, sourceId);
      const identityStable = first.successful.length === snapshots.length && second.successful.length === snapshots.length && first.successful.every((row, index) => row.candidateId === second.successful[index]?.candidateId && row.candidateCode === second.successful[index]?.candidateCode);
      process.stdout.write(`${JSON.stringify({
        runId, source, before: { existingMappings: before.mappedCount, expectedNewMappings: source.totalCandidates - before.mappedCount, tnCandidateCount: before.candidateCount, tnExternalRefCount: before.referenceCount },
        firstRun: { observed: first.observed, created: first.created, materiallyUpdated: first.materiallyUpdated, unchanged: first.unchanged, failed: first.failed, durationMs: firstDurationMs },
        secondRun: { observed: second.observed, created: second.created, materiallyUpdated: second.materiallyUpdated, unchanged: second.unchanged, failed: second.failed, durationMs: secondDurationMs },
        final, identityStable, totalDurationMs: Date.now() - started,
      })}\n`);
    } catch (error) {
      const controlled = error instanceof ControlledRecoveryAbort ? error : null;
      const metrics = controlled?.metrics;
      await recordSanitizedError(pool, runId, sourceId, controlled?.externalCandidateId ?? 'unknown', controlled ? 'controlled-recovery-abort' : errorCategory(error));
      await pool.query(`
        UPDATE sync_runs SET status = 'failed', finished_at = now(), records_created = $2, records_updated = $3, records_failed = 1,
          metadata = metadata || $4::jsonb WHERE id = $1
      `, [runId, metrics?.created ?? 0, metrics?.materiallyUpdated ?? 0, JSON.stringify({ controlledRecoveryAbort: Boolean(controlled), processedBeforeFailure: metrics?.successful.length ?? 0 })]);
      process.stdout.write(`${JSON.stringify({ phase: process.env.TN_SYNC_RUN_LABEL ?? '4D', status: 'failed', category: controlled ? 'controlled-recovery-abort' : errorCategory(error), processedBeforeFailure: metrics?.successful.length ?? 0 })}\n`);
      process.exitCode = 1;
    }
  } finally {
    await adapter.close();
    await pool.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ phase: '4D', status: 'failed', category: errorCategory(error) })}\n`);
  process.exitCode = 1;
});
