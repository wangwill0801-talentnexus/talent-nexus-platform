import type { CandidateDataBrowser } from './candidate-data-browser-service.js';

export interface CandidateIntelligenceServiceContract {
  get(identifier: string): Promise<Record<string, unknown> | null>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export class CandidateIntelligenceService implements CandidateIntelligenceServiceContract {
  public constructor(private readonly browser: CandidateDataBrowser) {}

  public async get(identifier: string): Promise<Record<string, unknown> | null> {
    const source = await this.browser.inspect(identifier);
    if (!source) return null;
    const header = record(source.header);
    const identity = record(source.identity);
    const baseline = record(source.atsBaseline);
    const baselineCore = record(baseline.core);
    const ai = record(source.aiProfile);
    const evidence = record(source.evidence);
    const processing = record(source.processing);
    const evidenceRows = list(evidence.current).map((value) => {
      const row = record(value);
      return {
        sourceType: row.source_type ?? null,
        sourceSystem: row.source_system ?? null,
        sourceUrl: row.source_url ?? null,
        capturedAt: row.captured_at ?? null,
        representationKind: row.representation_kind ?? null,
        contentBacked: Boolean(row.content_sha256),
        processingEligible: Boolean(row.processing_eligible)
      };
    });

    return {
      candidateId: identity.candidateUuid ?? null,
      candidateCode: identity.legacyTnCode ?? null,
      atsCandidateId: identity.atsCandidateId ?? header.atsCandidateId ?? null,
      name: header.name ?? baselineCore.display_name ?? null,
      location: baselineCore.location_text ?? null,
      currentCompany: baselineCore.current_company ?? null,
      currentTitle: baselineCore.current_title ?? null,
      canonicalStatus: baselineCore.canonical_status ?? null,
      professionalSummary: ai.professional_summary ?? null,
      recruiterSummary: ai.recruiter_summary ?? null,
      jobPreferences: ai.job_preferences ?? null,
      experience: list(ai.work).length ? list(ai.work) : list(baseline.work),
      education: list(ai.education).length ? list(ai.education) : list(baseline.education),
      skills: list(ai.skill),
      languages: list(ai.language),
      certifications: list(ai.certification),
      projects: list(ai.project),
      targetRoles: list(ai.target_role),
      searchKeywords: list(ai.search_keyword),
      evidence: evidenceRows,
      processing: {
        current: processing.current ?? null,
        profileFreshness: ai.created_at ?? record(processing.current).updated_at ?? null
      },
      warnings: list(source.warnings),
      evidenceStatus: evidenceRows.some((item) => item.contentBacked)
        ? 'content_backed'
        : evidenceRows.length ? 'metadata_only' : 'unavailable'
    };
  }
}
