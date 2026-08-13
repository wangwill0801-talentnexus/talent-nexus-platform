import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { PinpinSourceAdapter } from '../pinpin/source-adapter.js';
import { CandidateEnrichmentService, type StoreCandidateEnrichmentInput } from './candidate-enrichment-service.js';

const approvedExternalCandidateIds = new Set(['43198', '43219']);
const approvedExternalCandidateId = process.argv[2] ?? '';
if (!approvedExternalCandidateIds.has(approvedExternalCandidateId)) {
  throw new Error('This controlled verifier is restricted to the approved candidate.');
}

if (process.env.TN_ENV === 'production') {
  process.loadEnvFile('E:\\TalentNexus\\config\\pinpin-source.env');
}

const pool = createPool(loadConfig().databaseUrl);
const counts = async (candidateId: string, snapshotId: string) => {
  const result = await pool.query<Record<string, string>>(`
    SELECT
      (SELECT count(*)::text FROM candidate_external_refs WHERE candidate_id=$1) AS external_refs,
      (SELECT count(*)::text FROM candidate_work_experiences WHERE candidate_id=$1) AS baseline_work,
      (SELECT count(*)::text FROM candidate_educations WHERE candidate_id=$1) AS baseline_education,
      (SELECT count(*)::text FROM candidate_documents WHERE candidate_id=$1) AS baseline_documents,
      (SELECT count(*)::text FROM candidate_enrichment_snapshots WHERE candidate_id=$1) AS snapshots,
      (SELECT count(*)::text FROM candidate_ai_profiles WHERE candidate_id=$1 AND enrichment_snapshot_id=$2) AS ai_profiles,
      (SELECT count(*)::text FROM candidate_ai_work_experiences WHERE candidate_id=$1 AND enrichment_snapshot_id=$2) AS ai_work,
      (SELECT count(*)::text FROM candidate_ai_educations WHERE candidate_id=$1 AND enrichment_snapshot_id=$2) AS ai_education,
      (SELECT count(*)::text FROM candidate_ai_terms WHERE candidate_id=$1 AND enrichment_snapshot_id=$2) AS ai_terms,
      (SELECT count(*)::text FROM candidate_resume_evidence WHERE candidate_id=$1 AND enrichment_snapshot_id=$2) AS evidence,
      (SELECT count(*)::text FROM candidate_processing_state WHERE candidate_id=$1 AND latest_snapshot_id=$2 AND status='completed') AS processing_completed,
      (SELECT count(*)::text FROM candidate_external_refs GROUP BY source_instance_id,external_candidate_id HAVING count(*) > 1 LIMIT 1) AS duplicate_external_refs,
      (SELECT count(*)::text FROM candidate_work_experiences work LEFT JOIN candidates candidate ON candidate.id=work.candidate_id WHERE candidate.id IS NULL) AS orphan_work,
      (SELECT count(*)::text FROM candidate_educations education LEFT JOIN candidates candidate ON candidate.id=education.candidate_id WHERE candidate.id IS NULL) AS orphan_education,
      (SELECT count(*)::text FROM candidate_documents document LEFT JOIN candidates candidate ON candidate.id=document.candidate_id WHERE candidate.id IS NULL) AS orphan_documents`, [candidateId, snapshotId]);
  return result.rows[0]!;
};

