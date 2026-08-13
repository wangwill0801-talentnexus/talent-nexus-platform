import { z } from 'zod';

const aiEnvironmentSchema = z.object({
  AI_PROVIDER: z.enum(['gemini']).optional(),
  GEMINI_API_KEY: z.string().trim().min(1).optional(),
  GEMINI_QUERY_MODEL: z.string().trim().min(1).optional(),
  GEMINI_REASONING_MODEL: z.string().trim().min(1).optional(),
  GEMINI_EMBEDDING_MODEL: z.string().trim().min(1).optional(),
});

export type AiConfig = {
  provider: 'gemini' | null;
  geminiApiKey: string | null;
  queryModel: string | null;
  reasoningModel: string | null;
  embeddingModel: string | null;
};

export function loadAiConfig(environment: NodeJS.ProcessEnv = process.env): AiConfig {
  const parsed = aiEnvironmentSchema.safeParse(environment);
  if (!parsed.success) return { provider: null, geminiApiKey: null, queryModel: null, reasoningModel: null, embeddingModel: null };
  return {
    provider: parsed.data.AI_PROVIDER ?? null,
    geminiApiKey: parsed.data.GEMINI_API_KEY ?? null,
    queryModel: parsed.data.GEMINI_QUERY_MODEL ?? null,
    reasoningModel: parsed.data.GEMINI_REASONING_MODEL ?? null,
    embeddingModel: parsed.data.GEMINI_EMBEDDING_MODEL ?? null,
  };
}

export function aiConfigStatus(config: AiConfig): { provider: string | null; configured: boolean; queryModelConfigured: boolean; reasoningModelConfigured: boolean; embeddingModelConfigured: boolean } {
  return {
    provider: config.provider,
    configured: config.provider === 'gemini' && config.geminiApiKey !== null,
    queryModelConfigured: config.queryModel !== null,
    reasoningModelConfigured: config.reasoningModel !== null,
    embeddingModelConfigured: config.embeddingModel !== null,
  };
}
