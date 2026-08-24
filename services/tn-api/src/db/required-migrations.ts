export const requiredMigrationIds = [
  '001_phase3_foundation.sql',
  '002_phase6a2_enrichment.sql',
  '003_candidate_intake_foundation.sql',
  '004_candidate_evidence_processing.sql',
  '005_historical_evidence_bridge.sql',
] as const;

export function hasCompleteRequiredMigrationLedger(appliedRequiredCount: number): boolean {
  return appliedRequiredCount === requiredMigrationIds.length;
}
