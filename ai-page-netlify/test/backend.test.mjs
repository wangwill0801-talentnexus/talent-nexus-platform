// ai-page-netlify/test/backend.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateResume } from '../lib/validate-resume.mjs';
import { STANDARD_RESUME_JSON_SCHEMA, MOCK_RESUME } from '../lib/resume-schema.mjs';

test('validateResume coerces and tolerates missing fields', () => {
  const r = validateResume({
    candidate: { name: '  ANON  ', phone: '', email: null },
    experience: [{ company: 'X', isCurrent: 'yes' }],
    skills: ['JS']
  });
  assert.equal(r.ok, true);
  assert.equal(r.resume.candidate.name, 'ANON');
  assert.equal(r.resume.candidate.phone, null); // empty string -> null
  assert.equal(r.resume.experience[0].isCurrent, false); // 'yes' -> false
  assert.deepEqual(r.resume.skills, ['JS']);
});

test('validateResume rejects structurally impossible input', () => {
  const r = validateResume({ foo: 1 });
  assert.equal(r.ok, false);
});

test('mock resume validates through the pipeline', () => {
  const r = validateResume(JSON.parse(JSON.stringify(MOCK_RESUME)));
  assert.equal(r.ok, true);
  assert.equal(r.resume.experience.length, 2);
  assert.equal(r.resume.education.length, 1);
  assert.equal(r.resume.candidate.email, 'anon.test-001@example.invalid');
});

test('schema requires candidate', () => {
  assert.deepEqual(STANDARD_RESUME_JSON_SCHEMA.required, ['candidate']);
});

test('auth: no key => token not required (mock-friendly)', async () => {
  const { verifyAuth } = await import('../lib/auth.mjs');
  const r = verifyAuth({ headers: {} });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'TEST ONLY');
  assert.equal(r.tokenRequired, false);
});

test('auth: key set + wrong token => rejected', async () => {
  process.env.GEMINI_API_KEY = 'dummy-key';
  process.env.AI_TEST_TOKEN = 'secret-123';
  const { verifyAuth } = await import('../lib/auth.mjs');
  const bad = verifyAuth({ headers: { authorization: 'Bearer wrong' } });
  assert.equal(bad.ok, false);
  const good = verifyAuth({ headers: { authorization: 'Bearer secret-123' } });
  assert.equal(good.ok, true);
  delete process.env.GEMINI_API_KEY; delete process.env.AI_TEST_TOKEN;
});
