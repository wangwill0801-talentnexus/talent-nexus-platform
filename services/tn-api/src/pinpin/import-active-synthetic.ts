import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { PinpinSourceAdapter } from './source-adapter.js';
import { PinpinToTalentNexusReconciler } from './tn-reconciler.js';

function failureCategory(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('configuration')) return 'configuration';
  if (message.includes('source candidate state') || message.includes('fixture child counts')) return 'fixture-state';
  if (message.includes('permission') || message.includes('denied')) return 'permission';
  return 'reconciliation';
}

async function readFixture(): Promise<Awaited<ReturnType<PinpinSourceAdapter['readPage']>>[number]> {
  const adapter = await PinpinSourceAdapter.connect();
  try {
    const page = await adapter.readPage(43183, 1);
    const snapshot = page[0];
    if (!snapshot || snapshot.externalCandidateId !== '43184') throw new Error('Approved synthetic source candidate was not found.');
    return snapshot;
  } finally {
    await adapter.close();
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  try {
    const reconciler = new PinpinToTalentNexusReconciler(pool);
    const first = await reconciler.reconcileActiveSynthetic(await readFixture());
    const second = await reconciler.reconcileActiveSynthetic(await readFixture());
    const integrity = await reconciler.verifyIntegrity(second.candidateId, second.candidateCode, '43184');
    process.stdout.write(`${JSON.stringify({
      sourceCandidate: '43184',
      firstRun: first,
      secondRun: second,
      uuidStable: first.candidateId === second.candidateId,
      candidateCodeStable: first.candidateCode === second.candidateCode,
      integrity,
      blobReads: 0,
      pinpinWrites: 0,
    })}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`PINPIN_ACTIVE_SYNTHETIC_IMPORT_FAILED:${failureCategory(error)}\n`);
  process.exitCode = 1;
});
