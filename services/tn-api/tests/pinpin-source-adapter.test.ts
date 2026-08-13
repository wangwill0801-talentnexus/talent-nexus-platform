import assert from 'node:assert/strict';
import test from 'node:test';
import { mapSnapshot, rowsFrom } from '../src/pinpin/source-adapter.js';

test('Pinpin source mapping retains only approved metadata and lifecycle fields', () => {
  const snapshot = mapSnapshot(
    { ID: 43177, Active: 0, A0101: 'Synthetic Candidate', A0102: 'male', A0103: '1999', A01099: 4560000, A0118: '0900000000', A0122: 'synthetic@example.invalid', A0112: 'Test location', A0202: 'Desired locations', A0124: 'Degree', A9901: 'tag', CVSource: 'Synthetic', LastRemark: 'Synthetic note' },
    [{ ID: 640, ResumeID: 43177, YearB: '2024-01', YearE: null, Company: 'Synthetic Co', F1: 'Synthetic title', F5: 'Current department', Industry: 'Testing', IsCur: 1 }],
    [{ ID: 91, ResumeID: 43177, YearB: '2020-09', YearE: '2024-06', School: 'Synthetic University', F1: 'Degree', F2: 'Major', detail: 'Synthetic description', IsCur: 0 }],
    [{ ID: 984, ZPResumeInfo_ID: 43177, FileName: 'test.pdf', FileType: 'pdf', Filesize: 2819, CreDate: '2026-08-11T13:58:27.500Z', Annex: 'must-not-map' }],
    [{ FID: 43177, DelDate: '2026-08-11T14:14:43.560Z' }],
  );

  assert.equal(snapshot.externalCandidateId, '43177');
  assert.equal(snapshot.sourceActive, false);
  assert.equal(snapshot.displayName, 'Synthetic Candidate');
  assert.equal(snapshot.genderRaw, 'male');
  assert.equal(snapshot.birthDateRaw, '1999');
  assert.equal(snapshot.salaryRaw, 4560000);
  assert.equal(snapshot.noteRaw, 'Synthetic note');
  assert.equal(snapshot.primaryPhone, '0900000000');
  assert.equal(snapshot.primaryEmail, 'synthetic@example.invalid');
  assert.equal(snapshot.locationText, 'Test location');
  assert.equal(snapshot.desiredLocationsRaw, 'Desired locations');
  assert.equal(snapshot.topEducationRaw, 'Degree');
  assert.equal(snapshot.workExperiences[0]?.department, 'Current department');
  assert.equal(snapshot.workExperiences[0]?.startDate, '2024-01-01');
  assert.equal(snapshot.educations[0]?.descriptionRaw, 'Synthetic description');
  assert.equal(snapshot.educations[0]?.startDate, '2020-09-01');
  assert.equal(snapshot.educations[0]?.endDate, '2024-06-01');
  assert.equal(snapshot.documents[0]?.externalDocumentId, '984');
  assert.deepEqual(Object.keys(snapshot.documents[0] || {}).sort(), ['candidateExternalId', 'externalDocumentId', 'fileExtension', 'fileSizeBytes', 'originalFilename', 'sourceCreatedAt']);
  assert.ok(snapshot.deletedAt);
});

test('native driver result normalization accepts the documented first recordset shape', () => {
  assert.deepEqual(rowsFrom({ first: [{ ID: 1 }] }), [{ ID: 1 }]);
  assert.deepEqual(rowsFrom([[{ ID: 1 }]]), [{ ID: 1 }]);
});
