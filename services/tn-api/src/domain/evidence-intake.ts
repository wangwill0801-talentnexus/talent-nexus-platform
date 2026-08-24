import { createHash } from 'node:crypto';
import { z } from 'zod';
import { standardResumeV1Schema } from './standard-resume.js';

export const evidenceSourceKinds = ['104_resume', 'linkedin_public', 'linkedin_recruiter', 'pdf', 'docx', 'html', 'connector_capture'] as const;
export const evidenceRepresentationKinds = ['connector_text', 'connector_html', 'local_file_text'] as const;
export const EVIDENCE_NORMALIZATION_VERSION = 'tn-text-nfkc-v1';
export const EVIDENCE_HASH_ALGORITHM = 'sha256';

const bounded = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalBounded = (maximum: number) => bounded(maximum).nullable().optional();

export const candidateEvidenceIntakeV1Schema = z.object({
  contractVersion: z.literal('candidate_evidence_intake_v1'),
  candidateRef: z.object({
    sourceSystem: z.literal('pinpin'),
    sourceInstance: z.literal('pinpin-prod'),
    externalCandidateId: z.string().trim().regex(/^\d{1,18}$/)
  }).strict(),
  source: z.object({
    sourceKind: z.enum(evidenceSourceKinds),
    sourceSystem: optionalBounded(128),
    sourceReference: optionalBounded(512),
    sourceUrl: z.string().trim().url().max(2_048).nullable().optional(),
    sourceCapturedAt: z.string().datetime({ offset: true }),
    attachmentName: optionalBounded(512),
    attachmentType: optionalBounded(128),
    attachmentReference: optionalBounded(512)
  }).strict(),
  capture: z.object({
    method: z.enum(['connector_visible_page', 'connector_file_extract', 'approved_frozen_capture']),
    connectorVersion: optionalBounded(128),
    extractorVersion: bounded(128),
    normalizationVersion: z.literal(EVIDENCE_NORMALIZATION_VERSION).default(EVIDENCE_NORMALIZATION_VERSION)
  }).strict(),
  representation: z.object({
    kind: z.enum(evidenceRepresentationKinds),
    text: z.string().min(1).max(500_000),
    contentSha256: z.string().trim().regex(/^[0-9a-f]{64}$/i).nullable().optional()
  }).strict(),
  ai: z.object({ provider: optionalBounded(128), model: optionalBounded(256) }).default({}),
  correlationId: optionalBounded(128),
  resume: standardResumeV1Schema.nullable().optional()
}).strict().superRefine((value, context) => {
  const hasReference = Boolean(value.source.sourceReference || value.source.sourceUrl || value.source.attachmentReference);
  if (!hasReference) context.addIssue({ code: z.ZodIssueCode.custom, path: ['source'], message: 'A deterministic source reference is required.' });
});

export type CandidateEvidenceIntakeV1 = z.infer<typeof candidateEvidenceIntakeV1Schema>;

export function normalizeEvidenceText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function evidenceContentSha256(normalizedText: string): string {
  return createHash('sha256').update(normalizedText, 'utf8').digest('hex');
}

export function canonicalizeEvidenceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const url = new URL(value);
  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase().replace(/^m\./, 'www.');
  if (url.hostname === 'linkedin.com') url.hostname = 'www.linkedin.com';
  url.hash = '';
  url.search = '';
  if (url.hostname === 'www.linkedin.com') {
    const match = url.pathname.match(/^\/in\/([^/]+)\/?$/i);
    if (!match) return null;
    url.pathname = `/in/${match[1]}/`;
  } else if (url.hostname.endsWith('104.com.tw')) {
    url.hostname = 'www.104.com.tw';
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  } else {
    url.pathname = url.pathname.replace(/\/{2,}/g, '/');
  }
  return url.toString();
}

export function evidenceIdentityKey(input: { sourceKind: string; sourceReference: string | null; sourceUrl: string | null; attachmentReference: string | null; contentSha256: string }): string {
  const stable = [input.sourceKind, input.sourceReference ?? '', input.sourceUrl ?? '', input.attachmentReference ?? '', input.contentSha256].join('\n');
  return createHash('sha256').update(stable, 'utf8').digest('hex');
}
