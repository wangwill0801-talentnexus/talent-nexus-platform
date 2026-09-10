import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config/env.js';
import type { CandidateListQuery, CandidateListResult, CandidateRepository } from '../src/domain/candidate.js';
import { buildSearchKeywordsPrompt, runSearchKeywords, sanitizeSearchKeywordsRequest } from '../src/domain/search-keywords.js';
import type { AiProvider } from '../src/ai/types.js';

const config: AppConfig = {
  environment: 'test', host: '127.0.0.1', port: 3333,
  databaseUrl: 'postgres://test:test@127.0.0.1:5432/talentnexus_test', apiToken: 'test-token-that-is-long-enough'
};
const repository: CandidateRepository = {
  async health() {},
  async list(_query: CandidateListQuery): Promise<CandidateListResult> { return { data: [], total: 0 }; },
  async findByIdOrCode() { return null; }
};
const request = { contractVersion: 'search_keywords_v1' as const, source: '104-vip-search' as const, jd: '尋找熟悉 Bluetooth、WiFi、MCU 韌體與硬體除錯的電子工程師。' };
const groups = {
  groups: [
    { groupNumber: 1, label: '精準必備', query: 'Bluetooth AND WiFi AND MCU 韌體', rationale: '鎖定同時具備核心技術的人選。', focus: ['Bluetooth', 'WiFi', 'MCU'] },
    { groupNumber: 2, label: '平衡搜尋', query: '韌體工程師 Bluetooth WiFi', rationale: '放寬組合以增加可用結果。', focus: ['韌體工程師'] },
    { groupNumber: 3, label: '擴展背景', query: '嵌入式 韌體 RTOS', rationale: '尋找可轉移的嵌入式背景。', focus: ['嵌入式', 'RTOS'] },
    { groupNumber: 4, label: '精準限定 1', query: '電子工程師 AND Bluetooth AND MCU', rationale: '只保留 JD 明確的職稱與兩項核心技術。', focus: ['電子工程師', 'Bluetooth', 'MCU'] },
    { groupNumber: 5, label: '精準限定 2', query: '電子工程師 AND WiFi AND 硬體除錯', rationale: '用另一組 JD 明確技術條件縮小結果。', focus: ['電子工程師', 'WiFi', '硬體除錯'] }
  ]
};
function providerWith(value: unknown): AiProvider {
  return {
    providerName: 'test', isConfigured: () => true,
    async generateStructured(input) { assert.match(input.prompt, /(?:104|LinkedIn Recruiter)/); return { text: JSON.stringify(value), json: value }; },
    async embedText() { return { values: [0.1] }; },
    async healthCheck() { return { provider: 'test', configured: true, connectivity: 'pass', generation: 'pass', embedding: 'pass' }; }
  };
}

const linkedinRequest = { contractVersion: 'search_keywords_v1' as const, source: 'linkedin-recruiter-search' as const, jd: 'Senior firmware engineer with Bluetooth, BLE, MCU and RTOS experience in Taipei.' };
function linkedinProvider(value: unknown): AiProvider {
  return {
    providerName: 'test', isConfigured: () => true,
    async generateStructured(input) { assert.match(input.prompt, /LinkedIn Recruiter/); assert.match(input.prompt, /uppercase AND, OR, and NOT/); assert.match(input.prompt, /fieldSuggestions/); return { text: JSON.stringify(value), json: value }; },
    async embedText() { return { values: [0.1] }; },
    async healthCheck() { return { provider: 'test', configured: true, connectivity: 'pass', generation: 'pass', embedding: 'pass' }; }
  };
}

test('keyword request redacts sensitive values and prompt asks for standard plus precision 104 groups', () => {
  const sanitized = sanitizeSearchKeywordsRequest({ ...request, jd: `${request.jd} email recruiter@example.com phone 0912345678` });
  assert.equal(sanitized.jd.includes('recruiter@example.com'), false);
  assert.equal(sanitized.jd.includes('0912345678'), false);
  assert.match(buildSearchKeywordsPrompt(sanitized), /preserve the original 3 to 5 progression groups/);
  assert.match(buildSearchKeywordsPrompt(sanitized), /5 to 8 total keyword groups/);
  assert.match(buildSearchKeywordsPrompt(sanitized), /精準限定/);
});

