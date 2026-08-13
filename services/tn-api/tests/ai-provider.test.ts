import assert from 'node:assert/strict';
import test from 'node:test';
import { aiConfigStatus, createAiProvider, GeminiProvider, loadAiConfig } from '../src/ai/index.js';
import { AiProviderError } from '../src/ai/types.js';

const configured = { provider: 'gemini' as const, geminiApiKey: 'server-only-test-key', queryModel: 'query-model', reasoningModel: 'reasoning-model', embeddingModel: 'embedding-model' };

test('AI configuration is optional and exposes no key in status', async () => {
  const config = loadAiConfig({});
  const provider = createAiProvider(config);
  assert.equal(provider.isConfigured(), false);
  assert.deepEqual(await provider.healthCheck(), { provider: 'none', configured: false, connectivity: 'not-configured', generation: 'not-configured', embedding: 'not-configured' });
  const status = aiConfigStatus(configured);
  assert.equal(JSON.stringify(status).includes('server-only-test-key'), false);
});

test('Gemini provider supports structured generation and embeddings through the provider boundary', async () => {
  const provider = new GeminiProvider(configured, () => ({ models: {
    generateContent: async () => ({ text: '{"ok":true}' }),
    embedContent: async () => ({ embeddings: [{ values: [0.1, 0.2] }] }),
  } }));
  assert.equal(provider.isConfigured(), true);
  assert.deepEqual(await provider.generateStructured({ prompt: 'synthetic', schema: { type: 'object' } }), { text: '{"ok":true}', json: { ok: true } });
  assert.deepEqual(await provider.embedText('synthetic'), { values: [0.1, 0.2] });
});

test('Gemini provider normalizes provider failures without exposing a key', async () => {
  const provider = new GeminiProvider(configured, () => ({ models: {
    generateContent: async () => { throw new Error('server-only-test-key provider failure'); },
    embedContent: async () => ({ embeddings: [{ values: [0.1] }] }),
  } }));
  await assert.rejects(provider.generateStructured({ prompt: 'synthetic' }), (error: unknown) => error instanceof AiProviderError && error.code === 'AI_PROVIDER_ERROR' && !error.message.includes('server-only-test-key'));
});
