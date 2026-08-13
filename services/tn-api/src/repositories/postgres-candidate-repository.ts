import { v7 as uuidv7 } from 'uuid';
import type { DatabasePool } from '../db/pool.js';
import type {
  CandidateDetail,
  CandidateListQuery,
  CandidateListResult,
  CandidateRepository,
  CandidateSummary,
  CandidateDocument,
  Education,
  ExternalReference,
  WorkExperience
} from '../domain/candidate.js';

type CandidateRow = {
  id: string;
  candidate_code: string;
  display_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  location_text: string | null;
  current_company: string | null;
  current_title: string | null;
  canonical_status: string;
  raw_source_metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

function asIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

function toSummary(row: CandidateRow): CandidateSummary {
  return {
    id: row.id,
    candidateCode: row.candidate_code,
    displayName: row.display_name,
    primaryEmail: row.primary_email,
    primaryPhone: row.primary_phone,
    locationText: row.location_text,
    currentCompany: row.current_company,
    currentTitle: row.current_title,
    canonicalStatus: row.canonical_status,
    createdAt: asIso(row.created_at) ?? '',
    updatedAt: asIso(row.updated_at) ?? ''
  };
}

function parseJson(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

export class PostgresCandidateRepository implements CandidateRepository {
  public constructor(private readonly db: DatabasePool) {}

  public async health(): Promise<void> {
    await this.db.query('SELECT 1');
  }

  public async list(query: CandidateListQuery): Promise<CandidateListResult> {
    const filters: string[] = [];
    const values: unknown[] = [];
    const contains = (column: string, value: string | undefined): void => {
      if (!value) return;
      values.push(`%${value}%`);
      filters.push(`${column} ILIKE $${values.length}`);
    };
    if (query.candidateCode) {
      values.push(query.candidateCode);
      filters.push(`candidate_code = $${values.length}`);
    }
    contains('display_name', query.name);
    contains('current_company', query.company);
    contains('current_title', query.title);
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    values.push(query.limit, query.offset);

    const dataResult = await this.db.query<CandidateRow>(`
      SELECT id, candidate_code, display_name, primary_email, primary_phone, location_text,
             current_company, current_title, canonical_status, raw_source_metadata, created_at, updated_at
      FROM candidates
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `, values);
    const totalResult = await this.db.query<{ total: string }>(`SELECT count(*)::text AS total FROM candidates ${whereClause}`, values.slice(0, -2));
    return {
      data: dataResult.rows.map(toSummary),
      total: Number(totalResult.rows[0]?.total ?? '0')
    };
  }

  public async findByIdOrCode(idOrCode: string): Promise<CandidateDetail | null> {
    const candidateResult = await this.db.query<CandidateRow>(`
      SELECT id, candidate_code, display_name, primary_email, primary_phone, location_text,
             current_company, current_title, canonical_status, raw_source_metadata, created_at, updated_at
      FROM candidates WHERE id::text = $1 OR candidate_code = $1 LIMIT 1
    `, [idOrCode]);
    const candidate = candidateResult.rows[0];
    if (!candidate) return null;
    const candidateId = candidate.id;
    const [references, work, education, documents, tags] = await Promise.all([
      this.db.query<{
        id: string; source_instance_id: string; external_candidate_id: string; external_url: string | null;
        source_active: boolean; source_deleted_at: Date | null; first_seen_at: Date; last_seen_at: Date; metadata: unknown;
      }>('SELECT id, source_instance_id, external_candidate_id, external_url, source_active, source_deleted_at, first_seen_at, last_seen_at, metadata FROM candidate_external_refs WHERE candidate_id = $1 ORDER BY first_seen_at', [candidateId]),
      this.db.query<{
        id: string; source_instance_id: string | null; source_record_id: string | null; company_name: string | null;
        job_title: string | null; department: string | null; industry_raw: string | null; start_date: string | null;
        end_date: string | null; is_current: boolean; description: string | null; display_order: number | null;
      }>('SELECT id, source_instance_id, source_record_id, company_name, job_title, department, industry_raw, start_date, end_date, is_current, description, display_order FROM candidate_work_experiences WHERE candidate_id = $1 ORDER BY display_order NULLS LAST, start_date DESC NULLS LAST', [candidateId]),
      this.db.query<{
        id: string; source_instance_id: string | null; source_record_id: string | null; school_name: string | null;
        degree_raw: string | null; major_raw: string | null; start_date: string | null; end_date: string | null;
        is_current: boolean | null; display_order: number | null;
      }>('SELECT id, source_instance_id, source_record_id, school_name, degree_raw, major_raw, start_date, end_date, is_current, display_order FROM candidate_educations WHERE candidate_id = $1 ORDER BY display_order NULLS LAST, start_date DESC NULLS LAST', [candidateId]),
      this.db.query<{
        id: string; source_instance_id: string | null; external_document_id: string | null; storage_provider: string;
        original_filename: string | null; mime_type: string | null; file_extension: string | null; file_size_bytes: string | null;
        document_role: string | null; document_status: string; first_seen_at: Date; last_seen_at: Date;
      }>('SELECT id, source_instance_id, external_document_id, storage_provider, original_filename, mime_type, file_extension, file_size_bytes::text, document_role, document_status, first_seen_at, last_seen_at FROM candidate_documents WHERE candidate_id = $1 ORDER BY first_seen_at', [candidateId]),
      this.db.query<{ id: string; tag: string; tag_type: string | null; origin: string }>('SELECT id, tag, tag_type, origin FROM candidate_tags WHERE candidate_id = $1 ORDER BY tag', [candidateId])
    ]);
    return {
      ...toSummary(candidate),
      rawSourceMetadata: parseJson(candidate.raw_source_metadata),
      externalReferences: references.rows.map((row): ExternalReference => ({
        id: row.id, sourceInstanceId: row.source_instance_id, externalCandidateId: row.external_candidate_id,
        externalUrl: row.external_url, sourceActive: row.source_active, sourceDeletedAt: asIso(row.source_deleted_at),
        firstSeenAt: asIso(row.first_seen_at) ?? '', lastSeenAt: asIso(row.last_seen_at) ?? '', metadata: parseJson(row.metadata)
      })),
      workExperiences: work.rows.map((row): WorkExperience => ({
        id: row.id, sourceInstanceId: row.source_instance_id, sourceRecordId: row.source_record_id,
        companyName: row.company_name, jobTitle: row.job_title, department: row.department, industryRaw: row.industry_raw,
        startDate: row.start_date, endDate: row.end_date, isCurrent: row.is_current, description: row.description, displayOrder: row.display_order
      })),
      educations: education.rows.map((row): Education => ({
        id: row.id, sourceInstanceId: row.source_instance_id, sourceRecordId: row.source_record_id,
        schoolName: row.school_name, degreeRaw: row.degree_raw, majorRaw: row.major_raw,
        startDate: row.start_date, endDate: row.end_date, isCurrent: row.is_current, displayOrder: row.display_order
      })),
      documents: documents.rows.map((row): CandidateDocument => ({
        id: row.id, sourceInstanceId: row.source_instance_id, externalDocumentId: row.external_document_id,
        storageProvider: row.storage_provider, originalFilename: row.original_filename, mimeType: row.mime_type,
        fileExtension: row.file_extension, fileSizeBytes: row.file_size_bytes, documentRole: row.document_role,
        documentStatus: row.document_status, firstSeenAt: asIso(row.first_seen_at) ?? '', lastSeenAt: asIso(row.last_seen_at) ?? ''
      })),
      tags: tags.rows.map((row) => ({ id: row.id, tag: row.tag, tagType: row.tag_type, origin: row.origin }))
    };
  }

  /** Used by local-only tests and future explicit write services, never exposed by Phase 3 HTTP routes. */
  public async createSyntheticCandidate(input: { displayName: string }): Promise<CandidateSummary> {
    const candidateCodeResult = await this.db.query<{ candidate_code: string }>(
      `SELECT 'TN' || lpad(nextval('candidate_code_sequence')::text, 8, '0') AS candidate_code`
    );
    const id = uuidv7();
    const candidateCode = candidateCodeResult.rows[0]?.candidate_code;
    if (!candidateCode) throw new Error('Could not allocate a candidate code.');
    const result = await this.db.query<CandidateRow>(`
      INSERT INTO candidates (id, candidate_code, display_name)
      VALUES ($1, $2, $3)
      RETURNING id, candidate_code, display_name, primary_email, primary_phone, location_text,
                current_company, current_title, canonical_status, raw_source_metadata, created_at, updated_at
    `, [id, candidateCode, input.displayName]);
    const row = result.rows[0];
    if (!row) throw new Error('Could not create a synthetic candidate.');
    return toSummary(row);
  }
}
