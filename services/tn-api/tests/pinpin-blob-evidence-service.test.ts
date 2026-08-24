import assert from 'node:assert/strict';
import test from 'node:test';
import { PinpinBlobEvidenceService } from '../src/services/pinpin-blob-evidence-service.js';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config/env.js';

const appConfig: AppConfig = { environment: 'test', host: '127.0.0.1', port: 3333, databaseUrl: 'postgres://test:test@127.0.0.1:5432/test', apiToken: 'controlled-test-token' };

const candidate = {
  externalCandidateId: '43213', displayName: null, sourceActive: true, primaryEmail: null, primaryPhone: null,
  locationText: null, desiredLocationsRaw: null, topEducationRaw: null, birthDateRaw: null, genderRaw: null,
  salaryRaw: null, tagsRaw: null, sourceRaw: null, noteRaw: null, deletedAt: null, workExperiences: [], educations: [],
  documents: [
    { externalDocumentId: '1056', candidateExternalId: '43213', originalFilename: '簡歷原件.html', fileExtension: 'htm', fileSizeBytes: 12, sourceCreatedAt: '2026-08-13T00:00:00.000Z', fileRef: 'CV1056', classification: { filenameRaw: '簡歷原件.html', filenameNormalized: '簡歷原件.html', extension: 'html', documentType: 'resume' as const, sourceOrigin: 'pinpin_imported_original' as const, classificationBasis: 'test', classificationConfidence: 'high' as const, isPrimaryResumeCandidate: true } },
    { externalDocumentId: '1105', candidateExternalId: '43213', originalFilename: 'Talent Nexus-report.pdf', fileExtension: 'pdf', fileSizeBytes: 12, sourceCreatedAt: '2026-08-14T00:00:00.000Z', fileRef: 'CV1105', classification: { filenameRaw: 'Talent Nexus-report.pdf', filenameNormalized: 'Talent Nexus-report.pdf', extension: 'pdf', documentType: 'recruiter_submission_report' as const, sourceOrigin: 'recruiter_submission' as const, classificationBasis: 'test', classificationConfidence: 'high' as const, isPrimaryResumeCandidate: false } },
    { externalDocumentId: '1106', candidateExternalId: '43213', originalFilename: 'resume.docx', fileExtension: 'docx', fileSizeBytes: 12, sourceCreatedAt: '2026-08-15T00:00:00.000Z', fileRef: 'CV1106', classification: { filenameRaw: 'resume.docx', filenameNormalized: 'resume.docx', extension: 'docx', documentType: 'resume' as const, sourceOrigin: 'manual_upload_assumed' as const, classificationBasis: 'test', classificationConfidence: 'medium' as const, isPrimaryResumeCandidate: true } }
  ]
};

function storedDocx(xml: string): Buffer {
  const name = Buffer.from('word/document.xml'); const body = Buffer.from(xml);
  const local = Buffer.alloc(30 + name.length + body.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(name.length, 26); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22); name.copy(local, 30); body.copy(local, 30 + name.length);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); name.copy(central, 46);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}

test('BLOB evidence service selects the deterministic newest resume and sends only text to existing intake', async () => {
  const requests: unknown[] = [];
  const db = { async query() { return { rows: [{ candidate_id: '00000000-0000-7000-8000-000000000001' }] }; } } as never;
  const service = new PinpinBlobEvidenceService(
    db,
    { async readCandidate() { return candidate as never; } },
    async () => ({
      async readAttachmentContent(request: { atsCandidateId: string; attachmentId: string }) {
        assert.deepEqual(request, { atsCandidateId: '43213', attachmentId: '1106' });
        const content = storedDocx('<w:document><w:body><w:p><w:r><w:t>Controlled Engineer</w:t></w:r></w:p></w:body></w:document>');
        return { atsCandidateId: '43213', attachmentId: '1106', fileRef: 'CV1106', filename: 'resume.docx', extension: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', classification: candidate.documents[2]!.classification, declaredSizeBytes: content.length, actualSizeBytes: content.length, declaredSizeMatches: true, sourceCreatedAt: '2026-08-15T00:00:00.000Z', sha256: 'a'.repeat(64), content };
      },
      async close() {}
    } as never),
    { async intake(request: unknown) { requests.push(request); return { status: 'created', candidateId: '00000000-0000-7000-8000-000000000001', evidenceId: 'evidence', contentSha256: 'b'.repeat(64), snapshotId: null, processingStatus: 'queued' }; } } as never
  );
  const result = await service.ingestBestResume('43213');
  assert.equal(result.attachment.attachmentId, '1106');
  assert.equal(result.status, 'created');
  assert.equal(result.processingStatus, 'queued');
  assert.equal(requests.length, 1);
  assert.equal((requests[0] as { source: { attachmentReference: string } }).source.attachmentReference, 'CV1106');
});

test('internal Pinpin BLOB trigger is bearer-protected and returns metadata only', async () => {
  const fakeRepository = { async health() {}, async list() { return { data: [], total: 0 }; }, async findByIdOrCode() { return null; } } as never;
  const app = buildApp(appConfig, fakeRepository, undefined, {
    pinpinBlobEvidence: { async ingestBestResume(identifier: string) { return { status: 'unchanged', atsCandidateId: identifier, attachment: { attachmentId: '1106', fileRef: 'CV1106' }, actualBlobBytes: 47929, declaredSizeBytes: 47929, declaredSizeMatches: true, rawSha256: 'a'.repeat(64), normalizedTextCharacters: 10, contentSha256: 'b'.repeat(64), evidenceId: 'evidence', snapshotId: 'snapshot', processingStatus: 'queued' }; } }
  });
  const unauthorized = await app.inject({ method: 'POST', url: '/internal/pinpin/candidate-evidence/43213' });
  const accepted = await app.inject({ method: 'POST', url: '/internal/pinpin/candidate-evidence/43213', headers: { authorization: `Bearer ${appConfig.apiToken}` } });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.includes('Controlled'), false);
  await app.close();
});
