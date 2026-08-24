import type { DatabasePool } from '../db/pool.js';

export type HistoricalEvidencePilotReason =
  | 'eligible'
  | 'inactive'
  | 'ambiguous_identity'
  | 'identity_not_numeric'
  | 'no_evidence'
  | 'ambiguous_evidence'
  | 'evidence_not_content_backed'
  | 'evidence_fingerprint_missing'
  | 'evidence_source_missing'
  | 'extraction_missing'
  | 'extraction_mismatch'
  | 'processing_pending'
  | 'processing_failed'
  | 'processing_needs_review';

export type HistoricalEvidencePilotAssessment = {
  candidateId: string;
  atsCandidateId: string | null;
  eligible: boolean;
  reason: HistoricalEvidencePilotReason;
  evidenceCount: number;
  contentBackedEvidenceCount: number;
  extractionCount: number;
  snapshotCount: number;
  latestSnapshotSchemaVersion: string | null;
  latestProcessingStatus: string | null;
  latestProcessingErrorCode: string | null;
  duplicateCounts: {
    evidenceIdentity: number;
    extractionIdentity: number;
    processingJobIdentity: number;
    snapshotIdentity: number;
  };
};

export type HistoricalEvidencePilotReport = {
  observed: number;
  eligible: number;
  selected: number;
  selectedAtsCandidateIds: string[];
  reasons: Record<HistoricalEvidencePilotReason, number>;
  duplicateGroups: number;
  items: HistoricalEvidencePilotAssessment[];
  secondRunNoOp: 'not_run';
};

type CandidateRefRow = {
  candidate_id: string;
  canonical_status: string;
  ref_count: string | number;
  distinct_external_ref_count: string | number;
  ats_candidate_id: string | null;
};

type EvidenceRow = {
  id: string;
  content_sha256: string | null;
  evidence_fingerprint: string | null;
  evidence_identity_key: string | null;
  source_reference: string | null;
  source_url: string | null;
  attachment_reference: string | null;
  representation_kind: string;
  processing_eligible: boolean;
  hash_algorithm: string | null;
  normalization_version: string | null;
  capture_method: string | null;
  extractor_version: string | null;
};

type ExtractionRow = {
  evidence_id: string;
  extractor_version: string;
  content_sha256: string;
  representation_kind: string;
  character_count: number | string | null;
  status: string;
};

type SnapshotRow = { schema_version: string; created_at: string };
type ProcessingRow = { status: string; last_error_code: string | null };

const hashPattern = /^[0-9a-f]{64}$/i;
const supportedRepresentations = new Set(['connector_text', 'connector_html', 'local_file_text']);

function compareNumericIds(left: string, right: string): number {
  try {
    const leftValue = BigInt(left);
    const rightValue = BigInt(right);
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  } catch {
    return left.localeCompare(right);
  }
}

function asNumber(value: string | number | null | undefined): number {
  return Number(value ?? 0);
}

function asCountMap(reason: HistoricalEvidencePilotReason): Record<HistoricalEvidencePilotReason, number> {
  return {
    eligible: reason === 'eligible' ? 1 : 0,
    inactive: reason === 'inactive' ? 1 : 0,
    ambiguous_identity: reason === 'ambiguous_identity' ? 1 : 0,
    identity_not_numeric: reason === 'identity_not_numeric' ? 1 : 0,
    no_evidence: reason === 'no_evidence' ? 1 : 0,
    ambiguous_evidence: reason === 'ambiguous_evidence' ? 1 : 0,
    evidence_not_content_backed: reason === 'evidence_not_content_backed' ? 1 : 0,
    evidence_fingerprint_missing: reason === 'evidence_fingerprint_missing' ? 1 : 0,
    evidence_source_missing: reason === 'evidence_source_missing' ? 1 : 0,
    extraction_missing: reason === 'extraction_missing' ? 1 : 0,
    extraction_mismatch: reason === 'extraction_mismatch' ? 1 : 0,
    processing_pending: reason === 'processing_pending' ? 1 : 0,
    processing_failed: reason === 'processing_failed' ? 1 : 0,
    processing_needs_review: reason === 'processing_needs_review' ? 1 : 0
  };
}

function mergeCounts(target: Record<HistoricalEvidencePilotReason, number>, source: Record<HistoricalEvidencePilotReason, number>): void {
  for (const key of Object.keys(target) as HistoricalEvidencePilotReason[]) target[key] += source[key];
}

