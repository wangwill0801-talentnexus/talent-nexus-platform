import { PinpinSourceAdapter } from './source-adapter.js';

const syntheticExternalId = 43177;

async function main(): Promise<void> {
  const adapter = await PinpinSourceAdapter.connect();
  try {
    const snapshots = await adapter.readPage(syntheticExternalId - 1, 1);
    const snapshot = snapshots[0];
    const found = snapshot?.externalCandidateId === String(syntheticExternalId);
    process.stdout.write(`${JSON.stringify({
      expectedExternalIdFound: found,
      sourceActive: found ? snapshot.sourceActive : null,
      tombstoneObserved: found ? Boolean(snapshot.deletedAt) : null,
      workRecordCount: found ? snapshot.workExperiences.length : 0,
      educationRecordCount: found ? snapshot.educations.length : 0,
      documentMetadataCount: found ? snapshot.documents.length : 0,
      blobReads: 0,
      tnWrites: 0,
    })}\n`);
    if (!found) process.exitCode = 1;
  } finally {
    await adapter.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  const category = message.includes('login') || message.includes('authentication')
    ? 'authentication'
    : message.includes('driver') || message.includes('odbc')
      ? 'native-driver'
      : message.includes('permission') || message.includes('denied')
        ? 'permission'
        : 'source-query';
  process.stderr.write(`PINPIN_SYNTHETIC_VERIFY_FAILED:${category}\n`);
  process.exitCode = 1;
});
