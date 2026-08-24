import { v7 as uuidv7 } from 'uuid';
import type { DatabasePool } from '../db/pool.js';
import {
  EVIDENCE_HASH_ALGORITHM,
  canonicalizeEvidenceUrl,
  evidenceContentSha256,
  evidenceIdentityKey,
  normalizeEvidenceText,
  type CandidateEvidenceIntakeV1
} from '../domain/evidence-intake.js';
import { processingIdempotencyKey } from '../domain/candidate-processing.js';
import { CandidateEnrichmentService } from './candidate-enrichment-service.js';

export type HistoricalEvidenceIntakeResult = {
  status: 'created' | 'unchanged';
  candidateId: string;
  evidenceId: string;
  contentSha256: string;
  snapshotId: string | null;
  processingStatus: 'completed' | 'queued';
};

export class HistoricalEvidenceIntakeError extends Error {
  constructor(readonly code: 'EVIDENCE_CANDIDATE_NOT_FOUND' | 'EVIDENCE_IDENTITY_CONFLICT' | 'EVIDENCE_INVALID_SOURCE' | 'EVIDENCE_HASH_MISMATCH' | 'EVIDENCE_INVALID_CONTENT') {
    super(code);
  }
}

type EvidenceRow = { id: string; enrichment_snapshot_id: string | null };

