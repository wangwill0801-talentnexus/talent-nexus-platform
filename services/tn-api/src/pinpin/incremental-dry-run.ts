import { PinpinSourceAdapter } from './source-adapter.js';
import { detectCandidates, type SignalEvent } from './incremental-detector.js';

async function main(): Promise<void> {
  const adapter = await PinpinSourceAdapter.connect();
  try {
    const snapshot = await adapter.readIncrementalSignals();
    const events: SignalEvent[] = snapshot.candidateIds.map((candidateId) => ({ candidateId, reason: 'candidate_id_highwater', cursor: 'candidate_id>0 bootstrap-replay' }));
    events.push(...snapshot.history.map((event) => ({ candidateId: event.candidateId, reason: 'candidate_history' as const, cursor: event.stableId ? `history:${event.stableId}` : 'history:timestamp-only' })));
    events.push(...snapshot.attachments.map((event) => ({ candidateId: event.candidateId, reason: 'attachment_highwater' as const, cursor: `attachment:${event.stableId}` })));
    events.push(...snapshot.deletions.map((event) => ({ candidateId: event.candidateId, reason: 'delete_tombstone' as const, cursor: event.changedAt ?? 'delete:undated' })));
    const candidates = detectCandidates(events);
    process.stdout.write(`${JSON.stringify({ mode: 'bootstrap-replay-dry-run', candidateIdHighWater: snapshot.candidateIdHighWater, workIdHighWater: snapshot.workIdHighWater, educationIdHighWater: snapshot.educationIdHighWater, historyRows: snapshot.history.length, attachmentRows: snapshot.attachments.length, deletionRows: snapshot.deletions.length, schema: snapshot.schema, candidates })}\n`);
  } finally { await adapter.close(); }
}

main().catch(() => { process.stderr.write('{"phase":"4E.1","status":"dry-run-failed"}\n'); process.exitCode = 1; });
