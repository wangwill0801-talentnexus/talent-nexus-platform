import type { DatabasePool } from '../db/pool.js';
import type {
  TalentSearchCriteria,
  TalentSearchMatch,
  TalentSearchRequest,
  TalentSearchResponse,
  TalentSearchServiceContract
} from '../domain/talent-search.js';
import { isRoleTerm, matchesEvidence, matchesSearchTerm, normalizeSearchText } from '../domain/search-normalization.js';

type SearchRow = {
  candidate_id: string;
  candidate_code: string;
  display_name: string | null;
  location_text: string | null;
  current_company: string | null;
  current_title: string | null;
  ats_candidate_id: string | null;
  snapshot_id: string;
  profile_updated_at: Date | string | null;
  profile_status: string | null;
  professional_summary: string | null;
  recruiter_summary: string | null;
  work: unknown;
  education: unknown;
  terms: unknown;
  evidence: unknown;
};

type WorkItem = { companyName?: string | null; jobTitle?: string | null; department?: string | null; location?: string | null; description?: string | null; provenance?: string | null };
type EducationItem = { schoolName?: string | null; degree?: string | null; major?: string | null; provenance?: string | null };
type TermItem = { type?: string; value?: string; provenance?: string | null };
type EvidenceItem = { sourceType?: string | null; sourceSystem?: string | null; contentSha256?: string | null; representationKind?: string | null };

const SEARCH_POOL_LIMIT = 1_000;

function array<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed as T[] : []; } catch { return []; }
  }
  return [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalize(value: string): string {
  return normalizeSearchText(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(text).filter(Boolean))];
}

