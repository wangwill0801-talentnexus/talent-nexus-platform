import { loadConfig } from '../config/env.js';
import { createPool, type DatabasePool } from '../db/pool.js';
import { PinpinSourceAdapter } from './source-adapter.js';
import { pinpinSourceInstance, pinpinSourceSystem } from './tn-reconciler.js';

type CountRow = { count: string };
type SourceRow = { id: string };

function count(result: { rows: CountRow[] }): number { return Number(result.rows[0]?.count ?? '0'); }

async function sourceInstanceId(pool: DatabasePool): Promise<string> {
  const result = await pool.query<SourceRow>('SELECT id FROM source_instances WHERE source_system = $1 AND instance_key = $2 LIMIT 1', [pinpinSourceSystem, pinpinSourceInstance]);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Verified Pinpin source instance is unavailable.');
  return id;
}

async function main(): Promise<void> {
  let stage = 'configuration';
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  stage = 'source-connect';
  const adapter = await PinpinSourceAdapter.connect();
  try {
    stage = 'source-aggregate';
    const source = await adapter.readPreflight();
    stage = 'target-preflight';
    const sourceId = await sourceInstanceId(pool);
    const [tnCandidates, pinpinRefs, duplicateRefs, externalMultiMap, candidateMultiMap, orphanWork, orphanEducation, orphanDocuments, migrations] = await Promise.all([
      pool.query<CountRow>('SELECT count(*)::text AS count FROM candidates'),
      pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_external_refs WHERE source_instance_id = $1', [sourceId]),
      pool.query<CountRow>('SELECT count(*)::text AS count FROM (SELECT source_instance_id, external_candidate_id FROM candidate_external_refs GROUP BY 1, 2 HAVING count(*) > 1) d'),
      pool.query<CountRow>('SELECT count(*)::text AS count FROM (SELECT external_candidate_id FROM candidate_external_refs WHERE source_instance_id = $1 GROUP BY 1 HAVING count(DISTINCT candidate_id) > 1) d', [sourceId]),
      pool.query<CountRow>('SELECT count(*)::text AS count FROM (SELECT candidate_id FROM candidate_external_refs WHERE source_instance_id = $1 GROUP BY 1 HAVING count(*) > 1) d', [sourceId]),
      pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_work_experiences child LEFT JOIN candidates parent ON parent.id = child.candidate_id WHERE parent.id IS NULL'),
      pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_educations child LEFT JOIN candidates parent ON parent.id = child.candidate_id WHERE parent.id IS NULL'),
      pool.query<CountRow>('SELECT count(*)::text AS count FROM candidate_documents child LEFT JOIN candidates parent ON parent.id = child.candidate_id WHERE parent.id IS NULL'),
      pool.query<CountRow>('SELECT count(*)::text AS count FROM schema_migrations'),
    ]);
    const target = { tnCandidates: count(tnCandidates), existingPinpinMappings: count(pinpinRefs), duplicateRefs: count(duplicateRefs), externalMultiMap: count(externalMultiMap), candidateMultiMap: count(candidateMultiMap), orphanWork: count(orphanWork), orphanEducation: count(orphanEducation), orphanDocuments: count(orphanDocuments), migrations: count(migrations) };
    const pass = source.totalCandidates >= 7 && source.activeCandidates + source.inactiveCandidates === source.totalCandidates && target.duplicateRefs === 0 && target.externalMultiMap === 0 && target.candidateMultiMap === 0 && target.orphanWork === 0 && target.orphanEducation === 0 && target.orphanDocuments === 0 && target.migrations === 1;
    process.stdout.write(`${JSON.stringify({ source, target, expectedNewMappings: source.totalCandidates - target.existingPinpinMappings, pass })}\n`);
    if (!pass) process.exitCode = 2;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    const category = message.includes('permission') || message.includes('denied') ? 'permission'
      : message.includes('connection') || message.includes('driver') || message.includes('odbc') ? 'transport'
        : message.includes('aggregate') || message.includes('pagination') || message.includes('source') ? 'source-contract' : 'target-contract';
    const errorCode = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null;
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    process.stderr.write(`${JSON.stringify({ phase: '4D', status: 'preflight-failed', stage, category, errorName, errorCode })}\n`);
    process.exitCode = 1;
  } finally {
    await adapter.close();
    await pool.end();
  }
}

main().catch(() => { process.stderr.write('{"phase":"4D","status":"preflight-failed","stage":"bootstrap","category":"unknown"}\n'); process.exitCode = 1; });
