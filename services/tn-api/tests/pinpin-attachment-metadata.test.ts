import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPinpinAttachment, choosePreferredResume, derivePinpinFileRef, toPinpinAttachmentMetadata } from '../src/pinpin/attachment-metadata.js';

test('Pinpin attachment IDs deterministically map to CV refs', () => {
  assert.equal(derivePinpinFileRef(1056), 'CV1056');
  assert.equal(derivePinpinFileRef('1075'), 'CV1075');
});

test('traditional and simplified original resume names are high-confidence resumes', () => {
  for (const filename of ['簡歷原件.html', '简历原件.html', '簡歷原件.htm', '简历原件.htm']) {
    const result = classifyPinpinAttachment(filename);
    assert.equal(result.documentType, 'resume');
    assert.equal(result.sourceOrigin, 'pinpin_imported_original');
    assert.equal(result.classificationConfidence, 'high');
    assert.equal(result.isPrimaryResumeCandidate, true);
    assert.equal(result.filenameRaw, filename);
  }
});

test('images are excluded and recruiter reports remain separate evidence', () => {
  assert.equal(classifyPinpinAttachment('用户签名照.jpg').isPrimaryResumeCandidate, false);
  assert.equal(classifyPinpinAttachment('用户签名照.jpg').documentType, 'other');
  const report = classifyPinpinAttachment('Talent Nexus-客戶名稱-職缺名稱-人選姓名-日期.pdf');
  assert.equal(report.documentType, 'recruiter_submission_report');
  assert.equal(report.isPrimaryResumeCandidate, false);
});

test('preferred resume selection fails closed when equally plausible', () => {
  const a = toPinpinAttachmentMetadata({ candidateId: 43213, attachmentId: 1056, filename: '簡歷原件.html' });
  const b = toPinpinAttachmentMetadata({ candidateId: 43213, attachmentId: 1057, filename: 'resume.pdf' });
  assert.equal(choosePreferredResume([a, b]).status, 'needs_review');
  assert.equal(choosePreferredResume([a]).attachment?.fileRef, 'CV1056');
});
