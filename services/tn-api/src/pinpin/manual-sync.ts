import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { PoolClient } from 'pg';
import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { PinpinSourceAdapter, pinpinSourceTransport } from './source-adapter.js';
import { manualSyncExitCode } from './manual-sync-contract.js';
import { releaseManualPinpinSyncLock, tryAcquireManualPinpinSyncLock } from './manual-sync-lock.js';

type FullResult = {
  runId?: string;
  source: { totalCandidates: number };
  firstRun: { observed: number; created: number; materiallyUpdated: number; unchanged: number; failed: number };
  secondRun: { created: number; materiallyUpdated: number; unchanged: number; failed: number };
  final: { duplicateRefs: number; duplicateCodes: number; orphanWork: number; orphanEducation: number; orphanDocuments: number };
  totalDurationMs: number;
};

const configPaths = ['E:\\TalentNexus\\config\\tn-api.env', 'E:\\TalentNexus\\config\\pinpin-source.env'];

function emit(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function parseResult(output: string): FullResult | null {
  for (const line of output.split(/\r?\n/).reverse()) {
    try { return JSON.parse(line) as FullResult; } catch { /* find the runner's final JSON only */ }
  }
  return null;
}

async function runApprovedRunner(): Promise<{ exitCode: number; result: FullResult | null }> {
  const directory = dirname(fileURLToPath(import.meta.url));
  const environment: NodeJS.ProcessEnv = { ...process.env, TN_SYNC_RUN_LABEL: '4E.4-manual-production' };
  delete environment.TN_RECOVERY_TEST_MODE;
  delete environment.TN_RECOVERY_TEST_ABORT_AFTER;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(directory, 'import-full.js')], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ exitCode: code ?? 1, result: parseResult(stdout) }));
  });
}

async function main(): Promise<void> {
  for (const path of configPaths) process.loadEnvFile(path);
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  let lockClient: PoolClient | null = null;
  try {
    const database = await pool.query<{ name: string }>('SELECT current_database() AS name');
    if (database.rows[0]?.name !== 'talentnexus') throw new Error('manual-preflight-postgresql-database');
    lockClient = await pool.connect();
    if (!await tryAcquireManualPinpinSyncLock(lockClient)) {
      emit({ title: 'Talent Nexus Pinpin Manual Sync', status: 'failed', category: 'lock-held', exitCode: 3 });
      process.exitCode = 3;
      return;
    }
    const adapter = await PinpinSourceAdapter.connect();
    let source;
    try { source = await adapter.readPreflight(); } finally { await adapter.close(); }
    const runner = await runApprovedRunner();
    const result = runner.result;
    const failedCandidates = (result?.firstRun.failed ?? 1) + (result?.secondRun.failed ?? 0);
    const final = result?.final;
    const integrityOk = final != null && final.duplicateRefs === 0 && final.duplicateCodes === 0 && final.orphanWork === 0 && final.orphanEducation === 0 && final.orphanDocuments === 0;
    const exitCode = manualSyncExitCode({ runnerExitCode: runner.exitCode, failedCandidates, integrityOk });
    if (exitCode !== 0 && result?.runId) {
      await pool.query("UPDATE sync_runs SET status = 'failed', finished_at = COALESCE(finished_at, now()), metadata = metadata || '{\"manualCommandFailed\":true}'::jsonb WHERE id = $1", [result.runId]);
    }
    emit({
      title: 'Talent Nexus Pinpin Manual Sync', status: exitCode === 0 ? 'succeeded' : 'failed', exitCode,
      observed: result?.firstRun.observed ?? 0, created: result?.firstRun.created ?? 0, materiallyUpdated: result?.firstRun.materiallyUpdated ?? 0,
      unchanged: result?.firstRun.unchanged ?? 0, failed: failedCandidates, durationMs: result?.totalDurationMs ?? null,
      syncRunId: result?.runId ?? null, pinpinTransport: pinpinSourceTransport,
      duplicateExternalRefs: result?.final.duplicateRefs ?? null, duplicateCandidateCodes: result?.final.duplicateCodes ?? null,
      orphanWork: result?.final.orphanWork ?? null, orphanEducation: result?.final.orphanEducation ?? null, orphanDocuments: result?.final.orphanDocuments ?? null,
      pinpinWrites: 0, blobReads: 0,
    });
    process.exitCode = exitCode;
  } catch (error) {
    const category = error instanceof Error && error.message.startsWith('manual-preflight-') ? 'preflight-failed' : 'manual-runner-failed';
    emit({ title: 'Talent Nexus Pinpin Manual Sync', status: 'failed', category, exitCode: 2 });
    process.exitCode = 2;
  } finally {
    if (lockClient) {
      try { await releaseManualPinpinSyncLock(lockClient); } catch { /* session release still clears advisory locks */ }
      lockClient.release();
    }
    await pool.end();
  }
}

main();
