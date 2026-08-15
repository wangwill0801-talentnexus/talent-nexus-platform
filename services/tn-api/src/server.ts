import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createPool } from './db/pool.js';
import { PostgresCandidateRepository } from './repositories/postgres-candidate-repository.js';
import { PluginSidecarIntakeService } from './services/plugin-sidecar-intake-service.js';
import { TargetedPinpinSidecarService } from './services/targeted-pinpin-sidecar-service.js';
import { CandidateDataBrowserService } from './services/candidate-data-browser-service.js';
import { CandidateProcessingService } from './services/candidate-processing-service.js';
import { HistoricalEvidenceIntakeService } from './services/historical-evidence-intake-service.js';
import { TalentSearchService } from './services/talent-search-service.js';
import { CandidateIntelligenceService } from './services/candidate-intelligence-service.js';
import { PinpinEvidenceRequestService } from './services/pinpin-evidence-request-service.js';
import { PinpinSourceAdapter } from './pinpin/source-adapter.js';
import { PinpinBlobAttachmentReader } from './pinpin/blob-adapter.js';
import { PinpinBlobEvidenceService } from './services/pinpin-blob-evidence-service.js';
import { loadProtectedEnvFile } from './config/protected-env.js';

if (process.env.TN_ENV === 'production') {
  loadProtectedEnvFile('E:\\TalentNexus\\config\\pinpin-source.env');
  loadProtectedEnvFile('E:\\TalentNexus\\config\\pinpin-blob.env');
}

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const internalSidecar = new PluginSidecarIntakeService(pool);
const processing = new CandidateProcessingService(pool);
const dataBrowser = new CandidateDataBrowserService(pool);
const pinpinMetadataReader = {
  async readCandidate(externalCandidateId: number) {
    const adapter = await PinpinSourceAdapter.connect();
    try {
      return await adapter.readCandidate(externalCandidateId);
    } finally {
      await adapter.close();
    }
  }
};
const pinpinBlobEvidence = new PinpinBlobEvidenceService(
  pool,
  pinpinMetadataReader,
  () => PinpinBlobAttachmentReader.connect(),
  new HistoricalEvidenceIntakeService(pool)
);
const app = buildApp(config, new PostgresCandidateRepository(pool), internalSidecar, {
  publicSidecar: new TargetedPinpinSidecarService(pool, internalSidecar),
  dataBrowser,
  processing,
  evidenceIntake: new HistoricalEvidenceIntakeService(pool),
  evidenceRequest: new PinpinEvidenceRequestService(pool, pinpinMetadataReader),
  pinpinBlobEvidence,
  talentSearch: new TalentSearchService(pool),
  candidateIntelligence: new CandidateIntelligenceService(dataBrowser)
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'shutdown requested');
  await app.close();
  await pool.end();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info({ host: config.host, port: config.port }, 'tn-api listening');
} catch (error) {
  app.log.error({ errorName: error instanceof Error ? error.name : 'UnknownError' }, 'tn-api startup failed');
  await pool.end();
  process.exitCode = 1;
}
