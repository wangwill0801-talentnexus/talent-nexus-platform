import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { AiProviderError, type AiProvider } from '../ai/types.js';
import type { DatabaseClient } from '../db/pool.js';
import { parseStandardResumeV1, type StandardResumeV1 } from '../domain/standard-resume.js';
import { persistSnapshotProjection, type ProcessingJob, type ProcessingJobExecutor, type ProcessingOutcome } from './candidate-processing-service.js';

const PROCESSOR_VERSION = 'tn-evidence-gemini-v1';

const text = { type: 'string' };
const list = { type: 'array', items: text };
const responseSchema = {
  type: 'object',
  properties: {
    name: text, englishName: text, phone: text, email: text, location: text, expectedLocation: text, linkedin: text,
    currentEmployment: { type: 'object', properties: { company: text, title: text } },
    experience: { type: 'array', items: { type: 'object', properties: { company: text, title: text, startDate: text, endDate: text, isCurrent: { type: 'boolean' }, department: text, location: text, description: text } } },
    education: { type: 'array', items: { type: 'object', properties: { school: text, degree: text, major: text, startDate: text, endDate: text } } },
    skills: list, languages: list, languageDetails: list, certifications: list, projectExperience: list,
    jobPreferences: text, summary: text, targetRoles: list, recruiterSummary: text, coreKeywords: list
  },
  required: ['experience', 'education', 'skills', 'languages', 'languageDetails', 'certifications', 'projectExperience', 'targetRoles', 'coreKeywords']
};

function hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}`;
}
function nullable(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()) : []; }
function normalizeResume(value: unknown): StandardResumeV1 {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const current = raw.currentEmployment && typeof raw.currentEmployment === 'object' ? raw.currentEmployment as Record<string, unknown> : {};
  const currentEmployment = nullable(current.company) || nullable(current.title) ? { company: nullable(current.company), title: nullable(current.title) } : null;
  return parseStandardResumeV1({
    schemaVersion: 'standard_resume_v1',
    name: nullable(raw.name), englishName: nullable(raw.englishName), phone: nullable(raw.phone), email: nullable(raw.email),
    location: nullable(raw.location), expectedLocation: nullable(raw.expectedLocation), linkedin: nullable(raw.linkedin), currentEmployment,
    experience: Array.isArray(raw.experience) ? raw.experience : [], education: Array.isArray(raw.education) ? raw.education : [],
    skills: strings(raw.skills), languages: strings(raw.languages), languageDetails: strings(raw.languageDetails), certifications: strings(raw.certifications),
    projectExperience: strings(raw.projectExperience), jobPreferences: nullable(raw.jobPreferences), summary: nullable(raw.summary),
    targetRoles: strings(raw.targetRoles), recruiterSummary: nullable(raw.recruiterSummary), coreKeywords: strings(raw.coreKeywords)
  });
}

function prompt(sourceKind: string, content: string): string {
  return [
    'You are a senior recruiter converting one resume/profile evidence document into Standard Resume JSON.',
    'Use only facts explicitly supported by the evidence. Do not infer missing contact details, dates, education, employers, titles, skills, languages, certifications, projects, salary, gender or nationality.',
    'Preserve the source language for factual resume fields. Write summary and recruiterSummary in the dominant evidence language; keep useful industry-standard English terminology.',
    'Keep distinct roles and promotions separate. Never calculate years of experience from an earliest year alone. Empty or unknown scalar values must be empty strings and unknown lists must be empty arrays.',
    'targetRoles and coreKeywords must be realistic, evidence-backed recruiter search terms. Do not include source URLs or tracking data unless the LinkedIn URL is explicitly present in evidence.',
    `Source kind: ${sourceKind}`,
    'EVIDENCE START', content, 'EVIDENCE END',
    'Return only JSON matching the supplied schema.'
  ].join('\n\n');
}

export class EvidenceAiProcessingExecutor implements ProcessingJobExecutor {
  constructor(private readonly provider: AiProvider, private readonly model: string | null) {}

  async execute(job: ProcessingJob, client: DatabaseClient): Promise<ProcessingOutcome> {
    if (job.operation === 'rebuild_projection') {
      const latest = await client.query<{ id: string }>('SELECT id FROM candidate_enrichment_snapshots WHERE candidate_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [job.candidateId]);
      if (!latest.rows[0]) return { status: 'needs_review', errorCode: 'SNAPSHOT_NOT_FOUND' };
      await persistSnapshotProjection(client, job.candidateId, latest.rows[0].id);
      return { status: 'completed', snapshotId: latest.rows[0].id };
    }
    if (!job.evidenceId || !job.extractionId || !job.evidenceFingerprint) return { status: 'needs_review', errorCode: 'EVIDENCE_NOT_ELIGIBLE' };
    const source = await client.query<Record<string, unknown>>(`SELECT e.source_type,e.source_system,e.source_reference,e.source_url,e.captured_at,e.connector_version,x.normalized_text,x.content_sha256,x.normalization_version FROM candidate_resume_evidence e JOIN candidate_evidence_extractions x ON x.evidence_id=e.id WHERE e.id=$1 AND x.id=$2 AND e.candidate_id=$3 AND e.processing_eligible=true`, [job.evidenceId, job.extractionId, job.candidateId]);
    const evidence = source.rows[0];
    if (!evidence || typeof evidence.normalized_text !== 'string' || evidence.content_sha256 !== job.evidenceFingerprint) return { status: 'needs_review', errorCode: 'EVIDENCE_NOT_ELIGIBLE' };
    const idempotencyKey = hash([PROCESSOR_VERSION, job.evidenceFingerprint, job.schemaVersion].join('\n'));
    const existing = await client.query<{ id: string }>('SELECT id FROM candidate_enrichment_snapshots WHERE candidate_id=$1 AND schema_version=$2 AND idempotency_key=$3', [job.candidateId, job.schemaVersion, idempotencyKey]);
    if (existing.rows[0]) {
      await client.query('UPDATE candidate_resume_evidence SET enrichment_snapshot_id=$2 WHERE id=$1 AND enrichment_snapshot_id IS NULL', [job.evidenceId, existing.rows[0].id]);
      await persistSnapshotProjection(client, job.candidateId, existing.rows[0].id);
      return { status: 'completed', snapshotId: existing.rows[0].id };
    }
    if (!this.provider.isConfigured()) return { status: 'needs_review', errorCode: 'AI_NOT_CONFIGURED' };
    let resume: StandardResumeV1;
    try {
      const generated = await this.provider.generateStructured({ prompt: prompt(String(evidence.source_type), evidence.normalized_text), schema: responseSchema });
      resume = normalizeResume(generated.json);
    } catch (error) {
      if (error instanceof AiProviderError && error.code === 'AI_PROVIDER_ERROR') return { status: 'retry', errorCode: error.code };
      return { status: 'needs_review', errorCode: error instanceof AiProviderError ? error.code : 'AI_INVALID_RESPONSE' };
    }
    const snapshotId = uuidv7();
    const payloadFingerprint = hash(stable(resume));
    const latest = await client.query<{ id: string }>('SELECT id FROM candidate_enrichment_snapshots WHERE candidate_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [job.candidateId]);
    await client.query(`INSERT INTO candidate_enrichment_snapshots (id,candidate_id,schema_version,source_kind,source_system,source_reference,source_url,source_captured_at,plugin_version,parser_version,ai_provider,ai_model,evidence_metadata,payload,payload_fingerprint,idempotency_key,supersedes_id,processed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16,$17,now()) ON CONFLICT (candidate_id,schema_version,idempotency_key) DO NOTHING`,
      [snapshotId, job.candidateId, job.schemaVersion, evidence.source_type, evidence.source_system, evidence.source_reference, evidence.source_url, evidence.captured_at, evidence.connector_version, PROCESSOR_VERSION, this.provider.providerName, this.model, JSON.stringify({ evidenceId: job.evidenceId, contentSha256: job.evidenceFingerprint, normalizationVersion: evidence.normalization_version }), JSON.stringify(resume), payloadFingerprint, idempotencyKey, latest.rows[0]?.id ?? null]);
    const selected = await client.query<{ id: string }>('SELECT id FROM candidate_enrichment_snapshots WHERE candidate_id=$1 AND schema_version=$2 AND idempotency_key=$3', [job.candidateId, job.schemaVersion, idempotencyKey]);
    if (!selected.rows[0]) return { status: 'failed', errorCode: 'SNAPSHOT_PERSIST_FAILED' };
    await client.query('UPDATE candidate_resume_evidence SET enrichment_snapshot_id=$2 WHERE id=$1 AND enrichment_snapshot_id IS NULL', [job.evidenceId, selected.rows[0].id]);
    await persistSnapshotProjection(client, job.candidateId, selected.rows[0].id);
    return { status: 'completed', snapshotId: selected.rows[0].id };
  }
}
