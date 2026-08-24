export type TalentSearchCriteria = {
  intent: 'candidate_search';
  targetRoles: string[];
  titles: string[];
  skills: string[];
  functions: string[];
  industries: string[];
  companies: string[];
  locations: string[];
  languages: string[];
  education: string[];
  seniority: string | null;
  minExperienceYears: number | null;
  mustHave: string[];
  niceToHave: string[];
  keywords: string[];
  excluded: string[];
  freeText: string;
  confidence: number;
  /** Natural-language searches default to soft matching. */
  mustMatchAll?: boolean;
};

export type TalentSearchRequest = {
  criteria: TalentSearchCriteria;
  limit: number;
};

export type TalentSearchMatch = {
  candidateId: string;
  candidateCode: string;
  atsCandidateId: string | null;
  name: string;
  currentCompany: string | null;
  currentTitle: string | null;
  location: string | null;
  matchScore: number;
  matched: string[];
  gaps: string[];
  needsConfirmation: string[];
  relevantTags: string[];
  explanationFacts: string[];
  profileStatus: string;
  profileUpdatedAt: string | null;
  evidenceStatus: 'content_backed' | 'metadata_only' | 'unavailable';
  evidenceWarnings: string[];
  matchTier: 'direct' | 'adjacent' | 'baseline';
  scoreBreakdown: Array<{ dimension: string; matched: number; requested: number; contribution: number }>;
};

export type TalentSearchResponse = {
  coverage: { aiReady: number };
  results: TalentSearchMatch[];
  scoreDefinition: 'recruiting_match_score';
  /** Present for natural-language searches so recruiter UIs can show how the request was understood. */
  interpretation?: TalentSearchCriteria;
};

export interface TalentSearchServiceContract {
  coverage(): Promise<{ aiReady: number }>;
  search(request: TalentSearchRequest): Promise<TalentSearchResponse>;
  /** Optional natural-language entry point; structured callers remain supported. */
  searchQuery?(query: string, limit: number, mustMatchAll?: boolean): Promise<TalentSearchResponse>;
}
