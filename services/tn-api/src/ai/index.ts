import { loadAiConfig, type AiConfig } from './config.js';
import { GeminiProvider } from './gemini-provider.js';
import { AiProviderError, type AiHealthResult, type AiProvider, type EmbeddingResult, type StructuredGenerationRequest, type StructuredGenerationResult } from './types.js';

class UnconfiguredAiProvider implements AiProvider {
  public readonly providerName = 'none';
  isConfigured(): boolean { return false; }
  async generateStructured(_request: StructuredGenerationRequest): Promise<StructuredGenerationResult> { throw new AiProviderError('AI_NOT_CONFIGURED'); }
  async embedText(_text: string): Promise<EmbeddingResult> { throw new AiProviderError('AI_NOT_CONFIGURED'); }
  async healthCheck(): Promise<AiHealthResult> { return { provider: this.providerName, configured: false, connectivity: 'not-configured', generation: 'not-configured', embedding: 'not-configured' }; }
}

export function createAiProvider(config: AiConfig = loadAiConfig()): AiProvider {
  return config.provider === 'gemini' ? new GeminiProvider(config) : new UnconfiguredAiProvider();
}

export { loadAiConfig, aiConfigStatus } from './config.js';
export { GeminiProvider } from './gemini-provider.js';
export { AiProviderError, type AiProvider, type AiHealthResult, type EmbeddingResult, type StructuredGenerationRequest, type StructuredGenerationResult } from './types.js';
