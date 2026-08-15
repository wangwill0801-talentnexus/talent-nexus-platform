import assert from 'node:assert/strict';
import test from 'node:test';
import { PinpinEvidenceRequestService } from '../src/services/pinpin-evidence-request-service.js';

function fakeDatabase(evidence = false) {
  return {
    async query(sql: string) {
      if (sql.includes('candidate_external_refs')) return { rows: [{ candidate_id: '00000000-0000-7000-8000-000000000001' }] };
      if (sql.includes('candidate_documents')) return { rows: [
        { external_document_id: '1056', original_filename: '簡歷原件.html', file_size_bytes: '6621', source_created_at: '2026-08-11T00:00:00.000Z' },
        { external_document_id: '1075', original_filename: '用户签名照.jpg', file_size_bytes: '928293', source_created_at: '2026-08-11T00:00:00.000Z' }
      ] };
      if (sql.includes('candidate_resume_evidence')) return { rows: evidence ? [{ id: 'evidence-1' }] : [] };
      throw new Error(`unexpected query: ${sql}`);
    }
  } as never;
}

test('evidence request selects CV1056 and excludes the image attachment', async () => {
  const result = await new PinpinEvidenceRequestService(fakeDatabase()).resolve('43213');
  assert.equal(result?.status, 'evidence_required');
  assert.equal(result?.attachment?.attachmentId, '1056');
  assert.equal(result?.attachment?.fileRef, 'CV1056');
  assert.equal(result?.attachment?.documentType, 'resume');
});

test('same content-backed attachment is already_latest', async () => {
  const result = await new PinpinEvidenceRequestService(fakeDatabase(true)).resolve('43213');
  assert.equal(result?.status, 'already_latest');
});

test('invalid or missing scoped identity fails closed', async () => {
  const result = await new PinpinEvidenceRequestService({ async query() { return { rows: [] }; } } as never).resolve('not-an-ats-id');
  assert.equal(result, null);
});
