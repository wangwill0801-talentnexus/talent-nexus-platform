import { createHash } from 'node:crypto';

export const processingOperations = ['process_new_evidence', 'reprocess_profile', 'rebuild_projection'] as const;
export type ProcessingOperation = typeof processingOperations[number];
export type ProcessingJobStatus = 'queued' | 'processing' | 'retry_scheduled' | 'completed' | 'failed' | 'needs_review' | 'dead_letter';

export type EnqueueProcessingJob = {
  candidateId: string;
  evidenceId?: string | null;
  extractionId?: string | null;
  operation: ProcessingOperation;
  evidenceFingerprint?: string | null;
  extractorVersion?: string | null;
  parserVersion: string;
  schemaVersion: string;
  aiProvider?: string | null;
  aiModel?: string | null;
  requestedBy?: string;
  maxAttempts?: number;
};

export function processingIdempotencyKey(input: EnqueueProcessingJob): string {
  const stable = [input.operation, input.evidenceFingerprint ?? 'no-hash', input.extractorVersion ?? 'no-extractor', input.parserVersion, input.schemaVersion, input.aiProvider ?? 'no-provider', input.aiModel ?? 'no-model'].join('\n');
  return createHash('sha256').update(stable).digest('hex');
}
