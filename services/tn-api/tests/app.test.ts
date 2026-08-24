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

test('internal processing controls are authenticated, bounded and never submit ATS data', async () => {
  const calls:string[]=[];
  const processing={
    async enqueueByIdentifier(_id:string,operation:string){calls.push(operation);return {status:'created' as const,job:{id:'0197a1f8-9876-7fef-9f5a-b70a0eed0002',status:'queued',operation}};},
    async retryJob(id:string){calls.push('retry:'+id);return {id,status:'queued',operation:'rebuild_projection'};},
    async runOne(){return null;}
  };
  const app=buildApp(config,repository,undefined,{processing:processing as never});
  const denied=await app.inject({method:'POST',url:'/internal/data-browser/candidates/43198/processing',payload:{operation:'rebuild_projection'}});assert.equal(denied.statusCode,401);
  const invalid=await app.inject({method:'POST',url:'/internal/data-browser/candidates/43198/processing',headers:{authorization:`Bearer ${config.apiToken}`},payload:{operation:'delete_candidate'}});assert.equal(invalid.statusCode,400);
  const queued=await app.inject({method:'POST',url:'/internal/data-browser/candidates/43198/processing',headers:{authorization:`Bearer ${config.apiToken}`},payload:{operation:'rebuild_projection'}});assert.equal(queued.statusCode,202);
  const retry=await app.inject({method:'POST',url:'/internal/data-browser/processing/0197a1f8-9876-7fef-9f5a-b70a0eed0002/retry',headers:{authorization:`Bearer ${config.apiToken}`}});assert.equal(retry.statusCode,202);
  assert.deepEqual(calls,['rebuild_projection','retry:0197a1f8-9876-7fef-9f5a-b70a0eed0002']);
  await app.close();
});

test('talent search and Candidate Intelligence routes keep the TN service token boundary', async () => {
  const talentSearch = {
    async coverage() { return { aiReady: 7 }; },
    async search() { return { coverage: { aiReady: 7 }, results: [], scoreDefinition: 'recruiting_match_score' as const }; },
    async searchQuery(query: string, limit: number, mustMatchAll?: boolean) { assert.equal(query, 'Bluetooth EE'); assert.equal(limit, 5); assert.equal(mustMatchAll, true); return { coverage: { aiReady: 7 }, results: [], scoreDefinition: 'recruiting_match_score' as const }; }
  };
  const candidateIntelligence = {
    async get(identifier: string) { return identifier === '43222' ? { candidateId: 'controlled', atsCandidateId: '43222' } : null; }
  };
  const app = buildApp(config, repository, undefined, { talentSearch, candidateIntelligence });
  const denied = await app.inject({ method: 'POST', url: '/api/v1/talent-search', payload: { criteria: {} } });
  assert.equal(denied.statusCode, 401);
  const headers = { authorization: `Bearer ${config.apiToken}` };
  const coverage = await app.inject({ method: 'GET', url: '/api/v1/talent-search/coverage', headers });
  assert.deepEqual(coverage.json(), { data: { aiReady: 7 } });
  const search = await app.inject({ method: 'POST', url: '/api/v1/talent-search', headers, payload: { criteria: { intent: 'candidate_search', skills: ['Bluetooth'] } } });
  assert.equal(search.statusCode, 200);
  const naturalSearch = await app.inject({ method: 'POST', url: '/api/v1/talent-search', headers, payload: { query: 'Bluetooth EE', limit: 5, mustMatchAll: true } });
  assert.equal(naturalSearch.statusCode, 200);
  const candidate = await app.inject({ method: 'GET', url: '/api/v1/candidate-intelligence/43222', headers });
  assert.equal(candidate.statusCode, 200);
  const invalid = await app.inject({ method: 'GET', url: '/api/v1/candidate-intelligence/not-valid', headers });
  assert.equal(invalid.statusCode, 400);
  await app.close();
});

test('Job Context routes use exact Pinpin Job identity and delegate search without ATS writes', async () => {
  const jobContext = {
    async upsert(input: Record<string, unknown>) { return { externalJobId: input.externalJobId, title: input.title, fingerprint: 'a'.repeat(64) }; },
    async get(id: string) { return id === '106' ? { externalJobId: id, title: 'EE Engineer', fingerprint: 'a'.repeat(64) } : null; },
    async searchQuery(id: string) { return id === '106' ? 'EE Engineer\nBluetooth' : null; }
  };
  const talentSearch = {
    async searchQuery(query: string, limit: number) { assert.equal(query, 'EE Engineer\nBluetooth'); assert.equal(limit, 10); return { coverage: { aiReady: 7 }, results: [], scoreDefinition: 'recruiting_match_score' as const }; },
    async coverage() { return { aiReady: 7 }; },
    async search() { return { coverage: { aiReady: 7 }, results: [], scoreDefinition: 'recruiting_match_score' as const }; }
  };
  const app = buildApp(config, repository, undefined, { jobContext, talentSearch });
  const headers = { authorization: `Bearer ${config.apiToken}` };
  const invalid = await app.inject({ method: 'POST', url: '/api/v1/jobs/context', headers, payload: { sourceSystem: 'pinpin', sourceInstance: 'pinpin-prod', externalJobId: 'not-a-job' } });
  assert.equal(invalid.statusCode, 400);
  const created = await app.inject({ method: 'POST', url: '/api/v1/jobs/context', headers, payload: { sourceSystem: 'pinpin', sourceInstance: 'pinpin-prod', externalJobId: '106', title: 'EE Engineer' } });
  assert.equal(created.statusCode, 200);
  const job = await app.inject({ method: 'GET', url: '/api/v1/jobs/106', headers });
  assert.equal(job.statusCode, 200);
  const searched = await app.inject({ method: 'POST', url: '/api/v1/jobs/106/search', headers, payload: { limit: 10 } });
  assert.equal(searched.statusCode, 200);
  assert.equal(searched.json().data.queryQuality, 'title_or_structured_only');
  assert.match(searched.json().data.queryWarning, /JD/);
  const unknown = await app.inject({ method: 'GET', url: '/api/v1/jobs/999', headers });
  assert.equal(unknown.statusCode, 404);
  await app.close();
});
