import { createAiProvider } from './index.js';

const aiConfigPath = 'E:\\TalentNexus\\config\\tn-ai.env';

try { process.loadEnvFile(aiConfigPath); } catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
}

const provider = createAiProvider();
const result = await provider.healthCheck();
if (!result.configured) {
  process.stdout.write('AI NOT CONFIGURED\n');
  process.exitCode = 2;
} else {
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.connectivity === 'pass' ? 0 : 1;
}
