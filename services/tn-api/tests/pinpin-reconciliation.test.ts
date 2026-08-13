import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DataType, newDb } from 'pg-mem';
import { runMigrations } from '../src/db/migrations.js';
import type { DatabasePool } from '../src/db/pool.js';
import type { PinpinCandidateSnapshot } from '../src/pinpin/source-adapter.js';
import { PinpinToTalentNexusReconciler } from '../src/pinpin/tn-reconciler.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = join(here, '..', 'migrations');
type TestPool = DatabasePool;

async function makeDatabase(): Promise<TestPool> {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.public.registerOperator({ operator: '~', left: DataType.text, right: DataType.text, returns: DataType.bool, implementation: (value: string, pattern: string) => new RegExp(pattern).test(value) });
  memory.public.registerFunction({ name: 'trim', args: [DataType.text], returns: DataType.text, implementation: (value: string) => value.trim() });
  memory.public.registerFunction({ name: 'length', args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
  memory.public.registerFunction({ name: 'lpad', args: [DataType.text, DataType.integer, DataType.text], returns: DataType.text, implementation: (value: string, size: number, fill: string) => `${fill.repeat(Math.max(0, size - value.length))}${value}`.slice(-size) });
  const adapter = memory.adapters.createPg();
  const pool = new adapter.Pool();
  await runMigrations(pool as unknown as { query: DatabasePool['query']; connect: DatabasePool['connect'] }, migrationDirectory);
  return pool as unknown as TestPool;
}

const baseFields = {
  desiredLocationsRaw: null, topEducationRaw: null, birthDateRaw: null, genderRaw: null, salaryRaw: null, tagsRaw: null, noteRaw: null,
};

const deletedFixture: PinpinCandidateSnapshot = {
  externalCandidateId: '43177', displayName: null, sourceActive: false, primaryEmail: null, primaryPhone: null, locationText: null,
  ...baseFields, sourceRaw: 'synthetic', deletedAt: '2026-08-11T14:14:43.560Z',
  workExperiences: [{ sourceRecordId: '640', companyName: 'Synthetic Co', jobTitle: 'Synthetic Title', department: null, industryRaw: null, startDate: '2024-01-01', endDate: null, isCurrent: true }],
  educations: [],
  documents: [
    { externalDocumentId: '982', candidateExternalId: '43177', originalFilename: 'one.html', fileExtension: 'html', fileSizeBytes: 1, sourceCreatedAt: null },
    { externalDocumentId: '983', candidateExternalId: '43177', originalFilename: 'two.pdf', fileExtension: 'pdf', fileSizeBytes: 2, sourceCreatedAt: null },
    { externalDocumentId: '984', candidateExternalId: '43177', originalFilename: 'three.pdf', fileExtension: 'pdf', fileSizeBytes: 3, sourceCreatedAt: null },
  ],
};

const activeFixture: PinpinCandidateSnapshot = {
  externalCandidateId: '43184', displayName: 'Active Synthetic Candidate', sourceActive: true,
  primaryEmail: 'active@example.invalid', primaryPhone: '0913755058', locationText: 'Taipei',
  desiredLocationsRaw: 'Taipei', topEducationRaw: 'Bachelor', birthDateRaw: '1999', genderRaw: 'male', salaryRaw: 4560000, tagsRaw: 'synthetic',
  sourceRaw: 'synthetic', noteRaw: 'Synthetic note', deletedAt: null,
  workExperiences: [
    { sourceRecordId: '672', companyName: 'Current Synthetic Co', jobTitle: 'Current Title', department: 'Current Dept', industryRaw: 'Testing', startDate: '2024-01-01', endDate: null, isCurrent: true },
    { sourceRecordId: '673', companyName: 'Previous Synthetic Co', jobTitle: 'Previous Title', department: 'Previous Dept', industryRaw: 'Testing', startDate: '2022-01-01', endDate: '2023-12-01', isCurrent: false },
  ],
  educations: [{ sourceRecordId: '178', schoolName: 'Synthetic University', degreeRaw: 'Bachelor', majorRaw: 'Computer Science', descriptionRaw: 'Synthetic education description', startDate: '2020-09-01', endDate: '2024-06-01', isCurrent: true }],
  documents: [
    { externalDocumentId: '1001', candidateExternalId: '43184', originalFilename: 'resume.pdf', fileExtension: 'pdf', fileSizeBytes: 1, sourceCreatedAt: null },
    { externalDocumentId: '1002', candidateExternalId: '43184', originalFilename: 'profile.html', fileExtension: 'html', fileSizeBytes: 2, sourceCreatedAt: null },
  ],
};

test('deleted synthetic import is idempotent, preserves lifecycle, and only reconciles metadata', async () => {
  const pool = await makeDatabase();
  const reconciler = new PinpinToTalentNexusReconciler(pool);
  const first = await reconciler.reconcileDeletedSynthetic(deletedFixture);
  const second = await reconciler.reconcileDeletedSynthetic(deletedFixture);
  const integrity = await reconciler.verifyIntegrity(second.candidateId, second.candidateCode, '43177');
  assert.equal(first.candidateCreated, true);
  assert.equal(first.sourceDeleted, true);
  assert.equal(second.candidateCreated, false);
  assert.equal(second.workCreated, 0);
  assert.equal(second.documentCreated, 0);
  assert.equal(second.lifecycleEventCreated, false);
  assert.equal(integrity.externalReferenceDuplicates, 0);
  assert.equal(integrity.orphanDocumentRows, 0);
  const docs = await pool.query<{ metadata: unknown }>('SELECT metadata FROM candidate_documents WHERE candidate_id = $1', [first.candidateId]);
  assert.equal(JSON.stringify(docs.rows).includes('Annex'), false);
  await pool.end();
});

test('active synthetic import maps verified core fields and reruns idempotently', async () => {
  const pool = await makeDatabase();
  const reconciler = new PinpinToTalentNexusReconciler(pool);
  const first = await reconciler.reconcileActiveSynthetic(activeFixture);
  const second = await reconciler.reconcileActiveSynthetic(activeFixture);
  const reassignedSourceRows = await reconciler.reconcileActiveSynthetic({
    ...activeFixture,
    workExperiences: activeFixture.workExperiences.map((work) => ({ ...work, sourceRecordId: `reissued-${work.sourceRecordId}` })),
    educations: activeFixture.educations.map((education) => ({ ...education, sourceRecordId: `reissued-${education.sourceRecordId}` })),
  });
  const integrity = await reconciler.verifyIntegrity(second.candidateId, second.candidateCode, '43184');
  assert.equal(first.candidateCreated, true);
  assert.equal(first.sourceActive, true);
  assert.equal(first.sourceDeleted, false);
  assert.equal(first.workCount, 2);
  assert.equal(first.educationCount, 1);
  assert.equal(first.documentCount, 2);
  assert.equal(first.lifecycleEventCreated, false);
  assert.equal(second.candidateCreated, false);
  assert.equal(second.candidateId, first.candidateId);
  assert.equal(second.candidateCode, first.candidateCode);
  assert.equal(second.workCreated, 0);
  assert.equal(second.educationCreated, 0);
  assert.equal(second.documentCreated, 0);
  assert.equal(reassignedSourceRows.workCreated, 0);
  assert.equal(reassignedSourceRows.educationCreated, 0);
  assert.equal(reassignedSourceRows.workCount, 2);
  assert.equal(reassignedSourceRows.educationCount, 1);
  assert.equal(integrity.externalReferenceDuplicates, 0);
  assert.equal(integrity.orphanWorkRows, 0);
  assert.equal(integrity.orphanEducationRows, 0);
  assert.equal(integrity.orphanDocumentRows, 0);
  assert.equal(integrity.candidateCodeDuplicates, 0);
  assert.equal(integrity.lifecycleLinkageValid, true);
  const candidate = await pool.query<{ display_name: string; primary_phone: string; location_text: string }>('SELECT display_name, primary_phone, location_text FROM candidates WHERE id = $1', [first.candidateId]);
  assert.deepEqual(candidate.rows[0], { display_name: 'Active Synthetic Candidate', primary_phone: '0913755058', location_text: 'Taipei' });
  await pool.end();
});

test('active importer rejects a non-active or incomplete source fixture before writing', async () => {
  const pool = await makeDatabase();
  const reconciler = new PinpinToTalentNexusReconciler(pool);
  await assert.rejects(reconciler.reconcileActiveSynthetic({ ...activeFixture, sourceActive: false }));
  const candidates = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM candidates');
  assert.equal(candidates.rows[0]?.count, '0');
  await pool.end();
});

test('real-pilot reconciliation keeps exactly one external identity and sync state', async () => {
  const pool = await makeDatabase();
  const reconciler = new PinpinToTalentNexusReconciler(pool);
  const pilotFixture: PinpinCandidateSnapshot = {
    ...activeFixture,
    externalCandidateId: '50001',
    documents: activeFixture.documents.map((document, index) => ({ ...document, externalDocumentId: String(2000 + index), candidateExternalId: '50001' })),
  };
  const first = await reconciler.reconcileRealPilotCandidate(pilotFixture);
  const second = await reconciler.reconcileRealPilotCandidate(pilotFixture);
  assert.equal(first.candidateCreated, true);
  assert.equal(first.materiallyChanged, true);
  assert.equal(second.candidateCreated, false);
  assert.equal(second.materiallyChanged, false);
  assert.equal(first.candidateId, second.candidateId);
  assert.equal(first.candidateCode, second.candidateCode);
  assert.equal(second.workCreated, 0);
  assert.equal(second.workUpdated, 0);
  assert.equal(second.educationCreated, 0);
  assert.equal(second.educationUpdated, 0);
  assert.equal(second.documentCreated, 0);
  assert.equal(second.documentUpdated, 0);
  const syncStates = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM candidate_sync_state WHERE candidate_id = $1', [first.candidateId]);
  assert.equal(syncStates.rows[0]?.count, '1');
  await pool.end();
});

test('full-population reconciler accepts inactive source records and preserves a true no-op rerun', async () => {
  const pool = await makeDatabase();
  const reconciler = new PinpinToTalentNexusReconciler(pool);
  const snapshot: PinpinCandidateSnapshot = {
    ...activeFixture,
    externalCandidateId: '50002',
    sourceActive: false,
    deletedAt: null,
    documents: activeFixture.documents.map((document, index) => ({ ...document, externalDocumentId: String(3000 + index), candidateExternalId: '50002' })),
  };
  const first = await reconciler.reconcileCandidate(snapshot);
  const second = await reconciler.reconcileCandidate(snapshot);
  assert.equal(first.candidateCreated, true);
  assert.equal(first.sourceActive, false);
  assert.equal(first.sourceDeleted, false);
  assert.equal(first.lifecycleEventCreated, true);
  assert.equal(second.candidateCreated, false);
  assert.equal(second.materiallyChanged, false);
  assert.equal(second.lifecycleEventCreated, false);
  assert.equal(first.candidateId, second.candidateId);
  assert.equal(first.candidateCode, second.candidateCode);
  await pool.end();
});

test('full reconciliation updates only changed entity groups and removes stale child rows', async () => {
  const pool = await makeDatabase();
  const reconciler = new PinpinToTalentNexusReconciler(pool);
  const fixture: PinpinCandidateSnapshot = {
    ...activeFixture,
    externalCandidateId: '50003',
    documents: activeFixture.documents.map((document, index) => ({ ...document, externalDocumentId: String(4000 + index), candidateExternalId: '50003' })),
  };
  const initial = await reconciler.reconcileCandidate(fixture);
  const core = await reconciler.reconcileCandidate({ ...fixture, displayName: 'Active Synthetic Candidate Core Trace' });
  assert.equal(core.candidateId, initial.candidateId);
  assert.equal(core.workUpdated, 0);
  assert.equal(core.educationUpdated, 0);
  assert.equal(core.documentUpdated, 0);

  const workEdit = await reconciler.reconcileCandidate({
    ...fixture,
    displayName: 'Active Synthetic Candidate Core Trace',
    workExperiences: fixture.workExperiences.map((work, index) => index === 0 ? { ...work, department: 'Work Edit Trace' } : work),
  });
  assert.equal(workEdit.workCount, 2);
  assert.equal(workEdit.educationUpdated, 0);
  assert.equal(workEdit.documentUpdated, 0);

  const workAdded: PinpinCandidateSnapshot = {
    ...fixture,
    displayName: 'Active Synthetic Candidate Core Trace',
    workExperiences: [...fixture.workExperiences, { sourceRecordId: '674', companyName: 'Work Add Trace', jobTitle: 'Work Add Trace', department: null, industryRaw: null, startDate: '2025-01-01', endDate: null, isCurrent: false }],
  };
  const workAdd = await reconciler.reconcileCandidate(workAdded);
  assert.equal(workAdd.workCreated, 1);
  assert.equal(workAdd.workCount, 3);
  const workDelete = await reconciler.reconcileCandidate({ ...fixture, displayName: 'Active Synthetic Candidate Core Trace' });
  assert.equal(workDelete.workDeleted, 1);
  assert.equal(workDelete.workCount, 2);

  const educationAdded: PinpinCandidateSnapshot = {
    ...fixture,
    displayName: 'Active Synthetic Candidate Core Trace',
    educations: [...fixture.educations, { sourceRecordId: '179', schoolName: 'Education Add Trace', degreeRaw: null, majorRaw: null, descriptionRaw: 'Education Add Trace', startDate: null, endDate: null, isCurrent: false }],
  };
  const educationAdd = await reconciler.reconcileCandidate(educationAdded);
  assert.equal(educationAdd.educationCreated, 1);
  const educationDelete = await reconciler.reconcileCandidate({ ...fixture, displayName: 'Active Synthetic Candidate Core Trace' });
  assert.equal(educationDelete.educationDeleted, 1);
  assert.equal(educationDelete.educationCount, 1);

  const documentAdded: PinpinCandidateSnapshot = {
    ...fixture,
    displayName: 'Active Synthetic Candidate Core Trace',
    documents: [...fixture.documents, { externalDocumentId: '4002', candidateExternalId: '50003', originalFilename: 'metadata-only.pdf', fileExtension: 'pdf', fileSizeBytes: 3, sourceCreatedAt: null }],
  };
  const documentAdd = await reconciler.reconcileCandidate(documentAdded);
  assert.equal(documentAdd.documentCreated, 1);
  const documentDelete = await reconciler.reconcileCandidate({ ...fixture, displayName: 'Active Synthetic Candidate Core Trace' });
  assert.equal(documentDelete.documentDeleted, 1);
  assert.equal(documentDelete.documentCount, 2);

  const finalNoop = await reconciler.reconcileCandidate({ ...fixture, displayName: 'Active Synthetic Candidate Core Trace' });
  assert.equal(finalNoop.materiallyChanged, false);
  assert.equal(finalNoop.candidateId, initial.candidateId);
  assert.equal(finalNoop.candidateCode, initial.candidateCode);
  const integrity = await reconciler.verifyIntegrity(initial.candidateId, initial.candidateCode, '50003');
  assert.equal(integrity.externalReferenceDuplicates, 0);
  assert.equal(integrity.orphanWorkRows, 0);
  assert.equal(integrity.orphanEducationRows, 0);
  assert.equal(integrity.orphanDocumentRows, 0);
  await pool.end();
});

test('reissued Pinpin child IDs with a single logical edit retain TN child UUIDs', async () => {
  const pool = await makeDatabase();
  const reconciler = new PinpinToTalentNexusReconciler(pool);
  const fixture: PinpinCandidateSnapshot = {
    ...activeFixture,
    externalCandidateId: '50004',
    documents: activeFixture.documents.map((document, index) => ({ ...document, externalDocumentId: String(5000 + index), candidateExternalId: '50004' })),
  };
  const initial = await reconciler.reconcileCandidate(fixture);
  const beforeWork = await pool.query<{ id: string }>('SELECT id FROM candidate_work_experiences WHERE candidate_id = $1 AND source_record_id = $2', [initial.candidateId, '672']);
  const beforeEducation = await pool.query<{ id: string }>('SELECT id FROM candidate_educations WHERE candidate_id = $1 AND source_record_id = $2', [initial.candidateId, '178']);
  const changed = await reconciler.reconcileCandidate({
    ...fixture,
    workExperiences: fixture.workExperiences.map((work, index) => ({ ...work, sourceRecordId: `reissued-work-${index}`, department: index === 0 ? 'Work edit trace' : work.department })),
    educations: fixture.educations.map((education) => ({ ...education, sourceRecordId: 'reissued-education', descriptionRaw: 'Education edit trace' })),
  });
  assert.equal(changed.workCreated, 0);
  assert.equal(changed.workDeleted, 0);
  assert.equal(changed.educationCreated, 0);
  assert.equal(changed.educationDeleted, 0);
  const afterWork = await pool.query<{ id: string }>('SELECT id FROM candidate_work_experiences WHERE candidate_id = $1 AND source_record_id = $2', [initial.candidateId, 'reissued-work-0']);
  const afterEducation = await pool.query<{ id: string }>('SELECT id FROM candidate_educations WHERE candidate_id = $1 AND source_record_id = $2', [initial.candidateId, 'reissued-education']);
  assert.equal(afterWork.rows[0]?.id, beforeWork.rows[0]?.id);
  assert.equal(afterEducation.rows[0]?.id, beforeEducation.rows[0]?.id);
  const noOp = await reconciler.reconcileCandidate({
    ...fixture,
    workExperiences: fixture.workExperiences.map((work, index) => ({ ...work, sourceRecordId: `reissued-work-${index}`, department: index === 0 ? 'Work edit trace' : work.department })),
    educations: fixture.educations.map((education) => ({ ...education, sourceRecordId: 'reissued-education', descriptionRaw: 'Education edit trace' })),
  });
  assert.equal(noOp.materiallyChanged, false);
  await pool.end();
});

test('reissued work IDs with an unambiguous title edit retain UUID and ambiguous rows fail closed', async () => {
  const pool = await makeDatabase();
  const reconciler = new PinpinToTalentNexusReconciler(pool);
  const fixture: PinpinCandidateSnapshot = { ...activeFixture, externalCandidateId: '50005', documents: [] };
  const first = await reconciler.reconcileCandidate(fixture);
  const before = await pool.query<{ id: string }>('SELECT id FROM candidate_work_experiences WHERE candidate_id = $1 AND source_record_id = $2', [first.candidateId, '672']);
  const changed = await reconciler.reconcileCandidate({ ...fixture, workExperiences: fixture.workExperiences.map((work, index) => ({ ...work, sourceRecordId: `title-${index}`, jobTitle: index === 0 ? 'Title edit trace' : work.jobTitle })) });
  const after = await pool.query<{ id: string }>('SELECT id FROM candidate_work_experiences WHERE candidate_id = $1 AND source_record_id = $2', [first.candidateId, 'title-0']);
  assert.equal(changed.workCreated, 0);
  assert.equal(after.rows[0]?.id, before.rows[0]?.id);
  const ambiguous: PinpinCandidateSnapshot = { ...fixture, externalCandidateId: '50006', documents: [], workExperiences: [
    { ...fixture.workExperiences[0], sourceRecordId: 'a', companyName: 'Same', jobTitle: 'One', startDate: '2024-01-01', endDate: null, isCurrent: true },
    { ...fixture.workExperiences[0], sourceRecordId: 'b', companyName: 'Same', jobTitle: 'Two', startDate: '2024-01-01', endDate: null, isCurrent: true },
  ] };
  await reconciler.reconcileCandidate(ambiguous);
  await assert.rejects(reconciler.reconcileCandidate({ ...ambiguous, workExperiences: ambiguous.workExperiences.map((work, index) => ({ ...work, sourceRecordId: `new-${index}`, jobTitle: `Changed ${index}` })) }), /ambiguous-child-identity/);
  await pool.end();
});

test('test-only transaction fault rolls back one candidate and replay converges without identity duplication', async () => {
  const pool = await makeDatabase();
  const statements: string[] = [];
  const trackedPool = {
    query: pool.query.bind(pool),
    end: pool.end.bind(pool),
    connect: async () => {
      const client = await pool.connect();
      return {
        query: async (...args: Parameters<typeof client.query>) => {
          statements.push(String(args[0]));
          return client.query(...args);
        },
        release: client.release.bind(client),
      };
    },
  } as unknown as TestPool;
  const fixture: PinpinCandidateSnapshot = {
    ...activeFixture,
    externalCandidateId: '50007',
    documents: activeFixture.documents.map((document, index) => ({ ...document, externalDocumentId: String(7000 + index), candidateExternalId: '50007' })),
  };
  const failing = new PinpinToTalentNexusReconciler(trackedPool, {
    beforeCommit: () => { throw new Error('test-only-controlled-transaction-fault'); },
  });
  await assert.rejects(failing.reconcileCandidate(fixture), /test-only-controlled-transaction-fault/);
  assert.equal(statements.includes('COMMIT'), false, 'faulted candidate transaction must not commit');
  assert.equal(statements.includes('ROLLBACK'), true, 'faulted candidate transaction must explicitly roll back');
  await pool.end();

  // pg-mem does not model transaction rollback faithfully; use a clean target
  // to verify that a subsequently replayed source aggregate converges normally.
  const replayPool = await makeDatabase();
  const replay = new PinpinToTalentNexusReconciler(replayPool);
  const recovered = await replay.reconcileCandidate(fixture);
  const noOp = await replay.reconcileCandidate(fixture);
  const integrity = await replay.verifyIntegrity(recovered.candidateId, recovered.candidateCode, '50007');
  assert.equal(recovered.candidateCreated, true);
  assert.equal(noOp.candidateCreated, false);
  assert.equal(noOp.materiallyChanged, false);
  assert.equal(noOp.candidateId, recovered.candidateId);
  assert.equal(noOp.candidateCode, recovered.candidateCode);
  assert.equal(integrity.externalReferenceDuplicates, 0);
  assert.equal(integrity.candidateCodeDuplicates, 0);
  assert.equal(integrity.orphanWorkRows, 0);
  assert.equal(integrity.orphanEducationRows, 0);
  assert.equal(integrity.orphanDocumentRows, 0);
  await replayPool.end();
});
