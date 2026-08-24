import assert from 'node:assert/strict';
import test from 'node:test';
import { selectIncrementalCandidateIds } from '../src/pinpin/incremental-sync.js';

test('incremental sync selects only candidates beyond persisted metadata cursors', () => {
  const selected = selectIncrementalCandidateIds({
    candidateIds: ['10', '11', '12'], candidateIdHighWater: 12, workIdHighWater: 0, educationIdHighWater: 0,
    history: [{ candidateId: '10', stableId: '5', changedAt: null }, { candidateId: '11', stableId: '8', changedAt: null }],
    attachments: [{ candidateId: '12', stableId: '9', changedAt: null }, { candidateId: '10', stableId: '12', changedAt: null }],
    deletions: [{ candidateId: '11', changedAt: '2026-01-02T00:00:00.000Z' }], schema: [],
  }, { candidate_id_highwater: '10', history_id_highwater: '5', attachment_id_highwater: '9', deletion_timestamp_highwater: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(selected, ['10', '11', '12']);
});

test('incremental sync is a no-op when all source signals are at or below cursors', () => {
  const selected = selectIncrementalCandidateIds({
    candidateIds: ['10'], candidateIdHighWater: 10, workIdHighWater: 0, educationIdHighWater: 0,
    history: [{ candidateId: '10', stableId: '5', changedAt: null }], attachments: [{ candidateId: '10', stableId: '9', changedAt: null }], deletions: [], schema: [],
  }, { candidate_id_highwater: '10', history_id_highwater: '5', attachment_id_highwater: '9', deletion_timestamp_highwater: null });
  assert.deepEqual(selected, []);
});

test('timestamp-only history uses its own timestamp cursor', () => {
  const selected = selectIncrementalCandidateIds({
    candidateIds: [], candidateIdHighWater: 10, workIdHighWater: 0, educationIdHighWater: 0,
    history: [{ candidateId: '10', stableId: null, changedAt: '2026-08-15T12:00:00.000Z' }],
    attachments: [], deletions: [], schema: [],
  }, { candidate_id_highwater: '10', history_id_highwater: '999', history_timestamp_highwater: '2026-08-15T11:00:00.000Z' });
  assert.deepEqual(selected, ['10']);
});
