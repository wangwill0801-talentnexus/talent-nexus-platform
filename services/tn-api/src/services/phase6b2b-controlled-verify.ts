import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';

// Read-only verifier for explicitly approved Phase 6B.2B test IDs. It emits
// no candidate names, contact details, source URLs, resume payloads, tokens,
// or database configuration.
const suppliedIds = process.argv.slice(2);
if (suppliedIds.length === 0 || suppliedIds.some((id) => !/^\d+$/.test(id))) {
  throw new Error('Provide one or more numeric, explicitly approved Pinpin candidate IDs.');
}
const approvedIds = [...new Set(suppliedIds)];
const config = loadConfig();
const pool = createPool(config.databaseUrl);

try {
  const result = await pool.query<{
    external_candidate_id: string;
    reference_count: string;
    snapshot_count: string;
    latest_plugin_version: string | null;
    latest_source_kind: string | null;
  }>(`
    SELECT ref.external_candidate_id,
           count(DISTINCT ref.id)::text AS reference_count,
           count(DISTINCT snapshot.id)::text AS snapshot_count,
           max(snapshot.plugin_version) AS latest_plugin_version,
           max(snapshot.source_kind) AS latest_source_kind
    FROM candidate_external_refs ref
    LEFT JOIN candidate_enrichment_snapshots snapshot ON snapshot.candidate_id = ref.candidate_id
    WHERE ref.external_candidate_id = ANY($1::text[])
    GROUP BY ref.external_candidate_id
    ORDER BY ref.external_candidate_id
  `, [approvedIds]);
  const byId = new Map(result.rows.map((row) => [row.external_candidate_id, row]));
  const report = approvedIds.map((externalCandidateId) => {
    const row = byId.get(externalCandidateId);
    return {
      externalCandidateId,
      baselinePresent: Boolean(row),
      externalReferenceCount: row ? Number(row.reference_count) : 0,
      enrichmentSnapshotCount: row ? Number(row.snapshot_count) : 0,
      latestPluginVersion: row?.latest_plugin_version ?? null,
      latestSourceKind: row?.latest_source_kind ?? null
    };
  });
  const duplicate = await pool.query<{ duplicate_count: string }>(`
    SELECT count(*)::text AS duplicate_count
    FROM (
      SELECT source_instance_id, external_candidate_id
      FROM candidate_external_refs
      WHERE external_candidate_id = ANY($1::text[])
      GROUP BY source_instance_id, external_candidate_id
      HAVING count(*) > 1
    ) duplicate_refs
  `, [approvedIds]);
  console.log(JSON.stringify({ approvedIds: report, duplicateExternalRefs: Number(duplicate.rows[0]?.duplicate_count ?? 0) }));
} finally {
  await pool.end();
}
