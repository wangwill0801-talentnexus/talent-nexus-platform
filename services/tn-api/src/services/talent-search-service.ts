import type { DatabasePool } from '../db/pool.js';
import type { AiProvider } from '../ai/types.js';
import type {
  TalentSearchCriteria,
  TalentSearchMatch,
  TalentSearchRequest,
  TalentSearchResponse,
  TalentSearchServiceContract
} from '../domain/talent-search.js';
import { isRoleTerm, matchesEvidence, matchesSearchTerm, normalizeSearchText } from '../domain/search-normalization.js';
import { talentSearchIntentSchema } from '../validation/talent-search.js';

type SearchRow = {
  candidate_id: string;
  candidate_code: string;
  display_name: string | null;
  location_text: string | null;
  current_company: string | null;
  current_title: string | null;
  ats_candidate_id: string | null;
  snapshot_id: string | null;
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

function queryTokens(query: string): string[] {
  const stopWords = new Set(['and', 'or', 'with', 'the', 'a', 'an', 'for', '有', '找', '尋找', '想找', '的人', '人選', '經驗', '與客戶', '工作內容', '職缺內容', '客戶公司']);
  return unique(query
    .split(/[\s,，、;；|/()（）•●]+/)
    .map((value) => value.trim().replace(/^\d+[.)、．:\：-]?$/, '').replace(/^\d+[.)、．:\：-]\s*/, ''))
    .filter((value) => value.length >= 2 && !/^\d+[.)、．:\：-]?$/.test(value) && !stopWords.has(value.toLocaleLowerCase('en-US'))))
    .slice(0, 24);
}

const CRITERIA_LIST_FIELDS = [
  'targetRoles', 'titles', 'skills', 'functions', 'industries', 'companies',
  'locations', 'languages', 'education', 'mustHave', 'niceToHave', 'keywords', 'excluded'
] as const;

function cleanCriteriaTerm(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const term = value.trim()
    .replace(/^(?:[-•*]\s*|\d+[.)、．:\：-]\s*)/, '')
    .replace(/[<>]/g, '')
    .replace(/[。．.、,，;；:：]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!term || /^\d+[.)、．:\：-]?$/.test(term)) return null;
  if (/^(?:null|undefined|n\/a|na|待確認|未提供|工作內容|職缺內容|職務類別|產業類別|公司規模|管理責任|年資|經驗|以上|人以上|導入|獎金|年終獎金|福利|勞保|健保|三節|退休金|待遇面議)$/i.test(term)) return null;
  if (/(?:直接管理人數|公司規模|管理責任|職務類別|產業類別)/i.test(term)) return null;
  return term;
}

function sanitizeCriteria(criteria: TalentSearchCriteria): TalentSearchCriteria {
  const next = { ...criteria };
  for (const field of CRITERIA_LIST_FIELDS) {
    const values = Array.isArray(next[field]) ? next[field] : [];
    next[field] = unique(values.map(cleanCriteriaTerm).filter((value): value is string => Boolean(value))) as never;
  }
  if (typeof next.seniority === 'string') next.seniority = cleanCriteriaTerm(next.seniority);
  // Promote recognized role-family aliases out of generic keywords so that
  // Firmware/EE/Hardware carry role weight instead of competing with broad
  // terms such as "Engineer" at the same low keyword weight.
  const promotedRoles = next.keywords.filter(isRoleTerm);
  if (promotedRoles.length) {
    next.targetRoles = unique([...next.targetRoles, ...promotedRoles]);
    next.keywords = next.keywords.filter((value) => !isRoleTerm(value));
  }
  return next;
}

