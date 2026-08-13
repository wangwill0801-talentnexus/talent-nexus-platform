import { v7 as uuidv7 } from 'uuid';
import { createHash } from 'node:crypto';
import type { DatabaseClient, DatabasePool } from '../db/pool.js';
import type { PinpinCandidateSnapshot } from './source-adapter.js';

export const pinpinSourceSystem = 'pinpin';
export const pinpinSourceInstance = 'pinpin-prod';

type QueryExecutor = Pick<DatabaseClient, 'query'>;

type SourceInstanceRow = { id: string };
type ExistingReferenceRow = { id: string; candidate_id: string };
type CandidateRow = { id: string; candidate_code: string };
type CountRow = { count: string };
type SyncStateRow = { core_fingerprint: string | null; work_fingerprint: string | null; education_fingerprint: string | null; document_fingerprint: string | null };
type SyncFingerprints = { core: string; work: string; education: string; documents: string };

export type ReconcileResult = {
  candidateCreated: boolean;
  materiallyChanged: boolean;
  candidateId: string;
  candidateCode: string;
  externalReferenceCount: number;
  sourceActive: boolean;
  sourceDeleted: boolean;
  lifecycleEventCreated: boolean;
  workCreated: number;
  workUpdated: number;
  workDeleted: number;
  workCount: number;
  educationCreated: number;
  educationUpdated: number;
  educationDeleted: number;
  educationCount: number;
  documentCreated: number;
  documentUpdated: number;
  documentDeleted: number;
  documentCount: number;
};

export type IntegrityResult = {
  externalReferenceDuplicates: number;
  orphanWorkRows: number;
  orphanEducationRows: number;
  orphanDocumentRows: number;
  candidateCodeDuplicates: number;
  lifecycleLinkageValid: boolean;
};

/** Test-only dependency injection for transaction rollback coverage. */
export type ReconciliationHooks = {
  beforeCommit?: (context: { candidateId: string; externalCandidateId: string }) => void | Promise<void>;
};

function count(result: { rows: CountRow[] }): number {
  return Number(result.rows[0]?.count ?? '0');
}

async function ensureSourceInstance(db: QueryExecutor): Promise<string> {
  const inserted = await db.query<SourceInstanceRow>(`
    INSERT INTO source_instances (id, source_system, instance_key, display_name, operational_metadata)
    VALUES ($1, $2, $3, 'Pinpin production source', '{}'::jsonb)
    ON CONFLICT (source_system, instance_key) DO NOTHING
    RETURNING id
  `, [uuidv7(), pinpinSourceSystem, pinpinSourceInstance]);
  if (inserted.rows[0]?.id) return inserted.rows[0].id;
  const result = await db.query<SourceInstanceRow>(`
    SELECT id FROM source_instances WHERE source_system = $1 AND instance_key = $2 LIMIT 1
  `, [pinpinSourceSystem, pinpinSourceInstance]);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Source instance reconciliation failed.');
  return id;
}

async function findReference(db: QueryExecutor, sourceInstanceId: string, externalCandidateId: string): Promise<ExistingReferenceRow | null> {
  const result = await db.query<ExistingReferenceRow>(`
    SELECT id, candidate_id
    FROM candidate_external_refs
    WHERE source_instance_id = $1 AND external_candidate_id = $2
    LIMIT 1
  `, [sourceInstanceId, externalCandidateId]);
  return result.rows[0] ?? null;
}

type CandidateSeed = {
  displayName: string | null;
  canonicalStatus: 'active' | 'inactive';
  rawSourceMetadata: Record<string, unknown>;
};

async function createCandidate(db: QueryExecutor, seed: CandidateSeed): Promise<CandidateRow> {
  const codeResult = await db.query<{ candidate_code: string }>(
    `SELECT 'TN' || lpad(nextval('candidate_code_sequence')::text, 8, '0') AS candidate_code`
  );
  const candidateCode = codeResult.rows[0]?.candidate_code;
  if (!candidateCode) throw new Error('Candidate code allocation failed.');
  const result = await db.query<CandidateRow>(`
    INSERT INTO candidates (id, candidate_code, display_name, canonical_status, raw_source_metadata)
    VALUES ($1, $2, $3, $4, $5::jsonb)
    RETURNING id, candidate_code
  `, [uuidv7(), candidateCode, seed.displayName, seed.canonicalStatus, JSON.stringify(seed.rawSourceMetadata)]);
  const row = result.rows[0];
  if (!row) throw new Error('Candidate creation failed.');
  return row;
}

async function candidateIdentity(db: QueryExecutor, candidateId: string): Promise<CandidateRow> {
  const result = await db.query<CandidateRow>('SELECT id, candidate_code FROM candidates WHERE id = $1', [candidateId]);
  const row = result.rows[0];
  if (!row) throw new Error('Referenced TN candidate is missing.');
  return row;
}

