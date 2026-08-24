import { v7 as uuidv7 } from 'uuid';
import { pathToFileURL } from 'node:url';
import { loadProtectedEnvFile } from '../config/protected-env.js';
import { loadConfig } from '../config/env.js';
import { createPool, type DatabasePool } from '../db/pool.js';
import { PinpinSourceAdapter, type PinpinIncrementalSignalSnapshot } from './source-adapter.js';
import { PinpinToTalentNexusReconciler, pinpinSourceInstance, pinpinSourceSystem } from './tn-reconciler.js';
import { releaseManualPinpinSyncLock, tryAcquireManualPinpinSyncLock } from './manual-sync-lock.js';

type CursorMap = Record<string, string | null>;

export function selectIncrementalCandidateIds(snapshot: PinpinIncrementalSignalSnapshot, cursors: CursorMap): string[] {
  const candidateHighWater = Number(cursors.candidate_id_highwater ?? '0');
  const attachmentHighWater = Number(cursors.attachment_id_highwater ?? '0');
  const historyHighWater = Number(cursors.history_id_highwater ?? '0');
  const historyTimestampHighWater = cursors.history_timestamp_highwater ? Date.parse(cursors.history_timestamp_highwater) : 0;
  const deletionHighWater = cursors.deletion_timestamp_highwater ? Date.parse(cursors.deletion_timestamp_highwater) : 0;
  const ids = new Set<string>();
  for (const candidateId of snapshot.candidateIds) if (Number(candidateId) > candidateHighWater) ids.add(candidateId);
  for (const event of snapshot.attachments) if (Number(event.stableId) > attachmentHighWater) ids.add(event.candidateId);
  for (const event of snapshot.history) {
    if (event.stableId && Number(event.stableId) > historyHighWater) ids.add(event.candidateId);
    else if (!event.stableId && event.changedAt && Date.parse(event.changedAt) > historyTimestampHighWater) ids.add(event.candidateId);
  }
  for (const event of snapshot.deletions) if (event.changedAt && Date.parse(event.changedAt) > deletionHighWater) ids.add(event.candidateId);
  return [...ids].sort((left, right) => Number(left) - Number(right));
}

function maxNumeric(values: Array<string | null | undefined>): string | null {
  const numbers = values.map((value) => Number(value)).filter((value) => Number.isSafeInteger(value) && value >= 0);
  return numbers.length ? String(Math.max(...numbers)) : null;
}

function maxTimestamp(values: Array<string | null | undefined>): string | null {
  const timestamps = values.filter((value): value is string => Boolean(value)).sort();
  return timestamps.at(-1) ?? null;
}

async function sourceInstanceId(pool: DatabasePool): Promise<string> {
  const result = await pool.query<{ id: string }>('SELECT id FROM source_instances WHERE source_system=$1 AND instance_key=$2 LIMIT 1', [pinpinSourceSystem, pinpinSourceInstance]);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('Pinpin source instance is unavailable.');
  return id;
}

async function readCursors(pool: DatabasePool, sourceId: string): Promise<CursorMap> {
  const result = await pool.query<{ cursor_key: string; cursor_value: string | null }>('SELECT cursor_key,cursor_value FROM sync_cursors WHERE source_instance_id=$1 AND cursor_type=$2', [sourceId, 'pinpin_incremental']);
  return Object.fromEntries(result.rows.map((row) => [row.cursor_key, row.cursor_value]));
}

async function writeCursor(pool: DatabasePool, sourceId: string, key: string, value: string | null): Promise<void> {
  await pool.query(`
    INSERT INTO sync_cursors (id,source_instance_id,cursor_type,cursor_key,cursor_value)
    VALUES ($1,$2,'pinpin_incremental',$3,$4)
    ON CONFLICT (source_instance_id,cursor_type,cursor_key)
    DO UPDATE SET cursor_value=EXCLUDED.cursor_value,updated_at=now()
  `, [uuidv7(), sourceId, key, value]);
}

async function main(): Promise<void> {
  for (const path of ['E:\\TalentNexus\\config\\tn-api.env', 'E:\\TalentNexus\\config\\pinpin-source.env']) loadProtectedEnvFile(path);
  const pool = createPool(loadConfig().databaseUrl);
  const lockClient = await pool.connect();
  try {
    if (!await tryAcquireManualPinpinSyncLock(lockClient)) {
      process.stdout.write('{"status":"skipped","reason":"lock-held"}\n');
      return;
    }
    const sourceId = await sourceInstanceId(pool);
    const cursors = await readCursors(pool, sourceId);
    const adapter = await PinpinSourceAdapter.connect();
    try {
      const signals = await adapter.readIncrementalSignals();
      const candidateIds = selectIncrementalCandidateIds(signals, cursors);
      const reconciler = new PinpinToTalentNexusReconciler(pool);
      let materiallyUpdated = 0;
      let unchanged = 0;
      let failed = 0;
      for (const candidateId of candidateIds) {
        try {
          const snapshot = await adapter.readCandidate(Number(candidateId));
          if (!snapshot) { failed += 1; continue; }
          const result = await reconciler.reconcileCandidate(snapshot);
          if (result.materiallyChanged) materiallyUpdated += 1; else unchanged += 1;
        } catch {
          failed += 1;
        }
      }
      if (failed === 0) {
        await writeCursor(pool, sourceId, 'candidate_id_highwater', String(signals.candidateIdHighWater));
        await writeCursor(pool, sourceId, 'attachment_id_highwater', maxNumeric(signals.attachments.map((event) => event.stableId)));
        await writeCursor(pool, sourceId, 'history_id_highwater', maxNumeric(signals.history.map((event) => event.stableId)));
        await writeCursor(pool, sourceId, 'history_timestamp_highwater', maxTimestamp(signals.history.map((event) => event.changedAt)));
        await writeCursor(pool, sourceId, 'deletion_timestamp_highwater', maxTimestamp(signals.deletions.map((event) => event.changedAt)));
      }
      process.stdout.write(`${JSON.stringify({ status: failed === 0 ? 'succeeded' : 'failed', observed: candidateIds.length, materiallyUpdated, unchanged, failed, candidateIdHighWater: signals.candidateIdHighWater, attachmentIdHighWater: maxNumeric(signals.attachments.map((event) => event.stableId)), historyIdHighWater: maxNumeric(signals.history.map((event) => event.stableId)), pinpinWrites: 0, blobReads: 0 })}\n`);
      if (failed) process.exitCode = 1;
    } finally {
      await adapter.close();
    }
  } finally {
    try { await releaseManualPinpinSyncLock(lockClient); } catch { /* session release still clears advisory lock */ }
    lockClient.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { process.stdout.write('{"status":"failed","reason":"incremental-sync-error","pinpinWrites":0,"blobReads":0}\n'); process.exitCode = 1; });
}
