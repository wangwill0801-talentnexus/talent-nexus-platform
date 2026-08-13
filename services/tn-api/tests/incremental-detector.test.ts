import assert from 'node:assert/strict';
import test from 'node:test';
import { detectCandidates } from '../src/pinpin/incremental-detector.js';

test('incremental detector deduplicates multi-signal candidate discovery and preserves reasons', () => {
  const candidates = detectCandidates([
    { candidateId: '43184', reason: 'candidate_id_highwater', cursor: 'id>43177' },
    { candidateId: '43184', reason: 'candidate_history', cursor: 'history:99' },
    { candidateId: '43184', reason: 'attachment_highwater', cursor: 'attachment:984' },
    { candidateId: '43177', reason: 'delete_tombstone', cursor: 'delete:1' },
  ]);
  assert.deepEqual(candidates, [
    { candidateId: '43177', reasons: ['delete_tombstone'], cursorEvidence: ['delete:1'] },
    { candidateId: '43184', reasons: ['attachment_highwater', 'candidate_history', 'candidate_id_highwater'], cursorEvidence: ['attachment:984', 'history:99', 'id>43177'] },
  ]);
});

test('incremental detector ignores malformed IDs and is replay-stable for equal cursor ties', () => {
  const events = [
    { candidateId: '9', reason: 'candidate_history' as const, cursor: '2026-08-11T00:00:00Z|99' },
    { candidateId: '10', reason: 'candidate_history' as const, cursor: '2026-08-11T00:00:00Z|100' },
    { candidateId: 'bad', reason: 'candidate_id_highwater' as const, cursor: 'id>0' },
  ];
  assert.deepEqual(detectCandidates(events), detectCandidates([...events, ...events]));
  assert.equal(detectCandidates(events).length, 2);
});
