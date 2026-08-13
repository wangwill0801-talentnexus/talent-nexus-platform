import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createPool } from './db/pool.js';
import { PostgresCandidateRepository } from './repositories/postgres-candidate-repository.js';
import { PluginSidecarIntakeService } from './services/plugin-sidecar-intake-service.js';
import { TargetedPinpinSidecarService } from './services/targeted-pinpin-sidecar-service.js';
import { CandidateDataBrowserService } from './services/candidate-data-browser-service.js';

if (process.env.TN_ENV === 'production') {
  try { process.loadEnvFile('E:\\TalentNexus\\config\\pinpin-source.env'); } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
}

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const internalSidecar = new PluginSidecarIntakeService(pool);
const app = buildApp(config, new PostgresCandidateRepository(pool), internalSidecar, {
  publicSidecar: new TargetedPinpinSidecarService(pool, internalSidecar),
  dataBrowser: new CandidateDataBrowserService(pool)
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
