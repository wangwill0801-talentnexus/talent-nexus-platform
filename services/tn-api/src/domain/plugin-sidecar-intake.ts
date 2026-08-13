import { z } from 'zod';
import { standardResumeV1Schema } from './standard-resume.js';

const bounded = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalBounded = (maximum: number) => bounded(maximum).nullable().optional();

export const pluginSidecarIntakeV1Schema = z.object({
  contractVersion: z.literal('plugin_sidecar_intake_v1'),
  candidateRef: z.object({
    sourceSystem: z.literal('pinpin'),
    sourceInstance: z.literal('pinpin-prod'),
    externalCandidateId: bounded(128)
  }),
  source: z.object({
    sourceKind: bounded(64),
    sourceSystem: optionalBounded(128),
    sourceReference: optionalBounded(512),
    sourceUrl: z.string().trim().url().max(2_048).nullable().optional(),
    sourceCapturedAt: z.string().datetime({ offset: true }).nullable().optional(),
    sourceCreatedAt: z.string().datetime({ offset: true }).nullable().optional(),
    sourceUpdatedAt: z.string().datetime({ offset: true }).nullable().optional(),
    attachmentName: optionalBounded(512),
    attachmentType: optionalBounded(128),
    attachmentReference: optionalBounded(512),
    contentSha256: z.string().trim().regex(/^[0-9a-f]{64}$/i).nullable().optional()
  }),
  plugin: z.object({ version: optionalBounded(128), parserVersion: optionalBounded(128) }).default({}),
  ai: z.object({ provider: optionalBounded(128), model: optionalBounded(256) }).default({}),
  ats: z.object({ savedAt: z.string().datetime({ offset: true }).nullable().optional() }).default({}),
  correlationId: optionalBounded(128),
  resume: standardResumeV1Schema
}).strict();

export type PluginSidecarIntakeV1 = z.infer<typeof pluginSidecarIntakeV1Schema>;
