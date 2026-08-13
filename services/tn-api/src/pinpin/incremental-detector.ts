export type DiscoveryReason = 'candidate_id_highwater' | 'candidate_history' | 'attachment_highwater' | 'delete_tombstone' | 'bootstrap_full_replay';
export type SignalEvent = { candidateId: string; reason: DiscoveryReason; cursor: string };

export function detectCandidates(events: SignalEvent[]): Array<{ candidateId: string; reasons: DiscoveryReason[]; cursorEvidence: string[] }> {
  const candidates = new Map<string, { reasons: Set<DiscoveryReason>; cursorEvidence: Set<string> }>();
  for (const event of events) {
    if (!/^\d+$/.test(event.candidateId)) continue;
    const current = candidates.get(event.candidateId) ?? { reasons: new Set<DiscoveryReason>(), cursorEvidence: new Set<string>() };
    current.reasons.add(event.reason); current.cursorEvidence.add(event.cursor); candidates.set(event.candidateId, current);
  }
  return [...candidates.entries()].sort(([left], [right]) => Number(left) - Number(right)).map(([candidateId, value]) => ({ candidateId, reasons: [...value.reasons].sort(), cursorEvidence: [...value.cursorEvidence].sort() }));
}
