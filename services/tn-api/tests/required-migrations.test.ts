import assert from 'node:assert/strict';
import test from 'node:test';
import { hasCompleteRequiredMigrationLedger, requiredMigrationIds } from '../src/db/required-migrations.js';

test('Pinpin reconciliation requires every reviewed TN migration but permits later migrations', () => {
  assert.equal(requiredMigrationIds.length, 5);
  assert.equal(hasCompleteRequiredMigrationLedger(5), true);
  assert.equal(hasCompleteRequiredMigrationLedger(4), false);
  assert.equal(hasCompleteRequiredMigrationLedger(6), false);
});
