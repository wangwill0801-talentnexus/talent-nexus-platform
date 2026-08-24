import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import type { DatabaseClient, DatabasePool } from '../db/pool.js';
import { parseStandardResumeV1, type StandardResumeV1 } from '../domain/standard-resume.js';

type CountRow = { count: string };
type CandidateRow = { id: string; candidate_code: string };
export type EnrichmentSource = {
  kind: string; system?: string | null; reference?: string | null; url?: string | null; capturedAt?: string | null;
  createdAt?: string | null; updatedAt?: string | null; attachmentName?: string | null; attachmentType?: string | null;
  attachmentReference?: string | null; contentSha256?: string | null;
};
export type EnrichmentAiMetadata = { provider?: string | null; model?: string | null };
export type EnrichmentSnapshot = {
  id: string; candidateId: string; schemaVersion: string; source: EnrichmentSource; pluginVersion: string | null;
  aiMetadata: EnrichmentAiMetadata; payload: StandardResumeV1; payloadFingerprint: string; correlationId: string | null; supersedesId: string | null; createdAt: string;
};
export type StoreCandidateEnrichmentInput = {
  candidateId: string; source: EnrichmentSource; pluginVersion?: string | null; parserVersion?: string | null;
  atsSavedAt?: string | null; aiMetadata?: EnrichmentAiMetadata; correlationId?: string | null; payload: unknown;
  existingEvidenceId?: string | null;
  evidenceContent?: {
    normalizedText: string; contentSha256: string; evidenceIdentityKey: string;
    representationKind: 'connector_text' | 'connector_html' | 'local_file_text';
    extractorVersion: string; normalizationVersion: string; captureMethod: string; connectorVersion?: string | null;
  } | null;
};
export type StoreCandidateEnrichmentResult = { status: 'created' | 'unchanged'; snapshot: EnrichmentSnapshot };

