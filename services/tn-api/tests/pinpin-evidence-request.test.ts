import assert from 'node:assert/strict';
import test from 'node:test';
import { PinpinEvidenceRequestService } from '../src/services/pinpin-evidence-request-service.js';

function fakeDatabase(evidence = false) {
  return {
    async query(sql: string) {
      if (sql.includes('candidate_external_refs')) return { rows: [{ candidate_id: '00000000-0000-7000-8000-000000000001' }] };
      if (sql.includes('candidate_resume_evidence')) return { rows: evidence ? [{ id: 'evidence-1' }] : [] };
      throw new Error(`unexpected query: ${sql}`);
    }
  } as never;
}

function fakeSource() {
  return {
    async readCandidate() {
      return {
        externalCandidateId: '43213',
        documents: [
          { externalDocumentId: '1056', originalFilename: '簡歷原件.html', fileExtension: 'htm', fileSizeBytes: 6621, sourceCreatedAt: '2026-08-13T14:54:42.430Z' },
          { externalDocumentId: '1075', originalFilename: '用户签名照.jpg', fileExtension: 'jpg', fileSizeBytes: 928293, sourceCreatedAt: '2026-08-13T21:04:01.533Z' },
          { externalDocumentId: '1105', originalFilename: 'Talent Nexus-Raytac-EE Engineer-蔣建隆-20260814.pdf', fileExtension: 'pdf', fileSizeBytes: 322425, sourceCreatedAt: '2026-08-14T15:02:29.607Z' },
          { externalDocumentId: '1106', originalFilename: '蔣建隆_優化履歷_Raytac_EE_Engineer.docx', fileExtension: 'docx', fileSizeBytes: 47929, sourceCreatedAt: '2026-08-14T15:12:59.300Z' }
        ]
      };
    }
  } as never;
}

test('evidence request selects the newer CV1106 resume and excludes image/report attachments', async () => {
  const result = await new PinpinEvidenceRequestService(fakeDatabase(), fakeSource()).resolve('43213');
  assert.equal(result?.status, 'evidence_required');
  assert.equal(result?.attachment?.attachmentId, '1106');
  assert.equal(result?.attachment?.fileRef, 'CV1106');
  assert.equal(result?.attachment?.filenameRaw, '蔣建隆_優化履歷_Raytac_EE_Engineer.docx');
  assert.equal(result?.attachment?.documentType, 'resume');
});

test('same content-backed attachment is already_latest', async () => {
  const result = await new PinpinEvidenceRequestService(fakeDatabase(true), fakeSource()).resolve('43213');
  assert.equal(result?.status, 'already_latest');
});

test('invalid or missing scoped identity fails closed', async () => {
  const result = await new PinpinEvidenceRequestService({ async query() { return { rows: [] }; } } as never, fakeSource()).resolve('not-an-ats-id');
  assert.equal(result, null);
});
