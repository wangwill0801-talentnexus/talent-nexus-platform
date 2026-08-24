import type { DatabasePool } from '../db/pool.js';
import { choosePreferredResume, toPinpinAttachmentMetadata, type PinpinAttachmentMetadata } from '../pinpin/attachment-metadata.js';
import { PinpinBlobReadError, type PinpinBlobAttachment, type PinpinBlobAttachmentReader } from '../pinpin/blob-adapter.js';
import { extractResumeText, ResumeTextExtractionError } from '../pinpin/resume-text-extractor.js';
import type { PinpinCandidateSnapshot } from '../pinpin/source-adapter.js';
import type { HistoricalEvidenceIntakeService, HistoricalEvidenceIntakeResult } from './historical-evidence-intake-service.js';

export type PinpinBlobMetadataReader = { readCandidate(externalCandidateId: number): Promise<PinpinCandidateSnapshot | null> };
export type PinpinBlobReaderFactory = () => Promise<PinpinBlobAttachmentReader>;

export type PinpinBlobEvidenceResult = {
  status: 'created' | 'unchanged';
  atsCandidateId: string;
  attachment: PinpinAttachmentMetadata;
  actualBlobBytes: number;
  declaredSizeBytes: number | null;
  declaredSizeMatches: boolean | null;
  rawSha256: string;
  normalizedTextCharacters: number;
  contentSha256: string;
  evidenceId: string;
  snapshotId: string | null;
  processingStatus: 'queued' | 'completed';
};

export class PinpinBlobEvidenceError extends Error {
  constructor(readonly code: 'BLOB_CANDIDATE_NOT_FOUND' | 'BLOB_IDENTITY_CONFLICT' | 'BLOB_NO_RESUME' | 'BLOB_READ_REJECTED' | 'BLOB_TEXT_UNAVAILABLE' | 'BLOB_INTAKE_REJECTED') { super(code); }
}

type CandidateRefRow = { candidate_id: string };

function numeric(value: string): boolean { return /^\d{1,18}$/.test(value); }

function sourceKind(extension: string | null): 'docx' | 'pdf' | 'html' {
  if (extension === 'docx') return 'docx';
  if (extension === 'pdf') return 'pdf';
  return 'html';
}

function iso(value: string | null): string {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function attachments(candidate: PinpinCandidateSnapshot): PinpinAttachmentMetadata[] {
  return candidate.documents
    .filter((row) => /^\d{1,18}$/.test(row.externalDocumentId))
    .map((row) => toPinpinAttachmentMetadata({
      candidateId: candidate.externalCandidateId,
      attachmentId: row.externalDocumentId,
      filename: row.originalFilename,
      sizeBytes: row.fileSizeBytes,
      createdAt: row.sourceCreatedAt
    }));
}

export class PinpinBlobEvidenceService {
  constructor(
    private readonly database: DatabasePool,
    private readonly sourceReader: PinpinBlobMetadataReader,
    private readonly blobReaderFactory: PinpinBlobReaderFactory,
    private readonly intake: Pick<HistoricalEvidenceIntakeService, 'intake'>
  ) {}

  async ingestBestResume(identifier: string): Promise<PinpinBlobEvidenceResult> {
    const atsCandidateId = String(identifier ?? '').trim();
    if (!numeric(atsCandidateId)) throw new PinpinBlobEvidenceError('BLOB_CANDIDATE_NOT_FOUND');
    const refs = await this.database.query<CandidateRefRow>(`
      SELECT r.candidate_id
      FROM candidate_external_refs r
      JOIN source_instances s ON s.id=r.source_instance_id
      WHERE s.source_system='pinpin' AND s.instance_key='pinpin-prod' AND r.external_candidate_id=$1
      LIMIT 2`, [atsCandidateId]);
    if (refs.rows.length === 0) throw new PinpinBlobEvidenceError('BLOB_CANDIDATE_NOT_FOUND');
    if (refs.rows.length !== 1) throw new PinpinBlobEvidenceError('BLOB_IDENTITY_CONFLICT');
    const candidate = await this.sourceReader.readCandidate(Number(atsCandidateId));
    if (!candidate || candidate.externalCandidateId !== atsCandidateId) throw new PinpinBlobEvidenceError('BLOB_CANDIDATE_NOT_FOUND');
    const selected = choosePreferredResume(attachments(candidate));
    if (selected.status === 'none') throw new PinpinBlobEvidenceError('BLOB_NO_RESUME');
    if (selected.status !== 'selected' || !selected.attachment) throw new PinpinBlobEvidenceError('BLOB_IDENTITY_CONFLICT');
    const attachment = selected.attachment;
    let blob: PinpinBlobAttachment;
    const reader = await this.blobReaderFactory();
    try {
      blob = await reader.readAttachmentContent({ atsCandidateId, attachmentId: attachment.attachmentId });
    } catch (error) {
      if (error instanceof PinpinBlobReadError) throw new PinpinBlobEvidenceError('BLOB_READ_REJECTED');
      throw error;
    } finally {
      await reader.close();
    }
    let extracted: ReturnType<typeof extractResumeText>;
    try { extracted = extractResumeText(blob.content, blob.extension); } catch (error) {
      if (error instanceof ResumeTextExtractionError) throw new PinpinBlobEvidenceError('BLOB_TEXT_UNAVAILABLE');
      throw error;
    }
    let result: HistoricalEvidenceIntakeResult;
    try {
      result = await this.intake.intake({
        contractVersion: 'candidate_evidence_intake_v1',
        candidateRef: { sourceSystem: 'pinpin', sourceInstance: 'pinpin-prod', externalCandidateId: atsCandidateId },
        source: {
          sourceKind: sourceKind(blob.extension), sourceSystem: 'pinpin', sourceReference: blob.fileRef, sourceUrl: null,
          sourceCapturedAt: iso(blob.sourceCreatedAt), attachmentName: blob.filename, attachmentType: blob.mimeType, attachmentReference: blob.fileRef
        },
        capture: { method: 'approved_frozen_capture', connectorVersion: 'tn-pinpin-blob-v1', extractorVersion: extracted.extractorVersion, normalizationVersion: 'tn-text-nfkc-v1' },
        representation: { kind: extracted.representationKind, text: extracted.text },
        ai: {}, correlationId: `pinpin-blob:${atsCandidateId}:${blob.attachmentId}`, resume: null
      });
    } catch {
      throw new PinpinBlobEvidenceError('BLOB_INTAKE_REJECTED');
    }
    return {
      status: result.status,
      atsCandidateId,
      attachment,
      actualBlobBytes: blob.actualSizeBytes,
      declaredSizeBytes: blob.declaredSizeBytes,
      declaredSizeMatches: blob.declaredSizeMatches,
      rawSha256: blob.sha256,
      normalizedTextCharacters: extracted.text.length,
      contentSha256: result.contentSha256,
      evidenceId: result.evidenceId,
      snapshotId: result.snapshotId,
      processingStatus: result.processingStatus
    };
  }
}

