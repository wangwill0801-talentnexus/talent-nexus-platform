import { loadConfig } from '../dist/config/env.js';
import { createPool } from '../dist/db/pool.js';
import { PinpinSourceAdapter } from '../dist/pinpin/source-adapter.js';
import { PinpinToTalentNexusReconciler } from '../dist/pinpin/tn-reconciler.js';

const atsCandidateId = Number(process.argv[2]);
if (!Number.isSafeInteger(atsCandidateId) || atsCandidateId < 1) throw new Error('A numeric ATS Candidate ID is required.');
const pool = createPool(loadConfig().databaseUrl);
const source = await PinpinSourceAdapter.connect();
try {
  const snapshot = await source.readCandidate(atsCandidateId);
  if (!snapshot) throw new Error('Source candidate not found.');
  try {
    const result = await new PinpinToTalentNexusReconciler(pool).reconcileCandidate(snapshot);
    process.stdout.write(`${JSON.stringify({ status: 'succeeded', atsCandidateId: String(atsCandidateId), materiallyChanged: result.materiallyChanged })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      status: 'failed',
      atsCandidateId: String(atsCandidateId),
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: error && typeof error === 'object' && 'code' in error ? String(error.code) : null,
      sanitizedMessage: error instanceof Error ? error.message : 'unknown',
    })}\n`);
    process.exitCode = 2;
  }
} finally {
  await source.close();
  await pool.end();
}
