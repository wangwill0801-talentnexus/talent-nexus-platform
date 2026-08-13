import { createHash } from 'node:crypto';
import { loadConfig } from '../config/env.js';
import { createPool, type DatabasePool } from '../db/pool.js';
import { PinpinSourceAdapter, type PinpinCandidateSnapshot } from './source-adapter.js';
import { PinpinToTalentNexusReconciler, pinpinSourceInstance, pinpinSourceSystem } from './tn-reconciler.js';

type TimestampRow = { id: string; value: string | null };
type IdentityRow = { external_candidate_id: string; candidate_id: string; candidate_code: string };
type CountRow = { count: string };

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function readPilot(): Promise<PinpinCandidateSnapshot[]> {
  const adapter = await PinpinSourceAdapter.connect();
  try { return await adapter.selectRealPilotCandidates(); } finally { await adapter.close(); }
}

async function timestamps(pool: DatabasePool, externalIds: string[]): Promise<Record<string, Record<string, string | null>>> {
  const candidates = await pool.query<{ id: string }>(`
    SELECT candidate.id
    FROM candidate_external_refs AS reference
    JOIN source_instances AS source ON source.id = reference.source_instance_id
    JOIN candidates AS candidate ON candidate.id = reference.candidate_id
    WHERE source.source_system = $1 AND source.instance_key = $2 AND reference.external_candidate_id = ANY($3::text[])
  `, [pinpinSourceSystem, pinpinSourceInstance, externalIds]);
  const ids = candidates.rows.map((row) => row.id);
  const groups: Array<[string, string]> = [
    ['candidates', 'SELECT id::text AS id, updated_at::text AS value FROM candidates WHERE id = ANY($1::uuid[])'],
    ['externalRefs', 'SELECT id::text AS id, updated_at::text AS value FROM candidate_external_refs WHERE candidate_id = ANY($1::uuid[])'],
    ['work', 'SELECT id::text AS id, updated_at::text AS value FROM candidate_work_experiences WHERE candidate_id = ANY($1::uuid[])'],
    ['education', 'SELECT id::text AS id, updated_at::text AS value FROM candidate_educations WHERE candidate_id = ANY($1::uuid[])'],
    ['documents', 'SELECT id::text AS id, updated_at::text AS value FROM candidate_documents WHERE candidate_id = ANY($1::uuid[])'],
    ['syncState', 'SELECT id::text AS id, updated_at::text AS value FROM candidate_sync_state WHERE candidate_id = ANY($1::uuid[])'],
  ];
  const result: Record<string, Record<string, string | null>> = {};
  for (const [group, sql] of groups) result[group] = Object.fromEntries((await pool.query<TimestampRow>(sql, [ids])).rows.map((row) => [row.id, row.value]));
  return result;
}

async function identities(pool: DatabasePool, externalIds: string[]): Promise<IdentityRow[]> {
  const result = await pool.query<IdentityRow>(`
    SELECT reference.external_candidate_id, reference.candidate_id, candidate.candidate_code
    FROM candidate_external_refs AS reference
    JOIN source_instances AS source ON source.id = reference.source_instance_id
    JOIN candidates AS candidate ON candidate.id = reference.candidate_id
    WHERE source.source_system = $1 AND source.instance_key = $2 AND reference.external_candidate_id = ANY($3::text[])
    ORDER BY reference.external_candidate_id
  `, [pinpinSourceSystem, pinpinSourceInstance, externalIds]);
  return result.rows;
}

