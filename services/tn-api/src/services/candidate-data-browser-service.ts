import type { DatabasePool } from '../db/pool.js';

export interface CandidateDataBrowser {
  inspect(identifier: string): Promise<Record<string, unknown> | null>;
}

const scalar = (rows: Array<Record<string, unknown>>, key: string): unknown => rows[0]?.[key] ?? null;

export class CandidateDataBrowserService implements CandidateDataBrowser {
  constructor(private readonly database: DatabasePool) {}

  async inspect(identifier: string): Promise<Record<string, unknown> | null> {
    const candidateResult = await this.database.query<Record<string, unknown>>(`
      SELECT DISTINCT c.id,c.candidate_code,c.display_name,c.primary_email,c.primary_phone,c.location_text,
        c.current_company,c.current_title,c.canonical_status,c.created_at,c.updated_at
      FROM candidates c
      LEFT JOIN candidate_external_refs r ON r.candidate_id=c.id
      LEFT JOIN source_instances s ON s.id=r.source_instance_id
      WHERE c.id::text=$1 OR c.candidate_code=$1
        OR (r.external_candidate_id=$1 AND s.source_system='pinpin' AND s.instance_key='pinpin-prod')
      LIMIT 2
    `, [identifier]);
    if (candidateResult.rows.length !== 1) return null;
    const candidate = candidateResult.rows[0]!;
    const candidateId = String(candidate.id);
    const [refs, baselineWork, baselineEducation, documents, processing, snapshot, jobs, extractions, evidence] = await Promise.all([
      this.database.query<Record<string, unknown>>(`SELECT s.source_system,s.instance_key,r.external_candidate_id,r.source_active,r.first_seen_at,r.last_seen_at FROM candidate_external_refs r JOIN source_instances s ON s.id=r.source_instance_id WHERE r.candidate_id=$1 ORDER BY s.source_system,s.instance_key`, [candidateId]),
      this.database.query<Record<string, unknown>>(`SELECT id,company_name,job_title,department,start_date,end_date,is_current,description FROM candidate_work_experiences WHERE candidate_id=$1 ORDER BY display_order NULLS LAST,start_date DESC NULLS LAST`, [candidateId]),
      this.database.query<Record<string, unknown>>(`SELECT id,school_name,degree_raw,major_raw,start_date,end_date,is_current FROM candidate_educations WHERE candidate_id=$1 ORDER BY display_order NULLS LAST,start_date DESC NULLS LAST`, [candidateId]),
      this.database.query<Record<string, unknown>>(`SELECT external_document_id,original_filename,mime_type,file_extension,file_size_bytes::text,document_role,document_status,first_seen_at,last_seen_at FROM candidate_documents WHERE candidate_id=$1 ORDER BY first_seen_at`, [candidateId]),
      this.database.query<Record<string, unknown>>(`SELECT status,schema_version,parser_version,plugin_version,source_created_at,source_updated_at,resume_updated_at,tn_first_seen_at,last_synced_at,ai_first_processed_at,ai_last_processed_at,profile_created_at,last_error_code,updated_at FROM candidate_processing_state WHERE candidate_id=$1`, [candidateId]),
      this.database.query<Record<string, unknown>>(`SELECT id,payload,schema_version,source_kind,source_system,source_reference,source_url,source_captured_at,plugin_version,parser_version,ai_provider,ai_model,processed_at,created_at FROM candidate_enrichment_snapshots WHERE candidate_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, [candidateId]),
      this.database.query<Record<string, unknown>>(`SELECT id,operation,status,attempt_count,max_attempts,evidence_fingerprint,extractor_version,parser_version,schema_version,ai_provider,ai_model,requested_by,last_error_code,last_error_summary,output_snapshot_id,created_at,started_at,finished_at,updated_at FROM candidate_processing_jobs WHERE candidate_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20`,[candidateId]),
      this.database.query<Record<string, unknown>>(`SELECT id,evidence_id,extractor_version,content_sha256,representation_kind,content_reference,character_count,status,error_code,created_at FROM candidate_evidence_extractions WHERE candidate_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20`,[candidateId]),
      this.database.query<Record<string, unknown>>(`SELECT id,enrichment_snapshot_id,source_type,source_system,source_reference,source_url,attachment_name,attachment_type,attachment_reference,content_sha256,evidence_fingerprint,extractor_version,representation_kind,processing_eligible,captured_at,source_created_at,source_updated_at,hash_algorithm,normalization_version,capture_method,connector_version,created_at FROM candidate_resume_evidence WHERE candidate_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20`, [candidateId])
    ]);
    const latest = snapshot.rows[0];
    const snapshotId = latest ? String(latest.id) : null;
    const [profile, aiWork, aiEducation, terms] = snapshotId ? await Promise.all([
      this.database.query<Record<string, unknown>>(`SELECT professional_summary,recruiter_summary,job_preferences,created_at FROM candidate_ai_profiles WHERE enrichment_snapshot_id=$1`, [snapshotId]),
      this.database.query<Record<string, unknown>>(`SELECT company_name,job_title,department,location_text,start_date_raw,end_date_raw,is_current,description,provenance FROM candidate_ai_work_experiences WHERE enrichment_snapshot_id=$1 ORDER BY display_order`, [snapshotId]),
      this.database.query<Record<string, unknown>>(`SELECT school_name,degree_raw,major_raw,start_date_raw,end_date_raw,provenance FROM candidate_ai_educations WHERE enrichment_snapshot_id=$1 ORDER BY display_order`, [snapshotId]),
      this.database.query<Record<string, unknown>>(`SELECT term_type,value,provenance FROM candidate_ai_terms WHERE enrichment_snapshot_id=$1 ORDER BY term_type,display_order`, [snapshotId])
    ]) : [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];
    const termGroups = Object.fromEntries(['skill','language','certification','project','target_role','search_keyword'].map((type) => [type, terms.rows.filter((row) => row.term_type === type).map((row) => row.value)]));
    const warnings: string[] = [];
    if (!latest) warnings.push('AI_PROFILE_MISSING');
    if (aiWork.rows.length > baselineWork.rows.length) warnings.push('AI_WORK_RICHER_THAN_ATS');
    if (aiEducation.rows.length > baselineEducation.rows.length) warnings.push('AI_EDUCATION_RICHER_THAN_ATS');
    if (evidence.rows.some((row) => !row.content_sha256)) warnings.push('SOURCE_NOT_HASHED');
    return {
      header: { name: candidate.display_name, atsCandidateId: refs.rows.find((row) => row.source_system === 'pinpin' && row.instance_key === 'pinpin-prod')?.external_candidate_id ?? null },
      identity: { candidateUuid: candidateId, atsCandidateId: refs.rows.find((row) => row.source_system === 'pinpin' && row.instance_key === 'pinpin-prod')?.external_candidate_id ?? null, legacyTnCode: candidate.candidate_code, externalRefs: refs.rows },
      atsBaseline: { core: candidate, workCount: baselineWork.rows.length, educationCount: baselineEducation.rows.length, work: baselineWork.rows, education: baselineEducation.rows, documents: documents.rows },
      aiProfile: { ...profile.rows[0], work: aiWork.rows, education: aiEducation.rows, ...termGroups },
      evidence: { current: evidence.rows, extractions: extractions.rows },
      processing: { current: processing.rows[0] ?? { status: 'not_processed' }, jobs: jobs.rows },
      warnings,
      rawAiSnapshot: latest ? { metadata: { ...latest, payload: undefined }, payload: scalar(snapshot.rows, 'payload') } : null
    };
  }
}
