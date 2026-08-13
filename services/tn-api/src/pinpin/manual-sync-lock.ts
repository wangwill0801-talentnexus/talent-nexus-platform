type AdvisoryClient = { query<T = { acquired: boolean }>(text: string, values?: unknown[]): Promise<{ rows: T[] }> };

// Stable, database-scoped lock key; this never reaches Pinpin.
export const manualPinpinSyncLockKey = '48100404001';

export async function tryAcquireManualPinpinSyncLock(client: AdvisoryClient): Promise<boolean> {
  const result = await client.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock($1::bigint) AS acquired', [manualPinpinSyncLockKey]);
  return result.rows[0]?.acquired === true;
}

export async function releaseManualPinpinSyncLock(client: AdvisoryClient): Promise<void> {
  await client.query('SELECT pg_advisory_unlock($1::bigint)', [manualPinpinSyncLockKey]);
}