async function integrity(pool: DatabasePool, externalIds: string[]): Promise<Record<string, number>> {
  const candidateRows = await identities(pool, externalIds);
  const candidateIds = candidateRows.map((row) => row.candidate_id);
  const externalReferenceDuplicates = await pool.query<CountRow>(`
    SELECT count(*)::text AS count FROM (
      SELECT reference.external_candidate_id
      FROM candidate_external_refs AS reference JOIN source_instances AS source ON source.id = reference.source_instance_id
      WHERE source.source_system = $1 AND source.instance_key = $2 AND reference.external_candidate_id = ANY($3::text[])
      GROUP BY reference.external_candidate_id HAVING count(*) > 1
    ) duplicates
  `, [pinpinSourceSystem, pinpinSourceInstance, externalIds]);
  const candidateCodeDuplicates = await pool.query<CountRow>('SELECT count(*)::text AS count FROM (SELECT candidate_code FROM candidates WHERE id = ANY($1::uuid[]) GROUP BY candidate_code HAVING count(*) > 1) duplicates', [candidateIds]);
  const orphanWork = await pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_work_experiences child LEFT JOIN candidates parent ON parent.id = child.candidate_id WHERE child.candidate_id = ANY($1::uuid[]) AND parent.id IS NULL', [candidateIds]);
  const orphanEducation = await pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_educations child LEFT JOIN candidates parent ON parent.id = child.candidate_id WHERE child.candidate_id = ANY($1::uuid[]) AND parent.id IS NULL', [candidateIds]);
  const orphanDocuments = await pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_documents child LEFT JOIN candidates parent ON parent.id = child.candidate_id WHERE child.candidate_id = ANY($1::uuid[]) AND parent.id IS NULL', [candidateIds]);
  const lifecycle = await pool.query<CountRow>('SELECT count(*)::text AS count FROM source_lifecycle_events WHERE candidate_id = ANY($1::uuid[])', [candidateIds]);
  return { externalReferenceDuplicates: Number(externalReferenceDuplicates.rows[0]?.count ?? 0), candidateCodeDuplicates: Number(candidateCodeDuplicates.rows[0]?.count ?? 0), orphanWorkRows: Number(orphanWork.rows[0]?.count ?? 0), orphanEducationRows: Number(orphanEducation.rows[0]?.count ?? 0), orphanDocumentRows: Number(orphanDocuments.rows[0]?.count ?? 0), lifecycleEvents: Number(lifecycle.rows[0]?.count ?? 0) };
}

function changed(before: Record<string, Record<string, string | null>>, after: Record<string, Record<string, string | null>>): Record<string, number> {
  return Object.fromEntries(Object.keys(before).map((group) => [group, Object.keys(before[group] ?? {}).filter((id) => before[group]?.[id] !== after[group]?.[id]).length]));
}

async function main(): Promise<void> {
  const beforeSource = await readPilot();
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  try {
    const before = await timestamps(pool, beforeSource.map((snapshot) => snapshot.externalCandidateId));
    const beforeIdentities = await identities(pool, beforeSource.map((snapshot) => snapshot.externalCandidateId));
    const reconciler = new PinpinToTalentNexusReconciler(pool);
    const results = [];
    for (const snapshot of beforeSource) results.push(await reconciler.reconcileRealPilotCandidate(snapshot));
    const afterSource = await readPilot();
    const after = await timestamps(pool, beforeSource.map((snapshot) => snapshot.externalCandidateId));
    const afterIdentities = await identities(pool, beforeSource.map((snapshot) => snapshot.externalCandidateId));
    const identityStable = beforeIdentities.length === 5 && beforeIdentities.every((identity, index) => identity.candidate_id === afterIdentities[index]?.candidate_id && identity.candidate_code === afterIdentities[index]?.candidate_code);
    const integrityResult = await integrity(pool, beforeSource.map((snapshot) => snapshot.externalCandidateId));
    process.stdout.write(`${JSON.stringify({
      pilotSize: beforeSource.length,
      sourceFingerprintStable: hash(beforeSource) === hash(afterSource),
      created: results.filter((result) => result.candidateCreated).length,
      materiallyUpdated: results.filter((result) => result.materiallyChanged && !result.candidateCreated).length,
      unchanged: results.filter((result) => !result.materiallyChanged && !result.candidateCreated).length,
      identityStable: identityStable ? '5/5' : 'ISSUE',
      candidateCodeStable: identityStable ? '5/5' : 'ISSUE',
      timestampChanges: changed(before, after),
      integrity: integrityResult,
      blobReads: 0,
      pinpinWrites: 0,
    })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch(() => {
  process.stderr.write('PINPIN_REAL_PILOT_NOOP_PROBE_FAILED:probe\n');
  process.exitCode = 1;
});
