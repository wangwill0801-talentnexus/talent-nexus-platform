export type JsonSchema = Record<string, unknown>;

export type StructuredGenerationRequest = {
  prompt: string;
  schema?: JsonSchema;
};

export type StructuredGenerationResult = {
  text: string;
  json: unknown | null;
};

export type EmbeddingResult = { values: number[] };

export type AiHealthResult = {
  provider: string;
  configured: boolean;
  connectivity: 'pass' | 'not-configured' | 'fail';
  generation: 'pass' | 'not-configured' | 'fail';
  embedding: 'pass' | 'not-configured' | 'fail';
};

export interface AiProvider {
  readonly providerName: string;
  isConfigured(): boolean;
  generateStructured(request: StructuredGenerationRequest): Promise<StructuredGenerationResult>;
  embedText(text: string): Promise<EmbeddingResult>;
  healthCheck(): Promise<AiHealthResult>;
}

export class AiProviderError extends Error {
  public constructor(readonly code: 'AI_NOT_CONFIGURED' | 'AI_PROVIDER_ERROR' | 'AI_INVALID_RESPONSE') {
    super(code);
  }
}