test('keyword generation validates and sorts standard plus precision groups', async () => {
  const result = await runSearchKeywords(providerWith({ groups: [...groups.groups].reverse() }), request);
  assert.deepEqual(result.groups.map((group) => group.groupNumber), [1, 2, 3, 4, 5]);
  await assert.rejects(() => runSearchKeywords(providerWith({ groups: groups.groups.slice(0, 2) }), request), /SEARCH_KEYWORDS_INVALID_AI_RESPONSE/);
});

test('104 keyword generation rejects precision groups that are broad or not grounded in the JD', async () => {
  const invalid = groups.groups.map((group) => group.groupNumber >= 4
    ? { ...group, query: group.groupNumber === 4 ? '工程師' : '電子' }
    : group);
  await assert.rejects(() => runSearchKeywords(providerWith({ groups: invalid }), request), /SEARCH_KEYWORDS_INVALID_104_PRECISION_GROUP/);
});

test('LinkedIn keyword generation follows Boolean rules and returns conservative fields', async () => {
  const value = { groups: [
    { groupNumber: 1, label: '精準', query: '("firmware engineer" OR "embedded engineer") AND (BLE OR Bluetooth) AND MCU', rationale: '鎖定核心職稱與技能。', focus: ['firmware engineer', 'BLE'] },
    { groupNumber: 2, label: '平衡', query: '(Firmware OR "Embedded Software") AND (RTOS OR MCU)', rationale: '保留相鄰職稱並擴大結果。', focus: ['Firmware', 'RTOS'] },
    { groupNumber: 3, label: '擴展', query: '("embedded systems" OR firmware) AND (Bluetooth OR BLE)', rationale: '尋找可轉移的嵌入式背景。', focus: ['embedded systems'] }
  ], fieldSuggestions: { jobTitles: ['Firmware Engineer', 'Embedded Software Engineer'], locations: ['Taipei'], skills: ['Bluetooth', 'BLE', 'MCU', 'RTOS'] } };
  const result = await runSearchKeywords(linkedinProvider(value), linkedinRequest);
  assert.deepEqual(result.fieldSuggestions, value.fieldSuggestions);
  assert.match(buildSearchKeywordsPrompt(linkedinRequest), /LinkedIn Recruiter/);
  await assert.rejects(() => runSearchKeywords(linkedinProvider({ groups: value.groups.map((group) => ({ ...group, query: group.query + ' *' })) }), linkedinRequest), /SEARCH_KEYWORDS_INVALID_LINKEDIN_QUERY/);
});

test('read-only keyword route is protected and returns structured groups', async () => {
  const entraVerifier = { async verify(authorization?: string) { if (authorization !== 'Bearer entra-test') throw new Error('invalid'); return { tenantId: 'tenant', objectId: 'operator', scopes: ['TN.Sidecar.Write'] }; } };
  const app = buildApp(config, repository, undefined, { entraVerifier, aiProvider: providerWith(groups) });
  const denied = await app.inject({ method: 'POST', url: '/api/v1/plugin-sidecar/search-keywords', payload: request });
  assert.equal(denied.statusCode, 401);
  const invalid = await app.inject({ method: 'POST', url: '/api/v1/plugin-sidecar/search-keywords', headers: { authorization: 'Bearer entra-test' }, payload: { ...request, jd: '短' } });
  assert.equal(invalid.statusCode, 400);
  const allowed = await app.inject({ method: 'POST', url: '/api/v1/plugin-sidecar/search-keywords', headers: { authorization: 'Bearer entra-test' }, payload: request });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.json().data.groups.length, 5);
  const linkedin = await app.inject({ method: 'POST', url: '/api/v1/plugin-sidecar/search-keywords', headers: { authorization: 'Bearer entra-test' }, payload: linkedinRequest });
  assert.equal(linkedin.statusCode, 200);
  assert.equal(linkedin.json().data.source, 'linkedin-recruiter-search');
  await app.close();
});
