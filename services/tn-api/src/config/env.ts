import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';

const environmentSchema = z.object({
  TN_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TN_HOST: z.string().ip().default('127.0.0.1'),
  TN_PORT: z.coerce.number().int().min(1).max(65_535).default(3333),
  DATABASE_URL: z.string().url(),
  TN_API_TOKEN: z.string().min(16)
});

export type AppConfig = {
  environment: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  apiToken: string;
  entra?: EntraRuntimeConfig;
};

export type EntraRuntimeConfig = {
  tenantId: string;
  apiClientId: string;
  requiredScope: string;
  issuer: string;
};

const entraKeys = new Set(['ENTRA_TENANT_ID', 'ENTRA_API_CLIENT_ID', 'ENTRA_REQUIRED_SCOPE', 'ENTRA_ISSUER']);

function readProtectedEntraEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (environment.TN_ENV !== 'production') return environment;
  const path = environment.TN_ENTRA_CONFIG_PATH ?? 'E:\\TalentNexus\\config\\tn-entra.env';
  if (!existsSync(path)) return environment;
  const merged = { ...environment };
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || !entraKeys.has(match[1]!)) continue;
    if (!merged[match[1]!]) merged[match[1]!] = match[2]!;
  }
  return merged;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const effectiveEnvironment = readProtectedEntraEnvironment(environment);
  const parsed = environmentSchema.safeParse(effectiveEnvironment);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid TN configuration: ${fields}`);
  }

  const entraValues = [
    effectiveEnvironment.ENTRA_TENANT_ID,
    effectiveEnvironment.ENTRA_API_CLIENT_ID,
    effectiveEnvironment.ENTRA_REQUIRED_SCOPE,
    effectiveEnvironment.ENTRA_ISSUER
  ];
  const hasEntraValues = entraValues.some(Boolean);
  const missingRequiredEntraValues = !effectiveEnvironment.ENTRA_TENANT_ID || !effectiveEnvironment.ENTRA_API_CLIENT_ID || !effectiveEnvironment.ENTRA_REQUIRED_SCOPE;
  if (hasEntraValues && missingRequiredEntraValues) {
    throw new Error('Invalid TN configuration: ENTRA_TENANT_ID, ENTRA_API_CLIENT_ID, ENTRA_REQUIRED_SCOPE');
  }

  const entra = hasEntraValues ? {
    tenantId: effectiveEnvironment.ENTRA_TENANT_ID!,
    apiClientId: effectiveEnvironment.ENTRA_API_CLIENT_ID!,
    requiredScope: effectiveEnvironment.ENTRA_REQUIRED_SCOPE!,
    issuer: effectiveEnvironment.ENTRA_ISSUER ?? `https://login.microsoftonline.com/${effectiveEnvironment.ENTRA_TENANT_ID}/v2.0`
  } satisfies EntraRuntimeConfig : undefined;

  return {
    environment: parsed.data.TN_ENV,
    host: parsed.data.TN_HOST,
    port: parsed.data.TN_PORT,
    databaseUrl: parsed.data.DATABASE_URL,
    apiToken: parsed.data.TN_API_TOKEN,
    entra
  };
}
