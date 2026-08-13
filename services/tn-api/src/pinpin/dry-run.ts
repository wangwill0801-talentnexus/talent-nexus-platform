import { PinpinSourceAdapter, type PinpinCandidateSnapshot } from './source-adapter.js';

type DryRunSummary = {
  mode: 'read-only-dry-run';
  pages: number;
  candidatesSeen: number;
  inactiveCandidates: number;
  tombstonedCandidates: number;
  candidatesWithCompleteName: number;
  candidatesWithEmail: number;
  candidatesWithPhone: number;
  candidatesWithLocation: number;
  candidatesWithDesiredLocations: number;
  candidatesWithTopEducation: number;
  candidatesWithWork: number;
  candidatesWithEducation: number;
  candidatesWithDocuments: number;
  candidatesWithSource: number;
  workRecordsSeen: number;
  educationRecordsSeen: number;
  documentMetadataRecordsSeen: number;
  blobReads: 0;
  tnWrites: 0;
};

function include(summary: DryRunSummary, snapshots: PinpinCandidateSnapshot[]): void {
  for (const snapshot of snapshots) {
    summary.candidatesSeen += 1;
    if (!snapshot.sourceActive) summary.inactiveCandidates += 1;
    if (snapshot.deletedAt) summary.tombstonedCandidates += 1;
    if (snapshot.displayName) summary.candidatesWithCompleteName += 1;
    if (snapshot.primaryEmail) summary.candidatesWithEmail += 1;
    if (snapshot.primaryPhone) summary.candidatesWithPhone += 1;
    if (snapshot.locationText) summary.candidatesWithLocation += 1;
    if (snapshot.desiredLocationsRaw) summary.candidatesWithDesiredLocations += 1;
    if (snapshot.topEducationRaw) summary.candidatesWithTopEducation += 1;
    if (snapshot.sourceRaw) summary.candidatesWithSource += 1;
    if (snapshot.workExperiences.length > 0) summary.candidatesWithWork += 1;
    if (snapshot.educations.length > 0) summary.candidatesWithEducation += 1;
    if (snapshot.documents.length > 0) summary.candidatesWithDocuments += 1;
    summary.workRecordsSeen += snapshot.workExperiences.length;
    summary.educationRecordsSeen += snapshot.educations.length;
    summary.documentMetadataRecordsSeen += snapshot.documents.length;
  }
}

async function main(): Promise<void> {
  const adapter = await PinpinSourceAdapter.connect();
  const summary: DryRunSummary = {
    mode: 'read-only-dry-run', pages: 0, candidatesSeen: 0, inactiveCandidates: 0, tombstonedCandidates: 0, candidatesWithCompleteName: 0,
    candidatesWithEmail: 0, candidatesWithPhone: 0, candidatesWithLocation: 0, candidatesWithDesiredLocations: 0,
    candidatesWithTopEducation: 0, candidatesWithSource: 0, candidatesWithWork: 0, candidatesWithEducation: 0,
    candidatesWithDocuments: 0,
    workRecordsSeen: 0, educationRecordsSeen: 0, documentMetadataRecordsSeen: 0, blobReads: 0, tnWrites: 0,
  };
  let cursor = 0;
  try {
    for (;;) {
      const snapshots = await adapter.readPage(cursor, 100);
      if (snapshots.length === 0) break;
      summary.pages += 1;
      include(summary, snapshots);
      cursor = Number(snapshots.at(-1)?.externalCandidateId || cursor);
    }
  } finally {
    await adapter.close();
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`);
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
  process.stderr.write(`PINPIN_DRY_RUN_FAILED:${category}\n`);
  process.exitCode = 1;
});