function hasTerm(haystack: string, term: string): boolean {
  return matchesSearchTerm(haystack, term);
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function sourceLabel(value: string): string {
  return value.replace(/_/g, ' ').trim();
}

function rank(row: SearchRow, criteria: TalentSearchCriteria): TalentSearchMatch | null {
  const work = array<WorkItem>(row.work);
  const education = array<EducationItem>(row.education);
  const terms = array<TermItem>(row.terms);
  const evidence = array<EvidenceItem>(row.evidence);
  const termValues = terms.map((item) => text(item.value));
  const titleValues = unique([row.current_title ?? '', ...work.map((item) => text(item.jobTitle)), ...terms.filter((item) => item.type === 'target_role').map((item) => text(item.value))]);
  const companyValues = unique([row.current_company ?? '', ...work.map((item) => text(item.companyName))]);
  const skillValues = unique(terms.filter((item) => ['skill', 'certification', 'project', 'search_keyword'].includes(item.type ?? '')).map((item) => text(item.value)));
  const technicalEvidenceValues = unique([
    ...skillValues,
    ...work.flatMap((item) => [text(item.jobTitle), text(item.department), text(item.description)])
  ]);
  const languageValues = unique(terms.filter((item) => item.type === 'language').map((item) => text(item.value)));
  const educationValues = unique(education.flatMap((item) => [text(item.schoolName), text(item.degree), text(item.major)]));
  const functionValues = unique(work.flatMap((item) => [text(item.department), text(item.jobTitle)]));
  const industryValues = unique(work.flatMap((item) => [text(item.companyName), text(item.description)]));
  const locationValues = unique([row.location_text ?? '', ...work.map((item) => text(item.location))]);
  const searchable = normalize(unique([
    row.display_name ?? '', row.current_company ?? '', row.current_title ?? '', row.location_text ?? '',
    row.professional_summary ?? '', row.recruiter_summary ?? '', ...termValues,
    ...work.flatMap((item) => [text(item.companyName), text(item.jobTitle), text(item.department), text(item.location), text(item.description)]),
    ...educationValues
  ]).join(' | '));

  // Recall and precision are separate stages. The SQL read model intentionally
  // retrieves a broad pool; this gate prevents a secondary preference such as
  // location from turning a candidate with no credible core function evidence
  // into a meaningful result. Core requests come from the parsed role/function
  // fields and role-like free-text terms, while the evidence surface includes
  // historical titles and descriptions for transferable experience.
  const freeTextRoleTerms = criteria.freeText
    .split(/[\s,;|/()]+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 2 && isRoleTerm(value));
  const coreRoleRequests = unique([
    ...criteria.targetRoles,
    ...criteria.titles,
    ...criteria.functions,
    ...criteria.mustHave,
    ...criteria.keywords,
    ...freeTextRoleTerms
  ]).filter((value) => isRoleTerm(value));
  const coreEvidence = normalize(unique([
    ...titleValues,
    ...functionValues,
    ...skillValues,
    ...termValues,
    row.professional_summary ?? '',
    row.recruiter_summary ?? '',
    ...work.flatMap((item) => [text(item.jobTitle), text(item.department), text(item.description)])
  ]).join(' | '));
  const coreRoleMatched = coreRoleRequests.length === 0
    || coreRoleRequests.some((requestedValue) => matchesSearchTerm(coreEvidence, requestedValue));

  const matched: string[] = [];
  const gaps: string[] = [];
  const explanationFacts: string[] = [];
  let points = 0;
  let possible = 0;

  const scoreGroup = (label: string, requested: string[], fieldValues: string[], weight: number, missingAsGap = false) => {
    for (const requestedValue of unique(requested)) {
      possible += weight;
      const fieldText = normalize(fieldValues.join(' | '));
      const evidenceText = fieldText || searchable;
      // Use the same evidence-aware matcher for every group so aliases and
      // compound requirements behave consistently across role, skill, company,
      // and preference fields. This still never invents candidate facts.
      const matchedTerm = matchesEvidence(evidenceText, requestedValue);
      if (matchedTerm) {
        points += weight;
        matched.push(`${label}: ${requestedValue}`);
        explanationFacts.push(`${requestedValue} (${label})`);
      } else if (missingAsGap) {
        points -= Math.round(weight * 0.8);
        gaps.push(requestedValue);
      }
    }
  };

  scoreGroup('Must Have', criteria.mustHave, [searchable], 18, true);
  scoreGroup('技能', criteria.skills, technicalEvidenceValues, 11);
  scoreGroup('職位', [...criteria.targetRoles, ...criteria.titles], titleValues, 24);
  scoreGroup('職能', criteria.functions, functionValues, 8);
  scoreGroup('產業', criteria.industries, industryValues, 6);
  scoreGroup('公司', criteria.companies, companyValues, 6);
  scoreGroup('地點', criteria.locations, locationValues, 3);
  scoreGroup('語言', criteria.languages, languageValues, 3);
  scoreGroup('學歷', criteria.education, educationValues, 3);
  scoreGroup('Nice to Have', criteria.niceToHave, [searchable], 4, true);
  scoreGroup('關鍵字', criteria.keywords, [searchable], 3);

  const fallbackTerms = possible === 0
    ? unique(criteria.freeText.split(/[\s,，、;；|]+/).filter((value) => value.length >= 2)).slice(0, 12)
    : [];
  scoreGroup('關鍵字', fallbackTerms, [searchable], 3);

  if (criteria.excluded.some((item) => hasTerm(searchable, item))) return null;
  if (!coreRoleMatched) return null;
  if (possible === 0 || points <= 0) return null;

  const evidenceStatus: TalentSearchMatch['evidenceStatus'] = evidence.some((item) => Boolean(item.contentSha256))
    ? 'content_backed'
    : evidence.length ? 'metadata_only' : 'unavailable';
  const evidenceWarnings: string[] = [];
  if (evidenceStatus !== 'content_backed') evidenceWarnings.push(evidenceStatus === 'metadata_only' ? 'SOURCE_NOT_HASHED' : 'EVIDENCE_UNAVAILABLE');
  const needsConfirmation = unique([
    ...gaps.map((item) => `需確認：${item}`),
    ...(criteria.locations.length && !row.location_text ? ['地點資料未提供'] : []),
    ...(evidenceStatus !== 'content_backed' ? ['內容證據尚未完整驗證'] : [])
  ]);
  const rawScore = Math.max(0, Math.min(100, Math.round((Math.max(0, points) / possible) * 100)));
  const relevantTags = unique([...matched.map((item) => item.split(': ').slice(1).join(': ')), ...skillValues]).slice(0, 8);

  return {
    candidateId: row.candidate_id,
    candidateCode: row.candidate_code,
    atsCandidateId: row.ats_candidate_id,
    name: row.display_name || 'Candidate',
    currentCompany: row.current_company || work[0]?.companyName || null,
    currentTitle: row.current_title || work[0]?.jobTitle || null,
    location: row.location_text,
    matchScore: rawScore,
    matched: unique(matched).slice(0, 12),
    gaps: unique(gaps).slice(0, 8),
    needsConfirmation: needsConfirmation.slice(0, 8),
    relevantTags,
    explanationFacts: unique(explanationFacts).slice(0, 10),
    profileStatus: row.profile_status || 'completed',
    profileUpdatedAt: iso(row.profile_updated_at),
    evidenceStatus,
    evidenceWarnings
  };
}

export class TalentSearchService implements TalentSearchServiceContract {
  public constructor(private readonly database: DatabasePool) {}

  public async coverage(): Promise<{ aiReady: number }> {
    const result = await this.database.query<{ ai_ready: string }>(`
      SELECT count(DISTINCT profile.candidate_id)::text AS ai_ready
      FROM candidate_ai_profiles profile
      JOIN candidate_enrichment_snapshots snapshot ON snapshot.id=profile.enrichment_snapshot_id
    `);
    return { aiReady: Number(result.rows[0]?.ai_ready ?? '0') };
  }

  public async search(request: TalentSearchRequest): Promise<TalentSearchResponse> {
    const result = await this.database.query<SearchRow>(`
      WITH latest AS (
        SELECT DISTINCT ON (profile.candidate_id)
          profile.candidate_id, profile.enrichment_snapshot_id AS snapshot_id,
          profile.professional_summary, profile.recruiter_summary,
          profile.created_at AS profile_updated_at
        FROM candidate_ai_profiles profile
        JOIN candidate_enrichment_snapshots snapshot ON snapshot.id=profile.enrichment_snapshot_id
        ORDER BY profile.candidate_id, snapshot.created_at DESC, snapshot.id DESC
      )
      SELECT c.id AS candidate_id,c.candidate_code,c.display_name,c.location_text,c.current_company,c.current_title,
        ref.external_candidate_id AS ats_candidate_id,latest.snapshot_id,latest.profile_updated_at,
        processing.status AS profile_status,latest.professional_summary,latest.recruiter_summary,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'companyName',w.company_name,'jobTitle',w.job_title,'department',w.department,'location',w.location_text,
          'description',w.description,'provenance',w.provenance) ORDER BY w.display_order)
          FROM candidate_ai_work_experiences w WHERE w.enrichment_snapshot_id=latest.snapshot_id),'[]'::jsonb) AS work,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'schoolName',e.school_name,'degree',e.degree_raw,'major',e.major_raw,'provenance',e.provenance) ORDER BY e.display_order)
          FROM candidate_ai_educations e WHERE e.enrichment_snapshot_id=latest.snapshot_id),'[]'::jsonb) AS education,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('type',t.term_type,'value',t.value,'provenance',t.provenance) ORDER BY t.term_type,t.display_order)
          FROM candidate_ai_terms t WHERE t.enrichment_snapshot_id=latest.snapshot_id),'[]'::jsonb) AS terms,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceType',ev.source_type,'sourceSystem',ev.source_system,
          'contentSha256',ev.content_sha256,'representationKind',ev.representation_kind) ORDER BY ev.created_at DESC)
          FROM candidate_resume_evidence ev WHERE ev.candidate_id=c.id),'[]'::jsonb) AS evidence
      FROM latest
      JOIN candidates c ON c.id=latest.candidate_id
      LEFT JOIN candidate_processing_state processing ON processing.candidate_id=c.id
      LEFT JOIN LATERAL (
        SELECT r.external_candidate_id FROM candidate_external_refs r
        JOIN source_instances s ON s.id=r.source_instance_id
        WHERE r.candidate_id=c.id AND s.source_system='pinpin' AND s.instance_key='pinpin-prod'
        ORDER BY r.last_seen_at DESC LIMIT 1
      ) ref ON true
      WHERE c.canonical_status='active'
      ORDER BY latest.profile_updated_at DESC,c.id DESC
      LIMIT $1
    `, [SEARCH_POOL_LIMIT]);

    const ranked = result.rows
      .map((row) => rank(row, request.criteria))
      .filter((item): item is TalentSearchMatch => Boolean(item))
      .sort((a, b) => b.matchScore - a.matchScore || (b.profileUpdatedAt ?? '').localeCompare(a.profileUpdatedAt ?? ''))
      .slice(0, request.limit);
    return { coverage: await this.coverage(), results: ranked, scoreDefinition: 'recruiting_match_score' };
  }
}

export { rank as rankCandidateForSearch };