function canonicalSource(request: CandidateEvidenceIntakeV1): { sourceUrl: string | null; sourceReference: string | null } {
  const canonicalUrl = canonicalizeEvidenceUrl(request.source.sourceUrl);
  if (request.source.sourceKind === 'linkedin_public') {
    if (!canonicalUrl || !/^https:\/\/www\.linkedin\.com\/in\/[^/]+\/$/i.test(canonicalUrl)) throw new HistoricalEvidenceIntakeError('EVIDENCE_INVALID_SOURCE');
  }
  if (request.source.sourceKind === '104_resume') {
    if (!canonicalUrl || !/^https:\/\/www\.104\.com\.tw\//i.test(canonicalUrl)) throw new HistoricalEvidenceIntakeError('EVIDENCE_INVALID_SOURCE');
  }
  const sourceReference = request.source.sourceReference ?? canonicalUrl ?? request.source.attachmentReference ?? null;
  if (!sourceReference) throw new HistoricalEvidenceIntakeError('EVIDENCE_INVALID_SOURCE');
  return { sourceUrl: canonicalUrl, sourceReference };
}

export class HistoricalEvidenceIntakeService {
  private readonly enrichment: CandidateEnrichmentService;

  constructor(private readonly database: DatabasePool, enrichment = new CandidateEnrichmentService(database)) {
    this.enrichment = enrichment;
  }

  async intake(request: CandidateEvidenceIntakeV1): Promise<HistoricalEvidenceIntakeResult> {
    const match = await this.database.query<{ candidate_id: string }>(`
      SELECT reference.candidate_id
      FROM candidate_external_refs reference
      JOIN source_instances source ON source.id=reference.source_instance_id
      WHERE source.source_system=$1 AND source.instance_key=$2 AND reference.external_candidate_id=$3
      LIMIT 2
    `, [request.candidateRef.sourceSystem, request.candidateRef.sourceInstance, request.candidateRef.externalCandidateId]);
    if (match.rows.length === 0) throw new HistoricalEvidenceIntakeError('EVIDENCE_CANDIDATE_NOT_FOUND');
    if (match.rows.length !== 1) throw new HistoricalEvidenceIntakeError('EVIDENCE_IDENTITY_CONFLICT');
    const candidateId = match.rows[0]!.candidate_id;
    const normalizedText = normalizeEvidenceText(request.representation.text);
    if (!normalizedText) throw new HistoricalEvidenceIntakeError('EVIDENCE_INVALID_CONTENT');
    const contentSha256 = evidenceContentSha256(normalizedText);
    if (request.representation.contentSha256 && request.representation.contentSha256.toLowerCase() !== contentSha256) throw new HistoricalEvidenceIntakeError('EVIDENCE_HASH_MISMATCH');
    const canonical = canonicalSource(request);
    const identityKey = evidenceIdentityKey({
      sourceKind: request.source.sourceKind,
      sourceReference: canonical.sourceReference,
      sourceUrl: canonical.sourceUrl,
      attachmentReference: request.source.attachmentReference ?? null,
      contentSha256
    });
    const found = await this.database.query<EvidenceRow>('SELECT id,enrichment_snapshot_id FROM candidate_resume_evidence WHERE candidate_id=$1 AND evidence_identity_key=$2 LIMIT 2', [candidateId, identityKey]);
    if (found.rows.length > 1) throw new HistoricalEvidenceIntakeError('EVIDENCE_IDENTITY_CONFLICT');
    const prior = found.rows[0];
    if (prior?.enrichment_snapshot_id) {
      return { status: 'unchanged', candidateId, evidenceId: prior.id, contentSha256, snapshotId: prior.enrichment_snapshot_id, processingStatus: 'completed' };
    }
    if (request.resume) {
      const result = await this.enrichment.storeCandidateEnrichment({
        candidateId,
        existingEvidenceId: prior?.id ?? null,
        source: {
          kind: request.source.sourceKind,
          system: request.source.sourceSystem,
          reference: canonical.sourceReference,
          url: canonical.sourceUrl,
          capturedAt: request.source.sourceCapturedAt,
          attachmentName: request.source.attachmentName,
          attachmentType: request.source.attachmentType,
          attachmentReference: request.source.attachmentReference,
          contentSha256
        },
        pluginVersion: request.capture.connectorVersion,
        parserVersion: request.capture.extractorVersion,
        aiMetadata: request.ai,
        correlationId: request.correlationId,
        payload: request.resume,
        evidenceContent: {
          normalizedText,
          contentSha256,
          evidenceIdentityKey: identityKey,
          representationKind: request.representation.kind,
          extractorVersion: request.capture.extractorVersion,
          normalizationVersion: request.capture.normalizationVersion,
          captureMethod: request.capture.method,
          connectorVersion: request.capture.connectorVersion
        }
      });
      const evidence = await this.database.query<EvidenceRow>('SELECT id,enrichment_snapshot_id FROM candidate_resume_evidence WHERE candidate_id=$1 AND evidence_identity_key=$2', [candidateId, identityKey]);
      if (!evidence.rows[0]) throw new HistoricalEvidenceIntakeError('EVIDENCE_INVALID_CONTENT');
      return { status: prior ? 'unchanged' : result.status, candidateId, evidenceId: evidence.rows[0].id, contentSha256, snapshotId: result.snapshot.id, processingStatus: 'completed' };
    }
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const evidenceId = prior?.id ?? uuidv7();
      if (!prior) {
        await client.query(`INSERT INTO candidate_resume_evidence (id,candidate_id,enrichment_snapshot_id,source_type,source_system,source_reference,source_url,attachment_name,attachment_type,attachment_reference,content_sha256,evidence_fingerprint,extractor_version,representation_kind,processing_eligible,captured_at,evidence_identity_key,hash_algorithm,normalization_version,capture_method,connector_version) VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11,$12,true,$13::timestamptz,$14,$15,$16,$17,$18) ON CONFLICT DO NOTHING`,
          [evidenceId, candidateId, request.source.sourceKind, request.source.sourceSystem ?? null, canonical.sourceReference, canonical.sourceUrl, request.source.attachmentName ?? null, request.source.attachmentType ?? null, request.source.attachmentReference ?? null, contentSha256, request.capture.extractorVersion, request.representation.kind, request.source.sourceCapturedAt, identityKey, EVIDENCE_HASH_ALGORITHM, request.capture.normalizationVersion, request.capture.method, request.capture.connectorVersion ?? null]);
      }
      const selected = await client.query<EvidenceRow>('SELECT id,enrichment_snapshot_id FROM candidate_resume_evidence WHERE candidate_id=$1 AND evidence_identity_key=$2', [candidateId, identityKey]);
      if (!selected.rows[0]) throw new HistoricalEvidenceIntakeError('EVIDENCE_INVALID_CONTENT');
      const extractionId = uuidv7();
      await client.query(`INSERT INTO candidate_evidence_extractions (id,evidence_id,candidate_id,extractor_version,content_sha256,representation_kind,content_reference,character_count,status,normalization_version,normalized_text) VALUES ($1,$2,$3,$4,$5,$6,'inline:normalized_text',$7,'available',$8,$9) ON CONFLICT (evidence_id,extractor_version,content_sha256) DO NOTHING`,
        [extractionId, selected.rows[0].id, candidateId, request.capture.extractorVersion, contentSha256, request.representation.kind, normalizedText.length, request.capture.normalizationVersion, normalizedText]);
      const extraction = await client.query<{ id: string }>('SELECT id FROM candidate_evidence_extractions WHERE evidence_id=$1 AND extractor_version=$2 AND content_sha256=$3', [selected.rows[0].id, request.capture.extractorVersion, contentSha256]);
      const jobInput = { candidateId, evidenceId: selected.rows[0].id, extractionId: extraction.rows[0]!.id, operation: 'process_new_evidence' as const, evidenceFingerprint: contentSha256, extractorVersion: request.capture.extractorVersion, parserVersion: 'tn-standard-resume-worker-v1', schemaVersion: 'standard_resume_v1', aiProvider: 'gemini', requestedBy: 'historical_evidence_bridge', maxAttempts: 3 };
      const jobId = uuidv7();
      await client.query(`INSERT INTO candidate_processing_jobs (id,candidate_id,evidence_id,extraction_id,operation,status,max_attempts,evidence_fingerprint,extractor_version,parser_version,schema_version,ai_provider,idempotency_key,requested_by) VALUES ($1,$2,$3,$4,'process_new_evidence','queued',3,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (candidate_id,idempotency_key) DO NOTHING`,
        [jobId, candidateId, selected.rows[0].id, extraction.rows[0]!.id, contentSha256, request.capture.extractorVersion, jobInput.parserVersion, jobInput.schemaVersion, jobInput.aiProvider, processingIdempotencyKey(jobInput), jobInput.requestedBy]);
      const queuedJob = await client.query<{ id: string }>('SELECT id FROM candidate_processing_jobs WHERE candidate_id=$1 AND idempotency_key=$2', [candidateId, processingIdempotencyKey(jobInput)]);
      if (!queuedJob.rows[0]) throw new HistoricalEvidenceIntakeError('EVIDENCE_INVALID_CONTENT');
      await client.query(`INSERT INTO candidate_processing_state (candidate_id,status,latest_job_id,schema_version,parser_version,processor_version,updated_at) VALUES ($1,'queued',$2,'standard_resume_v1',$3,$3,now()) ON CONFLICT(candidate_id) DO UPDATE SET status=CASE WHEN candidate_processing_state.status='completed' THEN 'stale' ELSE 'queued' END,latest_job_id=$2,schema_version='standard_resume_v1',parser_version=$3,processor_version=$3,stale_reason=CASE WHEN candidate_processing_state.status='completed' THEN 'NEW_EVIDENCE' ELSE candidate_processing_state.stale_reason END,updated_at=now()`, [candidateId, queuedJob.rows[0].id, jobInput.parserVersion]);
      await client.query('COMMIT');
      return { status: prior ? 'unchanged' : 'created', candidateId, evidenceId: selected.rows[0].id, contentSha256, snapshotId: null, processingStatus: 'queued' };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* retain original */ }
      throw error;
    } finally { client.release(); }
  }
}
