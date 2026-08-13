import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config/env.js';
import type { CandidateListQuery, CandidateListResult, CandidateRepository } from '../src/domain/candidate.js';

const config: AppConfig = {
  environment: 'test', host: '127.0.0.1', port: 3333,
  databaseUrl: 'postgres://test:test@127.0.0.1:5432/talentnexus_test', apiToken: 'test-token-that-is-long-enough'
};

const repository: CandidateRepository = {
  async health() { return; },
  async list(_query: CandidateListQuery): Promise<CandidateListResult> {
    return {
      data: [{ id: '0197a1f8-9876-7fef-9f5a-b70a0eed0001', candidateCode: 'TN00000001', displayName: 'TN SYSTEM API TEST', primaryEmail: null, primaryPhone: null, locationText: null, currentCompany: null, currentTitle: null, canonicalStatus: 'active', createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z' }],
      total: 1
    };
  },
  async findByIdOrCode(value) {
    if (value !== 'TN00000001') return null;
    return {
      id: '0197a1f8-9876-7fef-9f5a-b70a0eed0001', candidateCode: 'TN00000001', displayName: 'TN SYSTEM API TEST', primaryEmail: null, primaryPhone: null, locationText: null, currentCompany: null, currentTitle: null, canonicalStatus: 'active', rawSourceMetadata: {}, createdAt: '2026-08-11T00:00:00.000Z', updatedAt: '2026-08-11T00:00:00.000Z', externalReferences: [], workExperiences: [], educations: [], documents: [], tags: []
    };
  }
};

test('health is minimal and unauthenticated', async () => {
  const app = buildApp(config, repository);
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { data: { status: 'ok', service: 'tn-api', version: '0.1.0', database: 'connected' } });
  await app.close();
});

test('candidate routes require a bearer token and return bounded pagination', async () => {
  const app = buildApp(config, repository);
  const denied = await app.inject({ method: 'GET', url: '/api/v1/candidates' });
  assert.equal(denied.statusCode, 401);
  const allowed = await app.inject({ method: 'GET', url: '/api/v1/candidates?limit=1', headers: { authorization: `Bearer ${config.apiToken}` } });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.json().pagination.total, 1);
  await app.close();
});

test('candidate identifier validation and not-found response are sanitized', async () => {
  const app = buildApp(config, repository);
  const headers = { authorization: `Bearer ${config.apiToken}` };
  const invalid = await app.inject({ method: 'GET', url: '/api/v1/candidates/not-a-candidate', headers });
  assert.deepEqual(invalid.json(), { error: { code: 'VALIDATION_ERROR', message: 'Invalid candidate identifier.' } });
  const missing = await app.inject({ method: 'GET', url: '/api/v1/candidates/TN00000099', headers });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: { code: 'CANDIDATE_NOT_FOUND', message: 'Candidate was not found.' } });
  await app.close();
});

test('internal data browser serves a thin UI and protects candidate data with the existing bearer boundary', async () => {
  const dataBrowser = { async inspect(value: string) { return value === '43198' ? { header: { atsCandidateId: '43198' }, rawAiSnapshot: { payload: { schemaVersion: 'standard_resume_v1' } } } : null; } };
  const app = buildApp(config, repository, undefined, { dataBrowser });
  const page = await app.inject({ method: 'GET', url: '/internal/data-browser' });
  assert.equal(page.statusCode, 200); assert.match(page.body, /Candidate Data Browser/);
  const denied = await app.inject({ method: 'GET', url: '/internal/data-browser/candidates/43198' });
  assert.equal(denied.statusCode, 401);
  const allowed = await app.inject({ method: 'GET', url: '/internal/data-browser/candidates/43198', headers: { authorization: `Bearer ${config.apiToken}` } });
  assert.equal(allowed.statusCode, 200); assert.equal(allowed.json().data.header.atsCandidateId, '43198');
  const missing = await app.inject({ method: 'GET', url: '/internal/data-browser/candidates/43199', headers: { authorization: `Bearer ${config.apiToken}` } });
  assert.equal(missing.statusCode, 404);
  await app.close();
});
