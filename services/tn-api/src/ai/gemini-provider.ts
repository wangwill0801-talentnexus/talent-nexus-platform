import { GoogleGenAI } from '@google/genai';
import type { AiConfig } from './config.js';
import { AiProviderError, type AiHealthResult, type AiProvider, type EmbeddingResult, type StructuredGenerationRequest, type StructuredGenerationResult } from './types.js';

type GeminiModels = {
  generateContent(request: { model: string; contents: string; config?: Record<string, unknown> }): Promise<{ text?: string }>;
  embedContent(request: { model: string; contents: string }): Promise<{ embeddings?: Array<{ values?: number[] }> }>;
};
type GeminiClient = { models: GeminiModels };
type GeminiClientFactory = (apiKey: string) => GeminiClient;

function normalizeProviderFailure(): AiProviderError {
  return new AiProviderError('AI_PROVIDER_ERROR');
}

export class GeminiProvider implements AiProvider {
  public readonly providerName = 'gemini';
  private readonly client: GeminiClient | null;

  public constructor(private readonly config: AiConfig, clientFactory: GeminiClientFactory = (apiKey) => new GoogleGenAI({ apiKey })) {
    this.client = this.isConfigured() ? clientFactory(config.geminiApiKey as string) : null;
  }

  isConfigured(): boolean {
    return this.config.provider === 'gemini' && this.config.geminiApiKey !== null;
  }

  async generateStructured(request: StructuredGenerationRequest): Promise<StructuredGenerationResult> {
    if (!this.client || !this.config.queryModel) throw new AiProviderError('AI_NOT_CONFIGURED');
    try {
      const response = await this.client.models.generateContent({
        model: this.config.queryModel,
        contents: request.prompt,
        config: request.schema ? { responseMimeType: 'application/json', responseJsonSchema: request.schema } : undefined,
      });
      const text = response.text?.trim();
      if (!text) throw new AiProviderError('AI_INVALID_RESPONSE');
      if (!request.schema) return { text, json: null };
      try { return { text, json: JSON.parse(text) }; } catch { throw new AiProviderError('AI_INVALID_RESPONSE'); }
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      throw normalizeProviderFailure();
    }
  }

  async embedText(text: string): Promise<EmbeddingResult> {
    if (!this.client || !this.config.embeddingModel) throw new AiProviderError('AI_NOT_CONFIGURED');
    try {
      const response = await this.client.models.embedContent({ model: this.config.embeddingModel, contents: text });
      const values = response.embeddings?.[0]?.values;
      if (!values || !values.every(Number.isFinite)) throw new AiProviderError('AI_INVALID_RESPONSE');
      return { values };
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      throw normalizeProviderFailure();
    }
  }

  async healthCheck(): Promise<AiHealthResult> {
    if (!this.isConfigured() || !this.config.queryModel || !this.config.embeddingModel) {
      return { provider: this.providerName, configured: false, connectivity: 'not-configured', generation: 'not-configured', embedding: 'not-configured' };
    }
    try {
      await this.generateStructured({ prompt: 'Return exactly the JSON object {"ok":true}.', schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } });
      await this.embedText('Talent Nexus AI connectivity check.');
      return { provider: this.providerName, configured: true, connectivity: 'pass', generation: 'pass', embedding: 'pass' };
    } catch {
      return { provider: this.providerName, configured: true, connectivity: 'fail', generation: 'fail', embedding: 'fail' };
    }
  }
}
