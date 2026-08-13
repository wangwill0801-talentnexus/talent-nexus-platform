import assert from 'node:assert/strict';
import test from 'node:test';
import type { TalentSearchCriteria } from '../src/domain/talent-search.js';
import { rankCandidateForSearch } from '../src/services/talent-search-service.js';

const criteria: TalentSearchCriteria = {
  intent: 'candidate_search',
  targetRoles: ['EE Engineer'],
  titles: ['Hardware Engineer'],
  skills: ['Bluetooth', 'WiFi'],
  functions: [],
  industries: [],
  companies: [],
  locations: ['台北'],
  languages: [],
  education: [],
  seniority: null,
  minExperienceYears: null,
  mustHave: ['Bluetooth', 'WiFi'],
  niceToHave: ['RF Matching'],
  keywords: ['PCB'],
  excluded: [],
  freeText: '',
  confidence: 0.92
};

const candidate = {
  candidate_id: '0197a1f8-9876-7fef-9f5a-b70a0eed0001',
  candidate_code: 'TN00000001',
  display_name: 'Controlled Candidate',
  location_text: '台北市',
  current_company: 'Controlled Electronics',
  current_title: 'Senior Hardware Engineer',
  ats_candidate_id: '43222',
  snapshot_id: '0197a1f8-9876-7fef-9f5a-b70a0eed0002',
  profile_updated_at: '2026-08-13T00:00:00.000Z',
  profile_status: 'completed',
  professional_summary: 'Board-level electronics design.',
  recruiter_summary: null,
  work: [{ companyName: 'Controlled Electronics', jobTitle: 'Senior Hardware Engineer', description: 'PCB debug' }],
  education: [],
  terms: [
    { type: 'skill', value: 'Bluetooth', provenance: 'source_explicit' },
    { type: 'skill', value: 'WiFi', provenance: 'source_explicit' },
    { type: 'target_role', value: 'EE Engineer', provenance: 'ai_normalized' }
  ],
  evidence: [{ sourceType: 'html', sourceSystem: 'local_file_text', contentSha256: 'a'.repeat(64), representationKind: 'connector_text' }]
};

test('deterministic ranking rewards evidence-backed criteria and exposes gaps without inventing facts', () => {
  const result = rankCandidateForSearch(candidate, criteria);
  assert.ok(result);
  assert.ok(result.matchScore > 70);
  assert.equal(result.atsCandidateId, '43222');
  assert.equal(result.evidenceStatus, 'content_backed');
  assert.ok(result.matched.includes('技能: Bluetooth'));
  assert.ok(result.needsConfirmation.some((item) => item.includes('RF Matching')));
  assert.ok(!JSON.stringify(result).includes('Verified LinkedIn'));
});

test('excluded criteria remove a candidate before result display', () => {
  const result = rankCandidateForSearch(candidate, { ...criteria, excluded: ['Controlled Electronics'] });
  assert.equal(result, null);
});

test('missing content hash is represented as metadata-only evidence', () => {
  const result = rankCandidateForSearch({ ...candidate, evidence: [{ sourceType: 'linkedin', sourceSystem: 'connector', contentSha256: null }] }, criteria);
  assert.equal(result?.evidenceStatus, 'metadata_only');
  assert.ok(result?.evidenceWarnings.includes('SOURCE_NOT_HASHED'));
});
