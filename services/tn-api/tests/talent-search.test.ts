import assert from 'node:assert/strict';
import test from 'node:test';
import type { TalentSearchCriteria } from '../src/domain/talent-search.js';
import { rankCandidateForSearch } from '../src/services/talent-search-service.js';

const criteria: TalentSearchCriteria = {
  intent: 'candidate_search', targetRoles: ['EE Engineer'], titles: ['Hardware Engineer'],
  skills: ['Bluetooth', 'WiFi'], functions: [], industries: [], companies: [], locations: [],
  languages: [], education: [], seniority: null, minExperienceYears: null,
  mustHave: ['Bluetooth', 'WiFi'], niceToHave: ['RF Matching'], keywords: ['PCB'],
  excluded: [], freeText: '', confidence: 0.92
};

const candidate = {
  candidate_id: '0197a1f8-9876-7fef-9f5a-b70a0eed0001', candidate_code: 'TN00000001',
  display_name: 'Controlled Candidate', location_text: 'Taipei', current_company: 'Controlled Electronics',
  current_title: 'Senior Hardware Engineer', ats_candidate_id: '43222',
  snapshot_id: '0197a1f8-9876-7fef-9f5a-b70a0eed0002', profile_updated_at: '2026-08-13T00:00:00.000Z',
  profile_status: 'completed', professional_summary: 'Board-level electronics design.', recruiter_summary: null,
  work: [{ companyName: 'Controlled Electronics', jobTitle: 'Senior Hardware Engineer', description: 'PCB debug' }],
  education: [], terms: [
    { type: 'skill', value: 'Bluetooth', provenance: 'source_explicit' },
    { type: 'skill', value: 'WiFi', provenance: 'source_explicit' },
    { type: 'target_role', value: 'EE Engineer', provenance: 'ai_normalized' }
  ],
  evidence: [{ sourceType: 'html', sourceSystem: 'local_file_text', contentSha256: 'a'.repeat(64), representationKind: 'connector_text' }]
};

const goldenCandidate = {
  ...candidate,
  candidate_code: 'TN00000188', display_name: 'Golden Hardware Candidate', ats_candidate_id: '43213',
  current_title: '資深工程師',
  work: [
    { companyName: '澔楷科技', jobTitle: '資深硬體工程師', description: 'ARM-based communication devices; LTE / WIFI-BT Module; smart home products; Qualcomm 8X09 and 8X53; circuit and schematic design; layout review; carrier board integration; bring-up; OrCAD.' },
    { companyName: '澔楷科技', jobTitle: '主任工程師', description: 'customer issue analysis and production debugging' }
  ],
  terms: [
    { type: 'skill', value: '工程管理', provenance: 'source_explicit' },
    { type: 'skill', value: 'OrCAD', provenance: 'source_explicit' }
  ]
};

const unrelatedHrCandidate = {
  ...candidate,
  candidate_code: 'TN00000999', display_name: 'Alexa Huang', ats_candidate_id: '43222',
  current_company: 'Independent HR Consultant', current_title: 'HRBP', location_text: '新北',
  professional_summary: 'Human resources business partner and talent acquisition consultant.',
  recruiter_summary: 'HR / recruiting / vendor management background.',
  work: [
    { companyName: 'Independent HR Consultant', jobTitle: 'HRBP', location: '新北', description: 'Talent acquisition, HR consulting, vendor management and global sourcing.' },
    { companyName: 'Self-Employed', jobTitle: 'Talent Acquisition Consultant', location: '新北', description: 'Recruiting and people operations.' }
  ],
  terms: [
    { type: 'skill', value: 'Vendor Management', provenance: 'source_explicit' },
    { type: 'target_role', value: 'HRBP', provenance: 'ai_normalized' }
  ]
};

function goldenCriteria(query: string): TalentSearchCriteria {
  return { ...criteria, targetRoles: [], titles: [], skills: [], mustHave: [], niceToHave: [], keywords: [query], freeText: query, locations: [] };
}

test('golden role recall uses historical titles and work evidence without hardcoding ATS IDs', () => {
  for (const query of ['EE', 'Hardware Engineer', '硬體工程師', 'WiFi Bluetooth EE', 'Qualcomm Hardware']) {
    const result = rankCandidateForSearch(goldenCandidate, goldenCriteria(query));
    assert.ok(result, `expected ${query} to retrieve the golden candidate`);
    assert.equal(result?.atsCandidateId, '43213');
  }
  assert.equal(rankCandidateForSearch(goldenCandidate, goldenCriteria('RF Matching')), null);
});

test('core role eligibility prevents a location match from rescuing an unrelated candidate', () => {
  const locationCriteria = goldenCriteria('EE');
  locationCriteria.locations = ['台北', '新北'];
  const positive = rankCandidateForSearch(goldenCandidate, { ...locationCriteria, locations: ['新北'] });
  const negative = rankCandidateForSearch(unrelatedHrCandidate, locationCriteria);
  assert.ok(positive);
  assert.equal(positive?.atsCandidateId, '43213');
  assert.equal(negative, null);
});

test('deterministic ranking rewards evidence-backed criteria and exposes gaps without inventing facts', () => {
  const result = rankCandidateForSearch(candidate, criteria);
  assert.ok(result); assert.ok(result.matchScore > 70); assert.equal(result.atsCandidateId, '43222');
  assert.equal(result.evidenceStatus, 'content_backed');
  assert.ok(result.matched.some((item) => item.endsWith('Bluetooth')));
  assert.ok(result.needsConfirmation.some((item) => item.includes('RF Matching')));
  assert.ok(!JSON.stringify(result).includes('Verified LinkedIn'));
});

test('excluded criteria remove a candidate before result display', () => {
  assert.equal(rankCandidateForSearch(candidate, { ...criteria, excluded: ['Controlled Electronics'] }), null);
});

test('missing content hash is represented as metadata-only evidence', () => {
  const result = rankCandidateForSearch({ ...candidate, evidence: [{ sourceType: 'linkedin', sourceSystem: 'connector', contentSha256: null }] }, criteria);
  assert.equal(result?.evidenceStatus, 'metadata_only');
  assert.ok(result?.evidenceWarnings.includes('SOURCE_NOT_HASHED'));
});