function currentWork(snapshot: PinpinCandidateSnapshot) {
  return snapshot.workExperiences.find((item) => item.isCurrent) ?? snapshot.workExperiences[0] ?? null;
}

async function reconcileExternalReference(db: QueryExecutor, candidateId: string, sourceInstanceId: string, snapshot: PinpinCandidateSnapshot): Promise<void> {
  await db.query(`
    INSERT INTO candidate_external_refs (
      id, candidate_id, source_instance_id, external_candidate_id, source_active, source_deleted_at, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    ON CONFLICT (source_instance_id, external_candidate_id)
    DO UPDATE SET
      candidate_id = EXCLUDED.candidate_id,
      source_active = EXCLUDED.source_active,
      source_deleted_at = EXCLUDED.source_deleted_at,
      last_seen_at = now(),
      metadata = EXCLUDED.metadata,
      updated_at = now()
  `, [
    uuidv7(), candidateId, sourceInstanceId, snapshot.externalCandidateId, snapshot.sourceActive, snapshot.deletedAt,
    JSON.stringify({ rawCvSource: snapshot.sourceRaw, sourceLifecycle: snapshot.deletedAt ? 'deleted' : (snapshot.sourceActive ? 'active' : 'inactive') })
  ]);
}

async function reconcileCandidateProjection(db: QueryExecutor, candidateId: string, snapshot: PinpinCandidateSnapshot, syntheticFixture = true): Promise<void> {
  const work = currentWork(snapshot);
  await db.query(`
    UPDATE candidates
    SET display_name = $2,
        canonical_status = $3,
        primary_email = $4,
        primary_phone = $5,
        location_text = $6,
        current_company = $7,
        current_title = $8,
        raw_source_metadata = $9::jsonb,
        updated_at = now()
    WHERE id = $1
  `, [
    candidateId,
    snapshot.displayName,
    snapshot.deletedAt || !snapshot.sourceActive ? 'inactive' : 'active',
    snapshot.primaryEmail,
    snapshot.primaryPhone,
    snapshot.locationText,
    work?.companyName ?? null,
    work?.jobTitle ?? null,
    JSON.stringify({
      sourceSystem: pinpinSourceSystem,
      sourceInstance: pinpinSourceInstance,
      rawCvSource: snapshot.sourceRaw,
      desiredLocationsRaw: snapshot.desiredLocationsRaw,
      topEducationRaw: snapshot.topEducationRaw,
      tagsRaw: snapshot.tagsRaw,
      birthYearRaw: snapshot.birthDateRaw,
      genderRaw: snapshot.genderRaw,
      salaryRaw: snapshot.salaryRaw,
      sourceNoteRaw: snapshot.noteRaw,
      ...(syntheticFixture ? { syntheticFixture: true } : {}),
    })
  ]);
}

