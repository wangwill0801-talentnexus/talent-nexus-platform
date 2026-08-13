import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { PinpinSourceAdapter, type PinpinCandidateSnapshot } from './source-adapter.js';
import { pinpinSourceInstance, pinpinSourceSystem } from './tn-reconciler.js';

type CandidateRow = { id: string; candidate_code: string; display_name: string | null; primary_email: string | null; primary_phone: string | null; location_text: string | null; current_company: string | null; current_title: string | null; canonical_status: string; raw_source_metadata: unknown; source_active: boolean; source_deleted_at: Date | null };
type WorkRow = { source_record_id: string | null; company_name: string | null; job_title: string | null; department: string | null; industry_raw: string | null; start_date: Date | string | null; end_date: Date | string | null; is_current: boolean };
type EducationRow = { source_record_id: string | null; school_name: string | null; degree_raw: string | null; major_raw: string | null; start_date: Date | string | null; end_date: Date | string | null; is_current: boolean | null; raw_source_fields: unknown };
type DocumentRow = { external_document_id: string | null; original_filename: string | null; file_extension: string | null; file_size_bytes: string | number | null; source_created_at: Date | string | null };

function json(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

function dateOnly(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${value.getFullYear()}-${month}-${day}`;
  }
  return value.slice(0, 10);
}

function instant(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function candidateMatches(candidate: CandidateRow, snapshot: PinpinCandidateSnapshot): boolean {
  const work = snapshot.workExperiences.find((item) => item.isCurrent) ?? snapshot.workExperiences[0] ?? null;
  const raw = json(candidate.raw_source_metadata);
  return candidate.display_name === snapshot.displayName && candidate.primary_email === snapshot.primaryEmail && candidate.primary_phone === snapshot.primaryPhone && candidate.location_text === snapshot.locationText && candidate.current_company === (work?.companyName ?? null) && candidate.current_title === (work?.jobTitle ?? null) && candidate.canonical_status === 'active' && candidate.source_active && candidate.source_deleted_at === null && raw.desiredLocationsRaw === snapshot.desiredLocationsRaw && raw.topEducationRaw === snapshot.topEducationRaw && raw.birthYearRaw === snapshot.birthDateRaw && raw.genderRaw === snapshot.genderRaw && raw.salaryRaw === snapshot.salaryRaw && raw.tagsRaw === snapshot.tagsRaw && raw.rawCvSource === snapshot.sourceRaw && raw.sourceNoteRaw === snapshot.noteRaw;
}

function worksMatch(rows: WorkRow[], snapshot: PinpinCandidateSnapshot): boolean {
  return rows.length === snapshot.workExperiences.length && snapshot.workExperiences.every((source) => rows.some((row) => row.source_record_id === source.sourceRecordId && row.company_name === source.companyName && row.job_title === source.jobTitle && row.department === source.department && row.industry_raw === source.industryRaw && dateOnly(row.start_date) === source.startDate && dateOnly(row.end_date) === source.endDate && row.is_current === source.isCurrent));
}

function workMismatchFields(rows: WorkRow[], snapshot: PinpinCandidateSnapshot): Record<string, number> {
  const mismatches: Record<string, number> = {};
  const add = (field: string, matches: boolean) => { if (!matches) mismatches[field] = (mismatches[field] ?? 0) + 1; };
  for (const source of snapshot.workExperiences) {
    const row = rows.find((item) => item.source_record_id === source.sourceRecordId);
    if (!row) { add('sourceRecordId', false); continue; }
    add('company', row.company_name === source.companyName);
    add('title', row.job_title === source.jobTitle);
    add('department', row.department === source.department);
    add('industryRaw', row.industry_raw === source.industryRaw);
    add('startDate', dateOnly(row.start_date) === source.startDate);
    add('endDate', dateOnly(row.end_date) === source.endDate);
    add('isCurrent', row.is_current === source.isCurrent);
  }
  return mismatches;
}

function educationsMatch(rows: EducationRow[], snapshot: PinpinCandidateSnapshot): boolean {
  return rows.length === snapshot.educations.length && snapshot.educations.every((source) => rows.some((row) => row.source_record_id === source.sourceRecordId && row.school_name === source.schoolName && row.degree_raw === source.degreeRaw && row.major_raw === source.majorRaw && dateOnly(row.start_date) === source.startDate && dateOnly(row.end_date) === source.endDate && row.is_current === source.isCurrent && json(row.raw_source_fields).descriptionRaw === source.descriptionRaw));
}

function educationMismatchFields(rows: EducationRow[], snapshot: PinpinCandidateSnapshot): Record<string, number> {
  const mismatches: Record<string, number> = {};
  const add = (field: string, matches: boolean) => { if (!matches) mismatches[field] = (mismatches[field] ?? 0) + 1; };
  for (const source of snapshot.educations) {
    const row = rows.find((item) => item.source_record_id === source.sourceRecordId);
    if (!row) { add('sourceRecordId', false); continue; }
    add('school', row.school_name === source.schoolName);
    add('degreeRaw', row.degree_raw === source.degreeRaw);
    add('majorRaw', row.major_raw === source.majorRaw);
    add('descriptionRaw', json(row.raw_source_fields).descriptionRaw === source.descriptionRaw);
    add('startDate', dateOnly(row.start_date) === source.startDate);
    add('endDate', dateOnly(row.end_date) === source.endDate);
    add('isCurrent', row.is_current === source.isCurrent);
  }
  return mismatches;
}

function documentsMatch(rows: DocumentRow[], snapshot: PinpinCandidateSnapshot): boolean {
  return rows.length === snapshot.documents.length && snapshot.documents.every((source) => rows.some((row) => row.external_document_id === source.externalDocumentId && row.original_filename === source.originalFilename && row.file_extension === source.fileExtension && Number(row.file_size_bytes) === source.fileSizeBytes && instant(row.source_created_at) === source.sourceCreatedAt));
}

async function readPilot(): Promise<PinpinCandidateSnapshot[]> {
  const adapter = await PinpinSourceAdapter.connect();
  try { return await adapter.selectRealPilotCandidates(); } finally { await adapter.close(); }
}

async function main(): Promise<void> {
  const snapshots = await readPilot();
  if (snapshots.length !== 5) throw new Error('Phase 4C verification selection is not exactly five candidates.');
  const pool = createPool(loadConfig().databaseUrl);
  try {
    let coreMatched = 0;
    let workMatched = 0;
    let educationMatched = 0;
    let documentMatched = 0;
    let lifecycleMatched = 0;
    const workMismatches: Record<string, number> = {};
    const educationMismatches: Record<string, number> = {};
    const candidateCodes: string[] = [];
    for (const snapshot of snapshots) {
      const candidateResult = await pool.query<CandidateRow>(`
        SELECT candidate.id, candidate.candidate_code, candidate.display_name, candidate.primary_email, candidate.primary_phone,
          candidate.location_text, candidate.current_company, candidate.current_title, candidate.canonical_status,
          candidate.raw_source_metadata, reference.source_active, reference.source_deleted_at
        FROM candidate_external_refs AS reference
        JOIN source_instances AS source ON source.id = reference.source_instance_id
        JOIN candidates AS candidate ON candidate.id = reference.candidate_id
        WHERE source.source_system = $1 AND source.instance_key = $2 AND reference.external_candidate_id = $3
        LIMIT 1
      `, [pinpinSourceSystem, pinpinSourceInstance, snapshot.externalCandidateId]);
      const candidate = candidateResult.rows[0];
      if (!candidate || !candidateMatches(candidate, snapshot)) continue;
      coreMatched += 1;
      candidateCodes.push(candidate.candidate_code);
      const [works, educations, documents] = await Promise.all([
        pool.query<WorkRow>('SELECT source_record_id, company_name, job_title, department, industry_raw, start_date, end_date, is_current FROM candidate_work_experiences WHERE candidate_id = $1 ORDER BY display_order', [candidate.id]),
        pool.query<EducationRow>('SELECT source_record_id, school_name, degree_raw, major_raw, start_date, end_date, is_current, raw_source_fields FROM candidate_educations WHERE candidate_id = $1 ORDER BY display_order', [candidate.id]),
        pool.query<DocumentRow>('SELECT external_document_id, original_filename, file_extension, file_size_bytes, source_created_at FROM candidate_documents WHERE candidate_id = $1', [candidate.id]),
      ]);
      if (worksMatch(works.rows, snapshot)) workMatched += 1;
      for (const [field, occurrences] of Object.entries(workMismatchFields(works.rows, snapshot))) workMismatches[field] = (workMismatches[field] ?? 0) + occurrences;
      if (educationsMatch(educations.rows, snapshot)) educationMatched += 1;
      for (const [field, occurrences] of Object.entries(educationMismatchFields(educations.rows, snapshot))) educationMismatches[field] = (educationMismatches[field] ?? 0) + occurrences;
      if (documentsMatch(documents.rows, snapshot)) documentMatched += 1;
      lifecycleMatched += 1;
    }
    const duplicateCodes = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM (SELECT candidate_code FROM candidates WHERE candidate_code = ANY($1::text[]) GROUP BY candidate_code HAVING count(*) > 1) duplicates', [candidateCodes]);
    process.stdout.write(`${JSON.stringify({ pilotSize: snapshots.length, coreMatched, workMatched, educationMatched, documentMetadataMatched: documentMatched, lifecycleMatched, workMismatchFields: workMismatches, educationMismatchFields: educationMismatches, candidateCodeDuplicates: Number(duplicateCodes.rows[0]?.count || 0), blobReads: 0, pinpinWrites: 0 })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write('PINPIN_REAL_PILOT_VERIFICATION_FAILED:verification\n');
  process.exitCode = 1;
});
