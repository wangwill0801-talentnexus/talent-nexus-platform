import type { DatabasePool } from '../db/pool.js';
import { choosePreferredResume, toPinpinAttachmentMetadata, type PinpinAttachmentMetadata } from '../pinpin/attachment-metadata.js';

export type EvidenceRequestResult = {
  status: 'evidence_required' | 'already_latest' | 'needs_review' | 'not_found';
  atsCandidateId: string;
  attachment: PinpinAttachmentMetadata | null;
  reason?: string;
};

type CandidateRefRow = { candidate_id: string };
type DocumentRow = { external_document_id: string | null; original_filename: string | null; file_extension: string | null; file_size_bytes: string | number | null; source_created_at: Date | string | null };

function numericId(value: string): boolean { return /^\d{1,18}$/.test(value); }
function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export class PinpinEvidenceRequestService {
  constructor(private readonly database: DatabasePool) {}

  async resolve(identifier: string): Promise<EvidenceRequestResult | null> {
    const atsCandidateId = String(identifier ?? '').trim();
    if (!numericId(atsCandidateId)) return null;
    const refs = await this.database.query<CandidateRefRow>(`
      SELECT r.candidate_id
      FROM candidate_external_refs r
      JOIN source_instances s ON s.id=r.source_instance_id
      WHERE s.source_system='pinpin' AND s.instance_key='pinpin-prod' AND r.external_candidate_id=$1
      LIMIT 2
    `, [atsCandidateId]);
    if (refs.rows.length !== 1) return refs.rows.length === 0 ? null : { status: 'needs_review', atsCandidateId, attachment: null, reason: 'ambiguous-candidate-identity' };
    const candidateId = refs.rows[0]!.candidate_id;
    const docs = await this.database.query<DocumentRow>(`
      SELECT d.external_document_id,d.original_filename,d.file_extension,d.file_size_bytes,d.source_created_at
      FROM candidate_documents d
      JOIN source_instances s ON s.id=d.source_instance_id
      WHERE d.candidate_id=$1 AND s.source_system='pinpin' AND s.instance_key='pinpin-prod'
      ORDER BY source_created_at DESC NULLS LAST, first_seen_at DESC NULLS LAST, external_document_id
    `, [candidateId]);
    const attachments = docs.rows.filter((row) => row.external_document_id && /^\d{1,18}$/.test(row.external_document_id)).map((row) => toPinpinAttachmentMetadata({
      candidateId: atsCandidateId,
      attachmentId: row.external_document_id!,
      filename: row.original_filename,
      sizeBytes: row.file_size_bytes == null ? null : Number(row.file_size_bytes),
      createdAt: iso(row.source_created_at)
    }));
    const selected = choosePreferredResume(attachments);
    if (selected.status === 'none') return { status: 'needs_review', atsCandidateId, attachment: null, reason: 'no-resume-attachment' };
    if (selected.status === 'needs_review') return { status: 'needs_review', atsCandidateId, attachment: null, reason: 'ambiguous-resume-attachments' };
    const attachment = selected.attachment!;
    const evidence = await this.database.query<{ id: string }>(`
      SELECT id
      FROM candidate_resume_evidence
      WHERE candidate_id=$1
        AND attachment_reference=$2
        AND content_sha256 IS NOT NULL
        AND representation_kind <> 'metadata_only'
      LIMIT 1
    `, [candidateId, attachment.fileRef]);
    return { status: evidence.rows.length ? 'already_latest' : 'evidence_required', atsCandidateId, attachment };
  }
}
