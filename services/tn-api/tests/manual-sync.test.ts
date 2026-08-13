import assert from 'node:assert/strict';
import test from 'node:test';
import { manualSyncExitCode } from '../src/pinpin/manual-sync-contract.js';
import { releaseManualPinpinSyncLock, tryAcquireManualPinpinSyncLock } from '../src/pinpin/manual-sync-lock.js';

test('manual sync exit semantics reject runner, candidate, and integrity failures', () => {
  assert.equal(manualSyncExitCode({ runnerExitCode: 0, failedCandidates: 0, integrityOk: true }), 0);
  assert.equal(manualSyncExitCode({ runnerExitCode: 1, failedCandidates: 0, integrityOk: true }), 1);
  assert.equal(manualSyncExitCode({ runnerExitCode: 0, failedCandidates: 1, integrityOk: true }), 4);
  assert.equal(manualSyncExitCode({ runnerExitCode: 0, failedCandidates: 0, integrityOk: false }), 5);
});

test('manual sync advisory lock permits one holder and rejects a concurrent holder', async () => {
  let held = false;
  const client = { query: async <T>(sql: string): Promise<{ rows: T[] }> => {
    if (sql.includes('pg_try_advisory_lock')) {
      const acquired = !held; held = true;
      return { rows: [{ acquired } as T] };
    }
    if (sql.includes('pg_advisory_unlock')) { held = false; return { rows: [] }; }
    throw new Error('unexpected SQL');
  } };
  assert.equal(await tryAcquireManualPinpinSyncLock(client), true);
  assert.equal(await tryAcquireManualPinpinSyncLock(client), false);
  await releaseManualPinpinSyncLock(client);
  assert.equal(await tryAcquireManualPinpinSyncLock(client), true);
});