function criteriaSignalCount(criteria: TalentSearchCriteria): number {
  return CRITERIA_LIST_FIELDS.reduce((count, field) => count + criteria[field].length, 0);
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
  // into a meaningful result. Explicit role/function fields and evidence-backed
  // skill/domain signals can qualify a result; location alone cannot.
  const explicitRoleRequests = unique([
    ...criteria.targetRoles,
    ...criteria.titles,
    ...criteria.functions
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
  const explicitRoleMatched = explicitRoleRequests.length === 0
    || explicitRoleRequests.some((requestedValue) => matchesSearchTerm(coreEvidence, requestedValue));
  const coreSignalRequests = unique([
    ...criteria.skills,
    ...criteria.mustHave,
    ...criteria.keywords,
    ...criteria.industries,
    ...criteria.companies,
    ...criteria.niceToHave,
    ...queryTokens(criteria.freeText)
  ]);
  const coreSignalMatched = coreSignalRequests.length > 0
    && coreSignalRequests.some((requestedValue) => matchesEvidence(coreEvidence, requestedValue));
  // Normal searches are intentionally soft: a candidate may be adjacent when
  // a skill/domain signal matches even if one requested role label does not.
  // Explicit mustMatchAll is reserved for recruiters who really require every
  // requested signal.
  const strictRequests = unique([
    ...criteria.targetRoles,
    ...criteria.titles,
    ...criteria.functions,
    ...criteria.skills,
    ...criteria.mustHave
  ]);
  const strictMatched = strictRequests.every((requestedValue) => matchesEvidence(coreEvidence, requestedValue));
  const coreEligible = criteria.mustMatchAll
    ? strictMatched
    : explicitRoleRequests.length > 0 ? explicitRoleMatched || coreSignalMatched : coreSignalMatched;

  const matched: string[] = [];
  const gaps: string[] = [];
  const explanationFacts: string[] = [];
  let points = 0;
  let possible = 0;
  const scoreBreakdown: TalentSearchMatch['scoreBreakdown'] = [];

  const scoreGroup = (label: string, requested: string[], fieldValues: string[], weight: number, missingAsGap = false) => {
    let matchedCount = 0;
    let contribution = 0;
    const requestedValues = unique(requested);
    for (const requestedValue of requestedValues) {
      const normalizedRequested = normalize(requestedValue);
      const genericRole = label === '關鍵字' && /^(?:engineer|developer|manager|工程師|主管|職員)$/.test(normalizedRequested);
      const termWeight = genericRole ? Math.max(1, Math.round(weight * 0.25)) : weight;
      possible += termWeight;
      const fieldText = normalize(fieldValues.join(' | '));
      const evidenceText = fieldText || searchable;
      // Use the same evidence-aware matcher for every group so aliases and
      // compound requirements behave consistently across role, skill, company,
      // and preference fields. This still never invents candidate facts.
      const matchedTerm = matchesEvidence(evidenceText, requestedValue);
      if (matchedTerm) {
        points += termWeight;
        contribution += termWeight;
        matchedCount += 1;
        matched.push(`${label}: ${requestedValue}`);
        explanationFacts.push(`${requestedValue} (${label})`);
      } else if (missingAsGap) {
        gaps.push(requestedValue);
        // Preferences remain visible as gaps for recruiter review, but only
        // explicit Must Have criteria reduce the score.
        if (label === 'Must Have') points -= Math.round(weight * 0.8);
      }
    }
    if (requestedValues.length) scoreBreakdown.push({ dimension: label, matched: matchedCount, requested: requestedValues.length, contribution });
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
  // Nice-to-have criteria improve ranking when present but must not create a
  // large negative penalty. Treating preferences as missing must-haves was
  // responsible for many unrelated candidates collapsing to the same low
  // score in broad Job Context searches.
  scoreGroup('Nice to Have', criteria.niceToHave, [searchable], 4, true);
  scoreGroup('關鍵字', criteria.keywords, [searchable], 3);

  const fallbackTerms = possible === 0
    ? unique(criteria.freeText.split(/[\s,，、;；|]+/).filter((value) => value.length >= 2)).slice(0, 12)
    : [];
  scoreGroup('關鍵字', fallbackTerms, [searchable], 3);

  if (criteria.excluded.some((item) => hasTerm(searchable, item))) return null;
  if (!coreEligible) return null;
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
  const explicitRoleEvidence = explicitRoleRequests.some((requestedValue) => matchesSearchTerm(coreEvidence, requestedValue));
  const matchTier: TalentSearchMatch['matchTier'] = row.snapshot_id === null
    ? 'baseline'
    : explicitRoleEvidence ? 'direct' : 'adjacent';

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
    evidenceWarnings,
    matchTier,
    scoreBreakdown
  };
}

export class TalentSearchService implements TalentSearchServiceContract {
  public constructor(private readonly database: DatabasePool, private readonly aiProvider?: AiProvider) {}

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
      ), base AS (
        SELECT c.id,c.candidate_code,c.display_name,c.location_text,c.current_company,c.current_title,c.updated_at,
          ref.external_candidate_id AS ats_candidate_id
        FROM candidates c
        LEFT JOIN LATERAL (
          SELECT r.external_candidate_id FROM candidate_external_refs r
          JOIN source_instances s ON s.id=r.source_instance_id
          WHERE r.candidate_id=c.id AND s.source_system='pinpin' AND s.instance_key='pinpin-prod'
          ORDER BY r.last_seen_at DESC LIMIT 1
        ) ref ON true
        WHERE c.canonical_status='active'
      )
      SELECT base.id AS candidate_id,base.candidate_code,base.display_name,base.location_text,base.current_company,base.current_title,
        base.ats_candidate_id,latest.snapshot_id,COALESCE(latest.profile_updated_at,base.updated_at) AS profile_updated_at,
        COALESCE(processing.status, CASE WHEN latest.snapshot_id IS NULL THEN 'not_processed' ELSE 'completed' END) AS profile_status,
        latest.professional_summary,latest.recruiter_summary,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'companyName',w.company_name,'jobTitle',w.job_title,'department',w.department,'location',w.location_text,
          'description',w.description,'provenance',w.provenance) ORDER BY w.display_order)
          FROM candidate_ai_work_experiences w WHERE w.enrichment_snapshot_id=latest.snapshot_id),
          (SELECT jsonb_agg(jsonb_build_object(
            'companyName',w.company_name,'jobTitle',w.job_title,'department',w.department,'location',NULL,
            'description',w.description,'provenance',w.source_instance_id::text) ORDER BY w.display_order)
           FROM candidate_work_experiences w WHERE w.candidate_id=base.id),'[]'::jsonb) AS work,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'schoolName',e.school_name,'degree',e.degree_raw,'major',e.major_raw,'provenance',e.provenance) ORDER BY e.display_order)
          FROM candidate_ai_educations e WHERE e.enrichment_snapshot_id=latest.snapshot_id),
          (SELECT jsonb_agg(jsonb_build_object(
            'schoolName',e.school_name,'degree',e.degree_raw,'major',e.major_raw,'provenance',e.source_instance_id::text) ORDER BY e.display_order)
           FROM candidate_educations e WHERE e.candidate_id=base.id),'[]'::jsonb) AS education,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('type',t.term_type,'value',t.value,'provenance',t.provenance) ORDER BY t.term_type,t.display_order)
          FROM candidate_ai_terms t WHERE t.enrichment_snapshot_id=latest.snapshot_id),'[]'::jsonb) AS terms,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceType',ev.source_type,'sourceSystem',ev.source_system,
          'contentSha256',ev.content_sha256,'representationKind',ev.representation_kind) ORDER BY ev.created_at DESC)
          FROM candidate_resume_evidence ev WHERE ev.candidate_id=base.id),'[]'::jsonb) AS evidence
      FROM base
      LEFT JOIN latest ON latest.candidate_id=base.id
      LEFT JOIN candidate_processing_state processing ON processing.candidate_id=base.id
      ORDER BY COALESCE(latest.profile_updated_at,base.updated_at) DESC,base.id DESC
      LIMIT $1
    `, [SEARCH_POOL_LIMIT]);

    const criteria = sanitizeCriteria(request.criteria);
    const ranked = result.rows
      .map((row) => rank(row, criteria))
      .filter((item): item is TalentSearchMatch => Boolean(item))
      .sort((a, b) => b.matchScore - a.matchScore || (b.profileUpdatedAt ?? '').localeCompare(a.profileUpdatedAt ?? ''))
      .slice(0, request.limit);
    return { coverage: await this.coverage(), results: ranked, scoreDefinition: 'recruiting_match_score' };
  }

  public async searchQuery(query: string, limit: number, mustMatchAll = false): Promise<TalentSearchResponse> {
    const fallback = (): TalentSearchCriteria => ({
      intent: 'candidate_search', targetRoles: [], titles: [], skills: [], functions: [],
      industries: [], companies: [], locations: [], languages: [], education: [], seniority: null,
      minExperienceYears: null, mustHave: [], niceToHave: [], keywords: queryTokens(query),
      excluded: [], freeText: query, confidence: 0, mustMatchAll
    });
    let criteria = fallback();
    if (this.aiProvider?.isConfigured()) {
      try {
        const generated = await this.aiProvider.generateStructured({
          prompt: [
            'You are the Talent Nexus recruiting search query parser.',
            'Convert the recruiter query into JSON search criteria only. Do not search candidates and do not invent candidate facts.',
            'Use synonyms and adjacent role families for recall. Set mustMatchAll=true only when the recruiter explicitly says every/all/must.',
            'Keep uncertain concepts in keywords or niceToHave; keep mustHave for explicit requirements.',
            `Recruiter query:\n${query}`
          ].join('\n'),
          schema: {
            type: 'object',
            properties: {
              intent: { type: 'string', enum: ['candidate_search'] },
              targetRoles: { type: 'array', items: { type: 'string' } }, titles: { type: 'array', items: { type: 'string' } },
              skills: { type: 'array', items: { type: 'string' } }, functions: { type: 'array', items: { type: 'string' } },
              industries: { type: 'array', items: { type: 'string' } }, companies: { type: 'array', items: { type: 'string' } },
              locations: { type: 'array', items: { type: 'string' } }, languages: { type: 'array', items: { type: 'string' } },
              education: { type: 'array', items: { type: 'string' } }, seniority: { type: ['string', 'null'] },
              minExperienceYears: { type: ['number', 'null'] }, mustHave: { type: 'array', items: { type: 'string' } },
              niceToHave: { type: 'array', items: { type: 'string' } }, keywords: { type: 'array', items: { type: 'string' } },
              excluded: { type: 'array', items: { type: 'string' } }, confidence: { type: 'number' }, mustMatchAll: { type: 'boolean' }
            }, required: ['intent', 'targetRoles', 'titles', 'skills', 'functions', 'industries', 'companies', 'locations', 'languages', 'education', 'seniority', 'minExperienceYears', 'mustHave', 'niceToHave', 'keywords', 'excluded', 'confidence', 'mustMatchAll']
          }
        });
        const parsed = talentSearchIntentSchema.safeParse(generated.json);
        if (parsed.success) {
          const cleaned = sanitizeCriteria({ ...parsed.data, freeText: query });
          // A model can occasionally turn numbered JD bullets into terms such
          // as "1." or return only generic headers. Preserve any meaningful
          // parsed signals, but supplement weak output with deterministic
          // query tokens so the search does not silently collapse to noise.
          criteria = criteriaSignalCount(cleaned) >= 2
            ? cleaned
            : sanitizeCriteria({ ...cleaned, keywords: unique([...cleaned.keywords, ...queryTokens(query)]), freeText: query });
          if (mustMatchAll) criteria.mustMatchAll = true;
        }
      } catch {
        // Query understanding is an enhancement. Deterministic token fallback
        // keeps search available when Gemini is unavailable or transiently fails.
      }
    }
    const response = await this.search({ criteria, limit });
    return { ...response, interpretation: criteria };
  }
}

export { rank as rankCandidateForSearch };
