import assert from 'node:assert/strict';
import test from 'node:test';
import { PinpinBlobAttachmentReader, PinpinBlobReadError } from '../src/pinpin/blob-adapter.js';
import { extractResumeText } from '../src/pinpin/resume-text-extractor.js';

function fakeConnection(row: Record<string, unknown> | null) {
  return {
    promises: {
      async query() { return row ? { first: [[row]] } : { first: [[]] }; },
      async close() {}
    }
  } as never;
}

function storedDocx(xml: string): Buffer {
  const name = Buffer.from('word/document.xml', 'utf8');
  const body = Buffer.from(xml, 'utf8');
  const local = Buffer.alloc(30 + name.length + body.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8); local.writeUInt32LE(0, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28); name.copy(local, 30); body.copy(local, 30 + name.length);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8);
  central.writeUInt32LE(body.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42); name.copy(central, 46);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(8, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, end]);
}

test('reads exactly one owned resume BLOB and returns bounded metadata plus SHA', async () => {
  const content = Buffer.from('controlled resume');
  const reader = new PinpinBlobAttachmentReader(fakeConnection({ ID: 1106, ZPResumeInfo_ID: 43213, FileName: 'resume.docx', FileType: 'docx', Filesize: content.length, CreDate: '2026-08-14T15:12:59.300Z', Annex: content }));
  const result = await reader.readAttachmentContent({ atsCandidateId: '43213', attachmentId: '1106' });
  assert.equal(result.fileRef, 'CV1106');
  assert.equal(result.actualSizeBytes, content.length);
  assert.equal(result.declaredSizeMatches, true);
  assert.equal(result.sha256.length, 64);
  assert.deepEqual(result.content, content);
});

test('fails closed for candidate ownership mismatch and non-resume attachments', async () => {
  const mismatch = new PinpinBlobAttachmentReader(fakeConnection({ ID: 1106, ZPResumeInfo_ID: 99999, FileName: 'resume.docx', Filesize: 1, Annex: Buffer.from('x') }));
  await assert.rejects(mismatch.readAttachmentContent({ atsCandidateId: '43213', attachmentId: '1106' }), (error: unknown) => error instanceof PinpinBlobReadError && error.code === 'BLOB_OWNERSHIP_MISMATCH');
  const image = new PinpinBlobAttachmentReader(fakeConnection({ ID: 1075, ZPResumeInfo_ID: 43213, FileName: 'photo.jpg', Filesize: 1, Annex: Buffer.from('x') }));
  await assert.rejects(image.readAttachmentContent({ atsCandidateId: '43213', attachmentId: '1075' }), (error: unknown) => error instanceof PinpinBlobReadError && error.code === 'BLOB_UNSUPPORTED');
});

test('extracts bounded DOCX text without external filesystem or browser state', () => {
  const result = extractResumeText(storedDocx('<w:document><w:body><w:p><w:r><w:t>Engineer &amp; Systems</w:t></w:r></w:p><w:p><w:r><w:t>Experience</w:t></w:r></w:p></w:body></w:document>'), 'docx');
  assert.match(result.text, /Engineer & Systems/);
  assert.match(result.text, /Experience/);
  assert.equal(result.representationKind, 'local_file_text');
});

test('extracts HTML text and excludes script/style content', () => {
  const result = extractResumeText(Buffer.from('<html><style>.x{display:none}</style><script>alert(1)</script><main>Resume<br>Engineer &amp; Analyst</main></html>'), 'html');
  assert.equal(result.text, 'Resume\nEngineer & Analyst');
});