function emptyReasonCounts(): Record<HistoricalEvidencePilotReason, number> {
  const counts = asCountMap('eligible');
  for (const key of Object.keys(counts) as HistoricalEvidencePilotReason[]) counts[key] = 0;
  return counts;
}

/**
 * Deterministic, fail-closed cohort ordering. This function only receives
 * sanitized metadata and never reads or ranks by candidate PII.
 */
export function selectHistoricalEvidencePilotCohort(items: HistoricalEvidencePilotAssessment[], limit = 10): HistoricalEvidencePilotAssessment[] {
  const boundedLimit = Math.max(1, Math.min(20, Math.trunc(limit)));
  return items
    .filter((item) => item.eligible && item.atsCandidateId !== null)
    .sort((left, right) => {
      const idOrder = compareNumericIds(left.atsCandidateId!, right.atsCandidateId!);
      return idOrder !== 0 ? idOrder : left.candidateId.localeCompare(right.candidateId);
    })
    .slice(0, boundedLimit);
}

export class HistoricalEvidencePilotService {
  constructor(private readonly database: DatabasePool) {}

  /**
   * Read-only metadata assessment. It deliberately excludes display name,
   * email, phone, resume text, JSON payloads and binary attachment content.
   */
  async dryRun(limit = 10): Promise<HistoricalEvidencePilotReport> {
    const refs = await this.database.query<CandidateRefRow>(`
      SELECT c.id AS candidate_id, c.canonical_status,
             COUNT(reference.id)::int AS ref_count,
             COUNT(DISTINCT reference.external_candidate_id)::int AS distinct_external_ref_count,
             MIN(reference.external_candidate_id) AS ats_candidate_id
      FROM candidates c
      JOIN candidate_external_refs reference ON reference.candidate_id = c.id
      JOIN source_instances source ON source.id = reference.source_instance_id
      WHERE source.source_system = 'pinpin' AND source.instance_key = 'pinpin-prod'
      GROUP BY c.id, c.canonical_status
      ORDER BY c.id
    `);

    const items: HistoricalEvidencePilotAssessment[] = [];
    for (const ref of refs.rows) items.push(await this.assess(ref));
    const selected = selectHistoricalEvidencePilotCohort(items, limit);
    const reasons = emptyReasonCounts();
    for (const item of items) mergeCounts(reasons, asCountMap(item.reason));
    const duplicateGroups = items.reduce((sum, item) => sum + Object.values(item.duplicateCounts).reduce((inner, count) => inner + count, 0), 0);
    return {
      observed: items.length,
      eligible: items.filter((item) => item.eligible).length,
      selected: selected.length,
      selectedAtsCandidateIds: selected.map((item) => item.atsCandidateId!).sort(compareNumericIds),
      reasons,
      duplicateGroups,
      items,
      secondRunNoOp: 'not_run'
    };
  }