export class CandidateEnrichmentError extends Error {
  public constructor(readonly code: 'CANDIDATE_NOT_FOUND' | 'INVALID_ENRICHMENT') { super(code); }
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}`;
}
function fingerprint(value: unknown): string { return createHash('sha256').update(stable(value)).digest('hex'); }
function bounded(value: string | null | undefined, max: number): string | null { if (value == null) return null; const result = value.trim(); if (!result || result.length > max) throw new CandidateEnrichmentError('INVALID_ENRICHMENT'); return result; }
function normalizedTimestamp(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (Number.isNaN(Date.parse(value))) throw new CandidateEnrichmentError('INVALID_ENRICHMENT');
  return new Date(value).toISOString();
}
function normalizedSource(source: EnrichmentSource) {
  const kind = bounded(source.kind, 64); if (!kind) throw new CandidateEnrichmentError('INVALID_ENRICHMENT');
  const contentSha256 = bounded(source.contentSha256, 64)?.toLowerCase() ?? null;
  if (contentSha256 && !/^[0-9a-f]{64}$/.test(contentSha256)) throw new CandidateEnrichmentError('INVALID_ENRICHMENT');
  return {
    kind, system: bounded(source.system, 128), reference: bounded(source.reference, 512), url: bounded(source.url, 2_048),
    capturedAt: normalizedTimestamp(source.capturedAt), createdAt: normalizedTimestamp(source.createdAt),
    updatedAt: normalizedTimestamp(source.updatedAt), attachmentName: bounded(source.attachmentName, 512),
    attachmentType: bounded(source.attachmentType, 128), attachmentReference: bounded(source.attachmentReference, 512), contentSha256
  };
}
function rowToSnapshot(row: Record<string, unknown>): EnrichmentSnapshot {
  return { id: String(row.id), candidateId: String(row.candidate_id), schemaVersion: String(row.schema_version), source: { kind: String(row.source_kind), system: row.source_system as string | null, reference: row.source_reference as string | null, url: row.source_url as string | null, capturedAt: row.source_captured_at ? new Date(String(row.source_captured_at)).toISOString() : null }, pluginVersion: row.plugin_version as string | null, aiMetadata: { provider: row.ai_provider as string | null, model: row.ai_model as string | null }, payload: row.payload as StandardResumeV1, payloadFingerprint: String(row.payload_fingerprint), correlationId: row.correlation_id as string | null, supersedesId: row.supersedes_id as string | null, createdAt: new Date(String(row.created_at)).toISOString() };
}
const projection = `id, candidate_id, schema_version, source_kind, source_system, source_reference, source_url, source_captured_at, plugin_version, ai_provider, ai_model, payload, payload_fingerprint, correlation_id, supersedes_id, created_at`;

async function persistNormalizedProfile(client: DatabaseClient, candidateId: string, snapshotId: string, payload: StandardResumeV1): Promise<void> {
  await client.query(`INSERT INTO candidate_ai_profiles (id,candidate_id,enrichment_snapshot_id,professional_summary,recruiter_summary,job_preferences) SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS (SELECT 1 FROM candidate_ai_profiles WHERE enrichment_snapshot_id=$3)`,
    [uuidv7(), candidateId, snapshotId, payload.summary ?? null, payload.recruiterSummary ?? null, payload.jobPreferences ?? null]);
  for (const [index, work] of payload.experience.entries()) {
    await client.query(`INSERT INTO candidate_ai_work_experiences (id,candidate_id,enrichment_snapshot_id,display_order,company_name,job_title,department,location_text,start_date_raw,end_date_raw,is_current,description) SELECT $1,$2,$3,$4::integer,$5,$6,$7,$8,$9,$10,$11::boolean,$12 WHERE NOT EXISTS (SELECT 1 FROM candidate_ai_work_experiences WHERE enrichment_snapshot_id=$3 AND display_order=$4::integer)`,
      [uuidv7(), candidateId, snapshotId, index, work.company ?? null, work.title ?? null, work.department ?? null, work.location ?? null, work.startDate ?? null, work.endDate ?? null, work.isCurrent ?? null, work.description ?? null]);
  }
  for (const [index, education] of payload.education.entries()) {
    await client.query(`INSERT INTO candidate_ai_educations (id,candidate_id,enrichment_snapshot_id,display_order,school_name,degree_raw,major_raw,start_date_raw,end_date_raw) SELECT $1,$2,$3,$4::integer,$5,$6,$7,$8,$9 WHERE NOT EXISTS (SELECT 1 FROM candidate_ai_educations WHERE enrichment_snapshot_id=$3 AND display_order=$4::integer)`,
      [uuidv7(), candidateId, snapshotId, index, education.school ?? null, education.degree ?? null, education.major ?? null, education.startDate ?? null, education.endDate ?? null]);
  }
  const groups: Array<[string, string[]]> = [
    ['skill', payload.skills], ['language', [...payload.languages, ...payload.languageDetails]],
    ['certification', payload.certifications], ['project', payload.projectExperience],
    ['target_role', payload.targetRoles], ['search_keyword', payload.coreKeywords]
  ];
  for (const [termType, values] of groups) {
    for (const [index, value] of values.entries()) {
      await client.query(`INSERT INTO candidate_ai_terms (id,candidate_id,enrichment_snapshot_id,term_type,display_order,value) SELECT $1,$2,$3,$4,$5::integer,$6 WHERE NOT EXISTS (SELECT 1 FROM candidate_ai_terms WHERE enrichment_snapshot_id=$3 AND term_type=$4 AND display_order=$5::integer)`,
        [uuidv7(), candidateId, snapshotId, termType, index, value]);
    }
  }
}

async function persistEvidenceAndProcessing(client: DatabaseClient, input: StoreCandidateEnrichmentInput, source: ReturnType<typeof normalizedSource>, pluginVersion: string | null, parserVersion: string | null, payload: StandardResumeV1, snapshotId: string): Promise<void> {
  const content = input.evidenceContent ?? null;
  const evidenceId = input.existingEvidenceId ?? uuidv7();
  if (input.existingEvidenceId) {
    const updated = await client.query<{ id: string }>(`UPDATE candidate_resume_evidence SET enrichment_snapshot_id=$3,source_type=$4,source_system=$5,source_reference=$6,source_url=$7,attachment_name=$8,attachment_type=$9,attachment_reference=$10,content_sha256=$11,evidence_fingerprint=$11,extractor_version=$12,representation_kind=$13,processing_eligible=$14,captured_at=$15::timestamptz,evidence_identity_key=$16,hash_algorithm=$17,normalization_version=$18,capture_method=$19,connector_version=$20 WHERE id=$1 AND candidate_id=$2 AND (enrichment_snapshot_id IS NULL OR enrichment_snapshot_id=$3) RETURNING id`,
      [evidenceId, input.candidateId, snapshotId, source.kind, source.system, source.reference, source.url, source.attachmentName, source.attachmentType, source.attachmentReference, source.contentSha256, content?.extractorVersion ?? parserVersion, content?.representationKind ?? 'metadata_only', Boolean(content), source.capturedAt, content?.evidenceIdentityKey ?? null, content ? 'sha256' : null, content?.normalizationVersion ?? null, content?.captureMethod ?? null, content?.connectorVersion ?? pluginVersion]);
    if (!updated.rows[0]) throw new CandidateEnrichmentError('INVALID_ENRICHMENT');
  } else {
    await client.query(`INSERT INTO candidate_resume_evidence (id,candidate_id,enrichment_snapshot_id,source_type,source_system,source_reference,source_url,attachment_name,attachment_type,attachment_reference,content_sha256,evidence_fingerprint,extractor_version,representation_kind,processing_eligible,captured_at,source_created_at,source_updated_at,evidence_identity_key,hash_algorithm,normalization_version,capture_method,connector_version) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,$15::timestamptz,$16::timestamptz,$17::timestamptz,$18,$19,$20,$21,$22 WHERE NOT EXISTS (SELECT 1 FROM candidate_resume_evidence WHERE enrichment_snapshot_id=$3)`,
      [evidenceId, input.candidateId, snapshotId, source.kind, source.system, source.reference, source.url, source.attachmentName, source.attachmentType, source.attachmentReference, source.contentSha256, content?.extractorVersion ?? parserVersion, content?.representationKind ?? 'metadata_only', Boolean(content), source.capturedAt, source.createdAt, source.updatedAt, content?.evidenceIdentityKey ?? null, content ? 'sha256' : null, content?.normalizationVersion ?? null, content?.captureMethod ?? null, content?.connectorVersion ?? pluginVersion]);
  }
  const evidence = await client.query<{id:string}>('SELECT id FROM candidate_resume_evidence WHERE enrichment_snapshot_id=$1',[snapshotId]);
  if (content && evidence.rows[0]) {
    await client.query(`INSERT INTO candidate_evidence_extractions (id,evidence_id,candidate_id,extractor_version,content_sha256,representation_kind,content_reference,character_count,status,normalization_version,normalized_text) VALUES ($1,$2,$3,$4,$5,$6,'inline:normalized_text',$7,'available',$8,$9) ON CONFLICT (evidence_id,extractor_version,content_sha256) DO NOTHING`,
      [uuidv7(), evidence.rows[0].id, input.candidateId, content.extractorVersion, content.contentSha256, content.representationKind, content.normalizedText.length, content.normalizationVersion, content.normalizedText]);
  }
  await client.query(`INSERT INTO candidate_processing_jobs (id,candidate_id,evidence_id,operation,status,attempt_count,max_attempts,available_at,started_at,finished_at,evidence_fingerprint,extractor_version,parser_version,schema_version,ai_provider,ai_model,idempotency_key,requested_by,output_snapshot_id,created_at,updated_at) VALUES ($1,$2,$3,'process_new_evidence','completed',1,1,now(),now(),now(),$4,$5,$6,$7,$8,$9,$10,'connector_legacy_intake',$1,now(),now()) ON CONFLICT (candidate_id,idempotency_key) DO NOTHING`,
    [snapshotId,input.candidateId,evidence.rows[0]?.id??null,source.contentSha256,content?.extractorVersion ?? parserVersion,parserVersion??'legacy_netlify_parser_unknown',payload.schemaVersion,input.aiMetadata?.provider??null,input.aiMetadata?.model??null,`legacy-snapshot:${snapshotId}`]);
  await client.query(`INSERT INTO candidate_processing_state (candidate_id,status,latest_snapshot_id,latest_job_id,schema_version,parser_version,plugin_version,processor_version,source_created_at,source_updated_at,resume_updated_at,last_synced_at,ai_first_processed_at,ai_last_processed_at,profile_created_at,last_error_code,updated_at) VALUES ($1,'completed',$2,$2,$3,$4,$5,$4,$6,$7,$8,now(),now(),now(),now(),NULL,now()) ON CONFLICT (candidate_id) DO UPDATE SET status='completed',latest_snapshot_id=EXCLUDED.latest_snapshot_id,latest_job_id=EXCLUDED.latest_job_id,schema_version=EXCLUDED.schema_version,parser_version=COALESCE(EXCLUDED.parser_version,candidate_processing_state.parser_version),plugin_version=COALESCE(EXCLUDED.plugin_version,candidate_processing_state.plugin_version),processor_version=COALESCE(EXCLUDED.processor_version,candidate_processing_state.processor_version),source_created_at=COALESCE(EXCLUDED.source_created_at,candidate_processing_state.source_created_at),source_updated_at=COALESCE(EXCLUDED.source_updated_at,candidate_processing_state.source_updated_at),resume_updated_at=COALESCE(EXCLUDED.resume_updated_at,candidate_processing_state.resume_updated_at),last_synced_at=now(),ai_first_processed_at=COALESCE(candidate_processing_state.ai_first_processed_at,now()),ai_last_processed_at=now(),profile_created_at=COALESCE(candidate_processing_state.profile_created_at,now()),last_error_code=NULL,stale_reason=NULL,updated_at=now()`,
    [input.candidateId, snapshotId, payload.schemaVersion, parserVersion, pluginVersion, source.createdAt, source.updatedAt, source.updatedAt ?? source.capturedAt]);
}

export class CandidateEnrichmentService {
  public constructor(private readonly database: DatabasePool) {}

  async storeCandidateEnrichment(input: StoreCandidateEnrichmentInput): Promise<StoreCandidateEnrichmentResult> {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(input.candidateId)) throw new CandidateEnrichmentError('INVALID_ENRICHMENT');
    const source = normalizedSource(input.source);
    const pluginVersion = bounded(input.pluginVersion, 128);
    const parserVersion = bounded(input.parserVersion, 128);
    const atsSavedAt = normalizedTimestamp(input.atsSavedAt);
    const aiMetadata = { provider: bounded(input.aiMetadata?.provider, 128), model: bounded(input.aiMetadata?.model, 256) };
    const correlationId = bounded(input.correlationId, 128);
    let payload: StandardResumeV1;
    try { payload = parseStandardResumeV1(input.payload); } catch { throw new CandidateEnrichmentError('INVALID_ENRICHMENT'); }
    const payloadFingerprint = fingerprint(payload);
    // Keep this key compatible with snapshots written before the candidate-intake
    // projection tables existed. Parser and attachment metadata are still stored
    // on the snapshot/evidence rows, but must not turn an unchanged legacy replay
    // into a second semantic snapshot.
    const semanticIdentity = {
      schemaVersion: payload.schemaVersion,
      payloadFingerprint,
      source: { kind: source.kind, system: source.system, reference: source.reference, url: source.url },
      pluginVersion,
      aiMetadata
    };
    // Preserve the exact historical key for legacy metadata-only replays.
    // Content-backed captures add their immutable normalized representation.
    const idempotencyKey = fingerprint(input.evidenceContent
      ? { ...semanticIdentity, evidenceContentSha256: input.evidenceContent.contentSha256 }
      : semanticIdentity);
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const candidate = await client.query<CandidateRow>('SELECT id, candidate_code FROM candidates WHERE id = $1', [input.candidateId]);
      if (!candidate.rows[0]) throw new CandidateEnrichmentError('CANDIDATE_NOT_FOUND');
      const existing = await client.query<Record<string, unknown>>(`SELECT ${projection} FROM candidate_enrichment_snapshots WHERE candidate_id = $1 AND schema_version = $2 AND idempotency_key = $3`, [input.candidateId, payload.schemaVersion, idempotencyKey]);
      if (existing.rows[0]) {
        const snapshotId = String(existing.rows[0].id);
        await persistNormalizedProfile(client, input.candidateId, snapshotId, payload);
        await persistEvidenceAndProcessing(client, input, source, pluginVersion, parserVersion, payload, snapshotId);
        await client.query('COMMIT'); return { status: 'unchanged', snapshot: rowToSnapshot(existing.rows[0]) };
      }
      const latest = await client.query<{ id: string }>('SELECT id FROM candidate_enrichment_snapshots WHERE candidate_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1', [input.candidateId]);
      const inserted = await client.query<Record<string, unknown>>(`INSERT INTO candidate_enrichment_snapshots (id, candidate_id, schema_version, source_kind, source_system, source_reference, source_url, source_captured_at, plugin_version, parser_version, ai_provider, ai_model, ats_saved_at, source_created_at, source_updated_at, evidence_metadata, payload, payload_fingerprint, idempotency_key, correlation_id, supersedes_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18,$19,$20,$21) ON CONFLICT (candidate_id, schema_version, idempotency_key) DO NOTHING RETURNING ${projection}`,
        [uuidv7(), input.candidateId, payload.schemaVersion, source.kind, source.system, source.reference, source.url, source.capturedAt, pluginVersion, parserVersion, aiMetadata.provider, aiMetadata.model, atsSavedAt, source.createdAt, source.updatedAt, JSON.stringify({ attachmentName: source.attachmentName, attachmentType: source.attachmentType, attachmentReference: source.attachmentReference, contentSha256: source.contentSha256 }), JSON.stringify(payload), payloadFingerprint, idempotencyKey, correlationId, latest.rows[0]?.id ?? null]);
      if (!inserted.rows[0]) {
        const replay = await client.query<Record<string, unknown>>(`SELECT ${projection} FROM candidate_enrichment_snapshots WHERE candidate_id = $1 AND schema_version = $2 AND idempotency_key = $3`, [input.candidateId, payload.schemaVersion, idempotencyKey]);
        if (!replay.rows[0]) throw new CandidateEnrichmentError('INVALID_ENRICHMENT');
        const snapshotId = String(replay.rows[0].id);
        await persistNormalizedProfile(client, input.candidateId, snapshotId, payload);
        await persistEvidenceAndProcessing(client, input, source, pluginVersion, parserVersion, payload, snapshotId);
        await client.query('COMMIT'); return { status: 'unchanged', snapshot: rowToSnapshot(replay.rows[0]) };
      }
      const snapshotId = String(inserted.rows[0].id);
      await persistNormalizedProfile(client, input.candidateId, snapshotId, payload);
      await persistEvidenceAndProcessing(client, input, source, pluginVersion, parserVersion, payload, snapshotId);
      await client.query('COMMIT');
      return { status: 'created', snapshot: rowToSnapshot(inserted.rows[0]) };
    } catch (error) { try { await client.query('ROLLBACK'); } catch { /* keep original error */ } throw error; } finally { client.release(); }
  }

  async getLatestCandidateEnrichment(candidateId: string): Promise<EnrichmentSnapshot | null> {
    const result = await this.database.query<Record<string, unknown>>(`SELECT ${projection} FROM candidate_enrichment_snapshots WHERE candidate_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, [candidateId]);
    return result.rows[0] ? rowToSnapshot(result.rows[0]) : null;
  }

  static auditFields(candidateId: string, result: StoreCandidateEnrichmentResult): Record<string, string | null> {
    return { candidateId, snapshotId: result.snapshot.id, schemaVersion: result.snapshot.schemaVersion, sourceKind: result.snapshot.source.kind, result: result.status, correlationId: result.snapshot.correlationId, payloadFingerprintPrefix: result.snapshot.payloadFingerprint.slice(0, 12) };
  }
}