let source: PinpinSourceAdapter | null = null;
try {
  const resolved = await pool.query<Record<string, unknown>>(`
    SELECT candidate.id AS candidate_id, candidate.candidate_code,
      snapshot.id AS snapshot_id, snapshot.schema_version, snapshot.source_kind,
      snapshot.source_system, snapshot.source_reference, snapshot.source_url,
      snapshot.source_captured_at, snapshot.plugin_version, snapshot.parser_version,
      snapshot.ai_provider, snapshot.ai_model, snapshot.ats_saved_at,
      snapshot.source_created_at, snapshot.source_updated_at,
      snapshot.evidence_metadata, snapshot.payload, snapshot.correlation_id
    FROM candidate_external_refs external_ref
    JOIN source_instances source_instance ON source_instance.id=external_ref.source_instance_id
    JOIN candidates candidate ON candidate.id=external_ref.candidate_id
    JOIN LATERAL (
      SELECT * FROM candidate_enrichment_snapshots candidate_snapshot
      WHERE candidate_snapshot.candidate_id=candidate.id
      ORDER BY candidate_snapshot.created_at DESC,candidate_snapshot.id DESC LIMIT 1
    ) snapshot ON true
    WHERE source_instance.source_system='pinpin'
      AND external_ref.external_candidate_id=$1`, [approvedExternalCandidateId]);
  if (resolved.rowCount !== 1) throw new Error('Controlled candidate identity is missing or ambiguous.');
  const row = resolved.rows[0]!;
  const candidateId = String(row.candidate_id);
  const snapshotId = String(row.snapshot_id);
  const before = await counts(candidateId, snapshotId);

  source = await PinpinSourceAdapter.connect();
  const sourceSnapshot = await source.readCandidate(Number(approvedExternalCandidateId));
  if (!sourceSnapshot) throw new Error('Controlled Pinpin source candidate is unavailable.');
  const sourceCounts = {
    work: sourceSnapshot.workExperiences.length,
    education: sourceSnapshot.educations.length,
    documents: sourceSnapshot.documents.length
  };

  const metadata = (row.evidence_metadata ?? {}) as Record<string, unknown>;
  const iso = (value: unknown): string | null => value == null ? null : new Date(String(value)).toISOString();
  const input: StoreCandidateEnrichmentInput = {
    candidateId,
    source: {
      kind: String(row.source_kind),
      system: row.source_system as string | null,
      reference: row.source_reference as string | null,
      url: row.source_url as string | null,
      capturedAt: iso(row.source_captured_at),
      createdAt: iso(row.source_created_at),
      updatedAt: iso(row.source_updated_at),
      attachmentName: metadata.attachmentName as string | null,
      attachmentType: metadata.attachmentType as string | null,
      attachmentReference: metadata.attachmentReference as string | null,
      contentSha256: metadata.contentSha256 as string | null
    },
    pluginVersion: row.plugin_version as string | null,
    parserVersion: row.parser_version as string | null,
    atsSavedAt: iso(row.ats_saved_at),
    aiMetadata: { provider: row.ai_provider as string | null, model: row.ai_model as string | null },
    correlationId: row.correlation_id as string | null,
    payload: row.payload
  };
  const service = new CandidateEnrichmentService(pool);
  const first = await service.storeCandidateEnrichment(input);
  const afterFirst = await counts(candidateId, snapshotId);
  const second = await service.storeCandidateEnrichment(input);
  const afterSecond = await counts(candidateId, snapshotId);

  const identityStable = first.snapshot.id === snapshotId && second.snapshot.id === snapshotId;
  const baselineStable = before.external_refs === afterSecond.external_refs
    && before.baseline_work === afterSecond.baseline_work
    && before.baseline_education === afterSecond.baseline_education
    && before.baseline_documents === afterSecond.baseline_documents;
  const sourceCountsMatch = Number(afterSecond.baseline_work) === sourceCounts.work
    && Number(afterSecond.baseline_education) === sourceCounts.education
    && Number(afterSecond.baseline_documents) === sourceCounts.documents;
  const result = {
    externalCandidateId: approvedExternalCandidateId,
    candidateIdentityStable: identityStable,
    candidateCodeStable: Boolean(row.candidate_code),
    sourceReadOnlyBaselineCountsMatch: sourceCountsMatch,
    replay1: first.status,
    replay2: second.status,
    snapshotCountBefore: Number(before.snapshots),
    snapshotCountAfter: Number(afterSecond.snapshots),
    baselineStable,
    projectionCountsBefore: {
      profile: Number(before.ai_profiles), work: Number(before.ai_work),
      education: Number(before.ai_education), terms: Number(before.ai_terms),
      evidence: Number(before.evidence), processingCompleted: Number(before.processing_completed)
    },
    projectionCounts: {
      profile: Number(afterSecond.ai_profiles), work: Number(afterSecond.ai_work),
      education: Number(afterSecond.ai_education), terms: Number(afterSecond.ai_terms),
      evidence: Number(afterSecond.evidence), processingCompleted: Number(afterSecond.processing_completed)
    },
    duplicateExternalRefs: Number(afterSecond.duplicate_external_refs ?? 0),
    orphans: {
      work: Number(afterSecond.orphan_work), education: Number(afterSecond.orphan_education),
      documents: Number(afterSecond.orphan_documents)
    },
    secondRunNoOp: second.status === 'unchanged' && identityStable
      && afterFirst.snapshots === afterSecond.snapshots
      && JSON.stringify(afterFirst) === JSON.stringify(afterSecond)
  };
  console.log(JSON.stringify(result));
} finally {
  await source?.close();
  await pool.end();
}