  private async assess(ref: CandidateRefRow): Promise<HistoricalEvidencePilotAssessment> {
    const evidence = await this.database.query<EvidenceRow>(`
      SELECT id, content_sha256, evidence_fingerprint, evidence_identity_key,
             source_reference, source_url, attachment_reference, representation_kind,
             processing_eligible, hash_algorithm, normalization_version,
             capture_method, extractor_version
      FROM candidate_resume_evidence
      WHERE candidate_id = $1
      ORDER BY created_at DESC, id DESC
    `, [ref.candidate_id]);
    const snapshots = await this.database.query<SnapshotRow>(`
      SELECT schema_version, created_at
      FROM candidate_enrichment_snapshots
      WHERE candidate_id = $1
      ORDER BY created_at DESC, id DESC
    `, [ref.candidate_id]);
    const state = await this.database.query<ProcessingRow>(`
      SELECT status, last_error_code
      FROM candidate_processing_state
      WHERE candidate_id = $1
    `, [ref.candidate_id]);
    const latestState = state.rows[0] ?? null;
    const extractions = evidence.rows.length === 0
      ? []
      : (await this.database.query<ExtractionRow>(`
          SELECT evidence_id, extractor_version, content_sha256,
                 representation_kind, character_count, status
          FROM candidate_evidence_extractions
          WHERE candidate_id = $1
        `, [ref.candidate_id])).rows;
    const contentBacked = evidence.rows.filter((row) => row.processing_eligible && supportedRepresentations.has(row.representation_kind));
    const duplicateCounts = await this.duplicateCounts(ref.candidate_id);
    let reason: HistoricalEvidencePilotReason = 'eligible';
    if (ref.canonical_status === 'inactive' || ref.canonical_status === 'archived') reason = 'inactive';
    else if (asNumber(ref.ref_count) !== 1 || asNumber(ref.distinct_external_ref_count) !== 1) reason = 'ambiguous_identity';
    else if (!ref.ats_candidate_id || !/^\d{1,18}$/.test(ref.ats_candidate_id)) reason = 'identity_not_numeric';
    else if (evidence.rows.length === 0) reason = 'no_evidence';
    else if (contentBacked.length === 0) reason = 'evidence_not_content_backed';
    else if (contentBacked.length > 1) reason = 'ambiguous_evidence';
    else if (!hashPattern.test(contentBacked[0]!.content_sha256 ?? '') || !hashPattern.test(contentBacked[0]!.evidence_fingerprint ?? '') || !hashPattern.test(contentBacked[0]!.evidence_identity_key ?? '')) reason = 'evidence_fingerprint_missing';
    else if (!contentBacked[0]!.source_reference && !contentBacked[0]!.source_url && !contentBacked[0]!.attachment_reference) reason = 'evidence_source_missing';
    else {
      const selected = contentBacked[0]!;
      const matchingExtractions = extractions.filter((row) => row.evidence_id === selected.id);
      if (matchingExtractions.length === 0) reason = 'extraction_missing';
      else if (!matchingExtractions.some((row) => row.status === 'available' && Number(row.character_count ?? 0) > 0 && row.content_sha256.toLowerCase() === selected.content_sha256!.toLowerCase() && row.extractor_version === selected.extractor_version && row.representation_kind === selected.representation_kind)) reason = 'extraction_mismatch';
      else if (latestState?.status === 'failed' || latestState?.status === 'dead_letter') reason = 'processing_failed';
      else if (latestState?.status === 'needs_review') reason = 'processing_needs_review';
      else if (latestState && ['queued', 'processing', 'retry_scheduled'].includes(latestState.status)) reason = 'processing_pending';
    }
    return {
      candidateId: ref.candidate_id,
      atsCandidateId: ref.ats_candidate_id,
      eligible: reason === 'eligible',
      reason,
      evidenceCount: evidence.rows.length,
      contentBackedEvidenceCount: contentBacked.length,
      extractionCount: extractions.length,
      snapshotCount: snapshots.rows.length,
      latestSnapshotSchemaVersion: snapshots.rows[0]?.schema_version ?? null,
      latestProcessingStatus: latestState?.status ?? null,
      latestProcessingErrorCode: latestState?.last_error_code ?? null,
      duplicateCounts
    };
  }

  private async duplicateCounts(candidateId: string): Promise<HistoricalEvidencePilotAssessment['duplicateCounts']> {
    const duplicateGroups = async (sql: string, key: (row: Record<string, unknown>) => string): Promise<number> => {
      const rows = (await this.database.query<Record<string, unknown>>(sql, [candidateId])).rows;
      const counts = new Map<string, number>();
      for (const row of rows) {
        const value = key(row);
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return [...counts.values()].filter((count) => count > 1).length;
    };
    return {
      evidenceIdentity: await duplicateGroups(`SELECT evidence_identity_key FROM candidate_resume_evidence WHERE candidate_id=$1 AND evidence_identity_key IS NOT NULL`, (row) => String(row.evidence_identity_key)),
      extractionIdentity: await duplicateGroups(`SELECT evidence_id,extractor_version,content_sha256 FROM candidate_evidence_extractions WHERE candidate_id=$1`, (row) => `${row.evidence_id}|${row.extractor_version}|${row.content_sha256}`),
      processingJobIdentity: await duplicateGroups(`SELECT idempotency_key FROM candidate_processing_jobs WHERE candidate_id=$1`, (row) => String(row.idempotency_key)),
      snapshotIdentity: await duplicateGroups(`SELECT schema_version,idempotency_key FROM candidate_enrichment_snapshots WHERE candidate_id=$1`, (row) => `${row.schema_version}|${row.idempotency_key}`)
    };
  }
}
