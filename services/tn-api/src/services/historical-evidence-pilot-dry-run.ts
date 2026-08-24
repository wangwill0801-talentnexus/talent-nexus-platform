import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { HistoricalEvidencePilotService } from './historical-evidence-pilot-service.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
try {
  const report = await new HistoricalEvidencePilotService(pool).dryRun(20);
  console.log(JSON.stringify({
    observed: report.observed,
    eligible: report.eligible,
    selected: report.selected,
    selectedAtsCandidateIds: report.selectedAtsCandidateIds,
    reasons: report.reasons,
    duplicateGroups: report.duplicateGroups,
    secondRunNoOp: report.secondRunNoOp
  }));
} finally {
  await pool.end();
}