function sourceFingerprint(values: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

function sameNullableValue(left: unknown, right: unknown): boolean {
  if (left == null || right == null) return left == null && right == null;
  return String(left) === String(right);
}

function sameNullableDate(left: unknown, right: unknown): boolean {
  if (left == null || right == null) return left == null && right == null;
  const normalize = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  return normalize(left) === normalize(right);
}

function workLogicalScore(row: { company_name: unknown; job_title: unknown; industry_raw: unknown; start_date: unknown; end_date: unknown; is_current: unknown }, work: { companyName: unknown; jobTitle: unknown; industryRaw: unknown; startDate: unknown; endDate: unknown; isCurrent: unknown }): number {
  return (sameNullableValue(row.company_name, work.companyName) ? 3 : 0)
    + (sameNullableValue(row.job_title, work.jobTitle) ? 2 : 0)
    + (sameNullableValue(row.industry_raw, work.industryRaw) ? 1 : 0)
    + (sameNullableDate(row.start_date, work.startDate) ? 2 : 0)
    + (sameNullableDate(row.end_date, work.endDate) ? 2 : 0)
    + (sameNullableValue(row.is_current, work.isCurrent) ? 2 : 0);
}

function educationLogicalScore(row: { school_name: unknown; degree_raw: unknown; major_raw: unknown; start_date: unknown; end_date: unknown; is_current: unknown }, education: { schoolName: unknown; degreeRaw: unknown; majorRaw: unknown; startDate: unknown; endDate: unknown; isCurrent: unknown }): number {
  return (sameNullableValue(row.school_name, education.schoolName) ? 3 : 0)
    + (sameNullableValue(row.degree_raw, education.degreeRaw) ? 2 : 0)
    + (sameNullableValue(row.major_raw, education.majorRaw) ? 2 : 0)
    + (sameNullableDate(row.start_date, education.startDate) ? 2 : 0)
    + (sameNullableDate(row.end_date, education.endDate) ? 2 : 0)
    + (sameNullableValue(row.is_current, education.isCurrent) ? 2 : 0);
}

function uniqueHighestMatch<T>(rows: T[], score: (row: T) => number, minimum: number): T | null {
  const ranked = rows.map((row) => ({ row, score: score(row) })).filter((item) => item.score >= minimum);
  const best = Math.max(-1, ...ranked.map((item) => item.score));
  const winners = ranked.filter((item) => item.score === best);
  if (winners.length > 1) throw new Error('ambiguous-child-identity');
  return winners[0]?.row ?? null;
}

function snapshotFingerprints(snapshot: PinpinCandidateSnapshot): SyncFingerprints {
  return {
    core: sourceFingerprint([snapshot.displayName, snapshot.primaryEmail, snapshot.primaryPhone, snapshot.locationText, snapshot.desiredLocationsRaw, snapshot.topEducationRaw, snapshot.birthDateRaw, snapshot.genderRaw, snapshot.salaryRaw, snapshot.tagsRaw, snapshot.sourceRaw, snapshot.noteRaw, snapshot.sourceActive, snapshot.deletedAt]),
    work: sourceFingerprint(snapshot.workExperiences.map((item) => [item.sourceRecordId, item.companyName, item.jobTitle, item.department, item.industryRaw, item.startDate, item.endDate, item.isCurrent])),
    education: sourceFingerprint(snapshot.educations.map((item) => [item.sourceRecordId, item.schoolName, item.degreeRaw, item.majorRaw, item.descriptionRaw, item.startDate, item.endDate, item.isCurrent])),
    documents: sourceFingerprint(snapshot.documents.map((item) => [item.externalDocumentId, item.fileExtension, item.fileSizeBytes, item.sourceCreatedAt])),
  };
}

async function findSyncState(db: QueryExecutor, candidateId: string, sourceInstanceId: string): Promise<SyncStateRow | null> {
  const result = await db.query<SyncStateRow>(`
    SELECT core_fingerprint, work_fingerprint, education_fingerprint, document_fingerprint
    FROM candidate_sync_state
    WHERE candidate_id = $1 AND source_instance_id = $2
    LIMIT 1
  `, [candidateId, sourceInstanceId]);
  return result.rows[0] ?? null;
}

async function reconcileSyncState(db: QueryExecutor, candidateId: string, sourceInstanceId: string, fingerprints: SyncFingerprints): Promise<void> {
  await db.query(`
    INSERT INTO candidate_sync_state (
      id, candidate_id, source_instance_id, core_fingerprint, work_fingerprint, education_fingerprint,
      document_fingerprint, last_observed_at, last_reconciled_at, last_successful_sync_at, sync_status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, now(), now(), now(), 'succeeded')
    ON CONFLICT (candidate_id, source_instance_id)
    DO UPDATE SET core_fingerprint = EXCLUDED.core_fingerprint, work_fingerprint = EXCLUDED.work_fingerprint,
      education_fingerprint = EXCLUDED.education_fingerprint, document_fingerprint = EXCLUDED.document_fingerprint,
      last_observed_at = now(), last_reconciled_at = now(), last_successful_sync_at = now(), sync_status = 'succeeded', updated_at = now()
  `, [uuidv7(), candidateId, sourceInstanceId, fingerprints.core, fingerprints.work, fingerprints.education, fingerprints.documents]);
}

async function childCounts(db: QueryExecutor, candidateId: string, sourceInstanceId: string): Promise<{ work: number; education: number; documents: number }> {
  const work = await db.query<CountRow>('SELECT count(*)::text AS count FROM candidate_work_experiences WHERE candidate_id = $1 AND source_instance_id = $2', [candidateId, sourceInstanceId]);
  const education = await db.query<CountRow>('SELECT count(*)::text AS count FROM candidate_educations WHERE candidate_id = $1 AND source_instance_id = $2', [candidateId, sourceInstanceId]);
  const documents = await db.query<CountRow>('SELECT count(*)::text AS count FROM candidate_documents WHERE candidate_id = $1 AND source_instance_id = $2', [candidateId, sourceInstanceId]);
  return { work: count(work), education: count(education), documents: count(documents) };
}

async function reconcileLifecycle(db: QueryExecutor, candidateId: string, sourceInstanceId: string, snapshot: PinpinCandidateSnapshot, syntheticFixture = true): Promise<boolean> {
  if (!snapshot.deletedAt && snapshot.sourceActive) return false;
  const eventType = snapshot.deletedAt ? 'deleted' : 'deactivated';
  const existing = await db.query<CountRow>(`
    SELECT count(*)::text AS count
    FROM source_lifecycle_events
    WHERE candidate_id = $1 AND source_instance_id = $2 AND external_candidate_id = $3 AND event_type = $4
  `, [candidateId, sourceInstanceId, snapshot.externalCandidateId, eventType]);
  if (count(existing) > 0) return false;
  await db.query(`
    INSERT INTO source_lifecycle_events (id, candidate_id, source_instance_id, external_candidate_id, event_type, source_event_at, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
  `, [
    uuidv7(), candidateId, sourceInstanceId, snapshot.externalCandidateId, eventType, snapshot.deletedAt,
    JSON.stringify({ observedFrom: 'pinpin-tombstone', ...(syntheticFixture ? { syntheticFixture: true } : {}) })
  ]);
  return true;
}

async function reconcileWork(db: QueryExecutor, candidateId: string, sourceInstanceId: string, snapshot: PinpinCandidateSnapshot): Promise<{ created: number; updated: number; deleted: number; count: number }> {
  let created = 0;
  let updated = 0;
  let deleted = 0;
  const retained = new Set<string>();
  for (const [displayOrder, work] of snapshot.workExperiences.entries()) {
    const fingerprint = sourceFingerprint([work.companyName, work.jobTitle, work.department, work.industryRaw, work.startDate, work.endDate, work.isCurrent]);
    const byRecord = await db.query<{ id: string }>(`
      SELECT id FROM candidate_work_experiences
      WHERE candidate_id = $1 AND source_instance_id = $2 AND source_record_id = $3
      LIMIT 1
    `, [candidateId, sourceInstanceId, work.sourceRecordId]);
    const existing = byRecord.rows[0] ? byRecord : await db.query<{ id: string }>(`
      SELECT id FROM candidate_work_experiences
      WHERE candidate_id = $1 AND source_instance_id = $2 AND source_fingerprint = $3
      LIMIT 1
    `, [candidateId, sourceInstanceId, fingerprint]);
    const logicalRows = existing.rows[0] ? [] : (await db.query<{ id: string; company_name: unknown; job_title: unknown; industry_raw: unknown; start_date: unknown; end_date: unknown; is_current: unknown }>(`
      SELECT id, company_name, job_title, industry_raw, start_date, end_date, is_current
      FROM candidate_work_experiences WHERE candidate_id = $1 AND source_instance_id = $2
    `, [candidateId, sourceInstanceId])).rows;
    const uniqueLogicalMatches = existing.rows[0] ? existing.rows : logicalRows.filter((row) =>
      sameNullableValue(row.company_name, work.companyName)
      && sameNullableDate(row.start_date, work.startDate)
      && sameNullableDate(row.end_date, work.endDate)
      && sameNullableValue(row.is_current, work.isCurrent)
    );
    const fuzzy = !existing.rows[0] && uniqueLogicalMatches.length !== 1 && snapshot.workExperiences.length === logicalRows.length
      ? uniqueHighestMatch(logicalRows, (row) => workLogicalScore(row, work), 7) : null;
    const matched = uniqueLogicalMatches.length === 1 ? uniqueLogicalMatches[0] : fuzzy ?? existing.rows[0];
    if (matched && !retained.has(matched.id)) {
      await db.query(`
        UPDATE candidate_work_experiences
        SET company_name = $1, job_title = $2, department = $3, industry_raw = $4,
            start_date = $5, end_date = $6, is_current = $7, display_order = $8,
            source_fingerprint = $9, source_record_id = $10, source_observed_at = now(), updated_at = now()
        WHERE id = $11
      `, [work.companyName, work.jobTitle, work.department, work.industryRaw, work.startDate, work.endDate, work.isCurrent, displayOrder, fingerprint, work.sourceRecordId, matched.id]);
      updated += 1;
      retained.add(matched.id);
    } else {
      await db.query(`
        INSERT INTO candidate_work_experiences (
          id, candidate_id, source_instance_id, source_record_id, company_name, job_title, department,
          industry_raw, start_date, end_date, is_current, display_order, raw_source_fields, source_fingerprint, source_observed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, '{}'::jsonb, $13, now())
      `, [uuidv7(), candidateId, sourceInstanceId, work.sourceRecordId, work.companyName, work.jobTitle, work.department, work.industryRaw, work.startDate, work.endDate, work.isCurrent, displayOrder, fingerprint]);
      created += 1;
      const inserted = await db.query<{ id: string }>(`
        SELECT id FROM candidate_work_experiences
        WHERE candidate_id = $1 AND source_instance_id = $2 AND source_record_id = $3
        LIMIT 1
      `, [candidateId, sourceInstanceId, work.sourceRecordId]);
      if (inserted.rows[0]?.id) retained.add(inserted.rows[0].id);
    }
  }
  const existingRows = await db.query<{ id: string }>(`
    SELECT id FROM candidate_work_experiences WHERE candidate_id = $1 AND source_instance_id = $2
  `, [candidateId, sourceInstanceId]);
  for (const row of existingRows.rows) {
    if (retained.has(row.id)) continue;
    await db.query('DELETE FROM candidate_work_experiences WHERE id = $1', [row.id]);
    deleted += 1;
  }
  const total = await db.query<CountRow>('SELECT count(*)::text AS count FROM candidate_work_experiences WHERE candidate_id = $1 AND source_instance_id = $2', [candidateId, sourceInstanceId]);
  return { created, updated, deleted, count: count(total) };
}

async function reconcileEducation(db: QueryExecutor, candidateId: string, sourceInstanceId: string, snapshot: PinpinCandidateSnapshot): Promise<{ created: number; updated: number; deleted: number; count: number }> {
  let created = 0;
  let updated = 0;
  let deleted = 0;
  const retained = new Set<string>();
  for (const [displayOrder, education] of snapshot.educations.entries()) {
    const fingerprint = sourceFingerprint([education.schoolName, education.degreeRaw, education.majorRaw, education.descriptionRaw, education.startDate, education.endDate, education.isCurrent]);
    const byRecord = await db.query<{ id: string }>(`
      SELECT id FROM candidate_educations
      WHERE candidate_id = $1 AND source_instance_id = $2 AND source_record_id = $3
      LIMIT 1
    `, [candidateId, sourceInstanceId, education.sourceRecordId]);
    const existing = byRecord.rows[0] ? byRecord : await db.query<{ id: string }>(`
      SELECT id FROM candidate_educations
      WHERE candidate_id = $1 AND source_instance_id = $2 AND source_fingerprint = $3
      LIMIT 1
    `, [candidateId, sourceInstanceId, fingerprint]);
    const logicalRows = existing.rows[0] ? [] : (await db.query<{ id: string; school_name: unknown; degree_raw: unknown; major_raw: unknown; start_date: unknown; end_date: unknown; is_current: unknown }>(`
      SELECT id, school_name, degree_raw, major_raw, start_date, end_date, is_current
      FROM candidate_educations WHERE candidate_id = $1 AND source_instance_id = $2
    `, [candidateId, sourceInstanceId])).rows;
    const uniqueLogicalMatches = existing.rows[0] ? existing.rows : logicalRows.filter((row) =>
      sameNullableValue(row.school_name, education.schoolName)
      && sameNullableValue(row.degree_raw, education.degreeRaw)
      && sameNullableValue(row.major_raw, education.majorRaw)
      && sameNullableDate(row.start_date, education.startDate)
      && sameNullableDate(row.end_date, education.endDate)
      && sameNullableValue(row.is_current, education.isCurrent)
    );
    const fuzzy = !existing.rows[0] && uniqueLogicalMatches.length !== 1 && snapshot.educations.length === logicalRows.length
      ? uniqueHighestMatch(logicalRows, (row) => educationLogicalScore(row, education), 7) : null;
    const matched = uniqueLogicalMatches.length === 1 ? uniqueLogicalMatches[0] : fuzzy ?? existing.rows[0];
    const rawFields = JSON.stringify({ descriptionRaw: education.descriptionRaw });
    if (matched && !retained.has(matched.id)) {
      await db.query(`
        UPDATE candidate_educations
        SET school_name = $1, degree_raw = $2, major_raw = $3, is_current = $4,
            start_date = $5, end_date = $6, display_order = $7, raw_source_fields = $8::jsonb,
            source_fingerprint = $9, source_record_id = $10, source_observed_at = now(), updated_at = now()
        WHERE id = $11
      `, [education.schoolName, education.degreeRaw, education.majorRaw, education.isCurrent, education.startDate, education.endDate, displayOrder, rawFields, fingerprint, education.sourceRecordId, matched.id]);
      updated += 1;
      retained.add(matched.id);
    } else {
      await db.query(`
        INSERT INTO candidate_educations (
          id, candidate_id, source_instance_id, source_record_id, school_name, degree_raw, major_raw,
          start_date, end_date, is_current, display_order, raw_source_fields, source_fingerprint, source_observed_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, now())
      `, [uuidv7(), candidateId, sourceInstanceId, education.sourceRecordId, education.schoolName, education.degreeRaw, education.majorRaw, education.startDate, education.endDate, education.isCurrent, displayOrder, rawFields, fingerprint]);
      created += 1;
      const inserted = await db.query<{ id: string }>(`
        SELECT id FROM candidate_educations
        WHERE candidate_id = $1 AND source_instance_id = $2 AND source_record_id = $3
        LIMIT 1
      `, [candidateId, sourceInstanceId, education.sourceRecordId]);
      if (inserted.rows[0]?.id) retained.add(inserted.rows[0].id);
    }
  }
  const existingRows = await db.query<{ id: string }>(`
    SELECT id FROM candidate_educations WHERE candidate_id = $1 AND source_instance_id = $2
  `, [candidateId, sourceInstanceId]);
  for (const row of existingRows.rows) {
    if (retained.has(row.id)) continue;
    await db.query('DELETE FROM candidate_educations WHERE id = $1', [row.id]);
    deleted += 1;
  }
  const total = await db.query<CountRow>('SELECT count(*)::text AS count FROM candidate_educations WHERE candidate_id = $1 AND source_instance_id = $2', [candidateId, sourceInstanceId]);
  return { created, updated, deleted, count: count(total) };
}

async function reconcileDocuments(db: QueryExecutor, candidateId: string, sourceInstanceId: string, snapshot: PinpinCandidateSnapshot): Promise<{ created: number; updated: number; deleted: number; count: number }> {
  let created = 0;
  let updated = 0;
  let deleted = 0;
  const retained = new Set<string>();
  for (const document of snapshot.documents) {
    const existing = await db.query<{ id: string }>(`
      SELECT id FROM candidate_documents
      WHERE source_instance_id = $1 AND external_document_id = $2
      LIMIT 1
    `, [sourceInstanceId, document.externalDocumentId]);
    if (existing.rows[0]) {
      await db.query(`
        UPDATE candidate_documents
        SET candidate_id = $1, original_filename = $2, file_extension = $3, file_size_bytes = $4,
            source_created_at = $5, last_seen_at = now(), document_status = 'available', updated_at = now()
        WHERE source_instance_id = $6 AND external_document_id = $7
      `, [candidateId, document.originalFilename, document.fileExtension, document.fileSizeBytes, document.sourceCreatedAt, sourceInstanceId, document.externalDocumentId]);
      updated += 1;
      retained.add(existing.rows[0].id);
    } else {
      await db.query(`
        INSERT INTO candidate_documents (
          id, candidate_id, source_instance_id, external_document_id, storage_provider, original_filename,
          file_extension, file_size_bytes, document_role, document_status, source_created_at, metadata
        ) VALUES ($1, $2, $3, $4, 'pinpin_sql_blob', $5, $6, $7, 'attachment', 'available', $8, $9::jsonb)
      `, [uuidv7(), candidateId, sourceInstanceId, document.externalDocumentId, document.originalFilename, document.fileExtension, document.fileSizeBytes, document.sourceCreatedAt, JSON.stringify({ metadataOnly: true })]);
      created += 1;
      const inserted = await db.query<{ id: string }>(`
        SELECT id FROM candidate_documents
        WHERE source_instance_id = $1 AND external_document_id = $2
        LIMIT 1
      `, [sourceInstanceId, document.externalDocumentId]);
      if (inserted.rows[0]?.id) retained.add(inserted.rows[0].id);
    }
  }
  const existingRows = await db.query<{ id: string }>(`
    SELECT id FROM candidate_documents WHERE candidate_id = $1 AND source_instance_id = $2
  `, [candidateId, sourceInstanceId]);
  for (const row of existingRows.rows) {
    if (retained.has(row.id)) continue;
    await db.query('DELETE FROM candidate_documents WHERE id = $1', [row.id]);
    deleted += 1;
  }
  const total = await db.query<CountRow>('SELECT count(*)::text AS count FROM candidate_documents WHERE candidate_id = $1 AND source_instance_id = $2', [candidateId, sourceInstanceId]);
  return { created, updated, deleted, count: count(total) };
}

export class PinpinToTalentNexusReconciler {
  public constructor(private readonly database: DatabasePool, private readonly hooks: ReconciliationHooks = {}) {}

  async reconcileDeletedSynthetic(snapshot: PinpinCandidateSnapshot): Promise<ReconcileResult> {
    if (snapshot.externalCandidateId !== '43177' || snapshot.sourceActive || !snapshot.deletedAt) {
      throw new Error('Phase 4B source candidate state does not match the approved deleted synthetic fixture.');
    }
    if (snapshot.educations.length !== 0 || snapshot.workExperiences.length !== 1 || snapshot.documents.length !== 3) {
      throw new Error('Phase 4B fixture child counts do not match the approved source state.');
    }
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const sourceInstanceId = await ensureSourceInstance(client);
      const existingReference = await findReference(client, sourceInstanceId, snapshot.externalCandidateId);
      const candidate = existingReference ? await candidateIdentity(client, existingReference.candidate_id) : await createCandidate(client, {
        displayName: null,
        canonicalStatus: 'inactive',
        rawSourceMetadata: { sourceSystem: pinpinSourceSystem, sourceInstance: pinpinSourceInstance, syntheticFixture: true },
      });
      await reconcileCandidateProjection(client, candidate.id, snapshot);
      await reconcileExternalReference(client, candidate.id, sourceInstanceId, snapshot);
      const lifecycleEventCreated = await reconcileLifecycle(client, candidate.id, sourceInstanceId, snapshot);
      const work = await reconcileWork(client, candidate.id, sourceInstanceId, snapshot);
      const education = await reconcileEducation(client, candidate.id, sourceInstanceId, snapshot);
      const documents = await reconcileDocuments(client, candidate.id, sourceInstanceId, snapshot);
      const references = await client.query<CountRow>('SELECT count(*)::text AS count FROM candidate_external_refs WHERE candidate_id = $1 AND source_instance_id = $2', [candidate.id, sourceInstanceId]);
      await client.query('COMMIT');
      return {
        candidateCreated: !existingReference,
        materiallyChanged: true,
        candidateId: candidate.id,
        candidateCode: candidate.candidate_code,
        externalReferenceCount: count(references),
        sourceActive: snapshot.sourceActive,
        sourceDeleted: Boolean(snapshot.deletedAt),
        lifecycleEventCreated,
        workCreated: work.created,
        workUpdated: work.updated,
        workDeleted: work.deleted,
        workCount: work.count,
        educationCreated: education.created,
        educationUpdated: education.updated,
        educationDeleted: education.deleted,
        educationCount: education.count,
        documentCreated: documents.created,
        documentUpdated: documents.updated,
        documentDeleted: documents.deleted,
        documentCount: documents.count,
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async reconcileActiveSynthetic(snapshot: PinpinCandidateSnapshot): Promise<ReconcileResult> {
    if (snapshot.externalCandidateId !== '43184' || !snapshot.sourceActive || snapshot.deletedAt || !snapshot.displayName) {
      throw new Error('Phase 4B.2 source candidate state does not match the approved active synthetic fixture.');
    }
    if (snapshot.workExperiences.length !== 2 || snapshot.educations.length !== 1 || snapshot.documents.length !== 2) {
      throw new Error('Phase 4B.2 fixture child counts do not match the approved source state.');
    }
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const sourceInstanceId = await ensureSourceInstance(client);
      const existingReference = await findReference(client, sourceInstanceId, snapshot.externalCandidateId);
      const candidate = existingReference ? await candidateIdentity(client, existingReference.candidate_id) : await createCandidate(client, {
        displayName: snapshot.displayName,
        canonicalStatus: 'active',
        rawSourceMetadata: { sourceSystem: pinpinSourceSystem, sourceInstance: pinpinSourceInstance, syntheticFixture: true },
      });
      await reconcileCandidateProjection(client, candidate.id, snapshot);
      await reconcileExternalReference(client, candidate.id, sourceInstanceId, snapshot);
      const lifecycleEventCreated = await reconcileLifecycle(client, candidate.id, sourceInstanceId, snapshot);
      const work = await reconcileWork(client, candidate.id, sourceInstanceId, snapshot);
      const education = await reconcileEducation(client, candidate.id, sourceInstanceId, snapshot);
      const documents = await reconcileDocuments(client, candidate.id, sourceInstanceId, snapshot);
      const references = await client.query<CountRow>('SELECT count(*)::text AS count FROM candidate_external_refs WHERE candidate_id = $1 AND source_instance_id = $2', [candidate.id, sourceInstanceId]);
      await client.query('COMMIT');
      return {
        candidateCreated: !existingReference,
        materiallyChanged: true,
        candidateId: candidate.id,
        candidateCode: candidate.candidate_code,
        externalReferenceCount: count(references),
        sourceActive: true,
        sourceDeleted: false,
        lifecycleEventCreated,
        workCreated: work.created,
        workUpdated: work.updated,
        workDeleted: work.deleted,
        workCount: work.count,
        educationCreated: education.created,
        educationUpdated: education.updated,
        educationDeleted: education.deleted,
        educationCount: education.count,
        documentCreated: documents.created,
        documentUpdated: documents.updated,
        documentDeleted: documents.deleted,
        documentCount: documents.count,
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async reconcileCandidate(snapshot: PinpinCandidateSnapshot): Promise<ReconcileResult> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const sourceInstanceId = await ensureSourceInstance(client);
      const existingReference = await findReference(client, sourceInstanceId, snapshot.externalCandidateId);
      const fingerprints = snapshotFingerprints(snapshot);
      const candidate = existingReference ? await candidateIdentity(client, existingReference.candidate_id) : await createCandidate(client, {
        displayName: snapshot.displayName,
        canonicalStatus: 'active',
        rawSourceMetadata: { sourceSystem: pinpinSourceSystem, sourceInstance: pinpinSourceInstance },
      });
      const previous = existingReference ? await findSyncState(client, candidate.id, sourceInstanceId) : null;
      const existingCounts = existingReference ? await childCounts(client, candidate.id, sourceInstanceId) : { work: -1, education: -1, documents: -1 };
      const coreChanged = !previous || previous.core_fingerprint !== fingerprints.core;
      const workChanged = !previous || previous.work_fingerprint !== fingerprints.work || existingCounts.work !== snapshot.workExperiences.length;
      const educationChanged = !previous || previous.education_fingerprint !== fingerprints.education || existingCounts.education !== snapshot.educations.length;
      const documentsChanged = !previous || previous.document_fingerprint !== fingerprints.documents || existingCounts.documents !== snapshot.documents.length;
      if (coreChanged) {
        await reconcileCandidateProjection(client, candidate.id, snapshot, false);
        await reconcileExternalReference(client, candidate.id, sourceInstanceId, snapshot);
      }
      const lifecycleEventCreated = coreChanged ? await reconcileLifecycle(client, candidate.id, sourceInstanceId, snapshot, false) : false;
      const work = workChanged ? await reconcileWork(client, candidate.id, sourceInstanceId, snapshot) : { created: 0, updated: 0, deleted: 0, count: existingCounts.work };
      const education = educationChanged ? await reconcileEducation(client, candidate.id, sourceInstanceId, snapshot) : { created: 0, updated: 0, deleted: 0, count: existingCounts.education };
      const documents = documentsChanged ? await reconcileDocuments(client, candidate.id, sourceInstanceId, snapshot) : { created: 0, updated: 0, deleted: 0, count: existingCounts.documents };
      if (coreChanged || workChanged || educationChanged || documentsChanged) await reconcileSyncState(client, candidate.id, sourceInstanceId, fingerprints);
      const references = await client.query<CountRow>('SELECT count(*)::text AS count FROM candidate_external_refs WHERE candidate_id = $1 AND source_instance_id = $2', [candidate.id, sourceInstanceId]);
      await this.hooks.beforeCommit?.({ candidateId: candidate.id, externalCandidateId: snapshot.externalCandidateId });
      await client.query('COMMIT');
      return {
        candidateCreated: !existingReference,
        materiallyChanged: coreChanged || workChanged || educationChanged || documentsChanged,
        candidateId: candidate.id,
        candidateCode: candidate.candidate_code,
        externalReferenceCount: count(references),
        sourceActive: snapshot.sourceActive,
        sourceDeleted: Boolean(snapshot.deletedAt),
        lifecycleEventCreated,
        workCreated: work.created,
        workUpdated: work.updated,
        workDeleted: work.deleted,
        workCount: work.count,
        educationCreated: education.created,
        educationUpdated: education.updated,
        educationDeleted: education.deleted,
        educationCount: education.count,
        documentCreated: documents.created,
        documentUpdated: documents.updated,
        documentDeleted: documents.deleted,
        documentCount: documents.count,
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async reconcileRealPilotCandidate(snapshot: PinpinCandidateSnapshot): Promise<ReconcileResult> {
    if (snapshot.externalCandidateId === '43177' || snapshot.externalCandidateId === '43184' || !snapshot.sourceActive || snapshot.deletedAt || !snapshot.displayName || snapshot.workExperiences.length === 0) {
      throw new Error('Phase 4C source candidate state does not match the approved real-pilot selection contract.');
    }
    return this.reconcileCandidate(snapshot);
  }

  async verifyIntegrity(candidateId: string, candidateCode: string, externalCandidateId: string): Promise<IntegrityResult> {
    const [referenceDuplicates, orphanWork, orphanEducation, orphanDocuments, codeDuplicates, lifecycle] = await Promise.all([
      this.database.query<CountRow>(`
        SELECT count(*)::text AS count
        FROM candidate_external_refs external_ref
        JOIN source_instances source ON source.id = external_ref.source_instance_id
        WHERE source.source_system = $1 AND source.instance_key = $2 AND external_ref.external_candidate_id = $3
      `, [pinpinSourceSystem, pinpinSourceInstance, externalCandidateId]),
      this.database.query<CountRow>('SELECT count(*)::text AS count FROM candidate_work_experiences child LEFT JOIN candidates parent ON parent.id = child.candidate_id WHERE child.candidate_id = $1 AND parent.id IS NULL', [candidateId]),
      this.database.query<CountRow>('SELECT count(*)::text AS count FROM candidate_educations child LEFT JOIN candidates parent ON parent.id = child.candidate_id WHERE child.candidate_id = $1 AND parent.id IS NULL', [candidateId]),
      this.database.query<CountRow>('SELECT count(*)::text AS count FROM candidate_documents child LEFT JOIN candidates parent ON parent.id = child.candidate_id WHERE child.candidate_id = $1 AND parent.id IS NULL', [candidateId]),
      this.database.query<CountRow>('SELECT count(*)::text AS count FROM candidates WHERE candidate_code = $1', [candidateCode]),
      this.database.query<CountRow>('SELECT count(*)::text AS count FROM source_lifecycle_events WHERE candidate_id = $1 AND source_instance_id IN (SELECT id FROM source_instances WHERE source_system = $2 AND instance_key = $3)', [candidateId, pinpinSourceSystem, pinpinSourceInstance])
    ]);
    return {
      externalReferenceDuplicates: Math.max(0, count(referenceDuplicates) - 1),
      orphanWorkRows: count(orphanWork),
      orphanEducationRows: count(orphanEducation),
      orphanDocumentRows: count(orphanDocuments),
      candidateCodeDuplicates: Math.max(0, count(codeDuplicates) - 1),
      lifecycleLinkageValid: count(lifecycle) <= 1,
    };
  }
}
