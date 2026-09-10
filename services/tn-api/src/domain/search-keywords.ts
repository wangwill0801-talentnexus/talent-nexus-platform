import { z } from 'zod';
import type { AiProvider } from '../ai/types.js';

const text = z.string().trim().min(1).max(500);

export const searchKeywordsRequestV1Schema = z.object({
  contractVersion: z.literal('search_keywords_v1'),
  source: z.enum(['104-vip-search', 'linkedin-recruiter-search']),
  jd: z.string().trim().min(10).max(12_000),
}).strict();

export type SearchKeywordsRequestV1 = z.infer<typeof searchKeywordsRequestV1Schema>;

export const searchKeywordGroupV1Schema = z.object({
  groupNumber: z.number().int().min(1).max(8),
  label: text.max(80),
  query: z.string().trim().min(1).max(500),
  rationale: text.max(300),
  focus: z.array(text.max(80)).max(8),
}).strict();

export const searchKeywordsResponseV1Schema = z.object({
  // LinkedIn keeps the original 3-5 groups. 104 returns those groups plus
  // two or three explicitly marked precision combinations (5-8 total).
  groups: z.array(searchKeywordGroupV1Schema).min(3).max(8),
  fieldSuggestions: z.object({
    jobTitles: z.array(text.max(120)).max(3).default([]),
    locations: z.array(text.max(120)).max(2).default([]),
    skills: z.array(text.max(120)).max(6).default([]),
  }).strict().optional(),
}).strict().superRefine((value, context) => {
  const numbers = value.groups.map((group) => group.groupNumber);
  const queries = value.groups.map((group) => group.query.toLocaleLowerCase());
  if (new Set(numbers).size !== numbers.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['groups'], message: 'Keyword group numbers must be unique.' });
  if (new Set(queries).size !== queries.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['groups'], message: 'Keyword queries must be unique.' });
});

export type SearchKeywordGroupV1 = z.infer<typeof searchKeywordGroupV1Schema>;
export type SearchKeywordsResponseV1 = z.infer<typeof searchKeywordsResponseV1Schema>;

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?<!\d)(?:\+?886[- .]?)?0?\d(?:[ -]?\d){7,12}(?!\d)/g;
const SECRET_PATTERN = /(?:cookie|token|password|authorization|session|secret)\s*[:=]\s*[^\s,;]+/gi;

function redact(value: string, max = 12_000): string {
  return value.replace(EMAIL_PATTERN, '[redacted-email]').replace(PHONE_PATTERN, '[redacted-phone]').replace(SECRET_PATTERN, '[redacted-sensitive-value]').slice(0, max);
}

function normalizeLinkedInQuery(value: string): string {
  return value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\b(and|or|not)\b/gi, (operator) => operator.toUpperCase())
    .trim();
}

function isLinkedInQuerySafe(value: string): boolean {
  if (/[{}\[\]<>*]/.test(value)) return false;
  if (/(^|\s)[+-](?=\S)/.test(value)) return false;
  return true;
}

const PRECISION_LABEL_PATTERN = /^(?:精準限定|precision[-\s]?only|strict[-\s]?only)/i;
const QUERY_OPERATOR_PATTERN = /\b(?:AND|OR|NOT)\b/gi;
const QUERY_PUNCTUATION_PATTERN = /[()"“”‘’]/g;
const GENERIC_104_QUERY_TERMS = new Set([
  '工程師', '電子', '科技', '科技業', '相關', '熟悉', '具備', '經驗', '背景',
  '人才', '人選', '工作', '職缺', '能力', '條件', 'engineer', 'developer',
  'manager', 'professional', 'experience', 'background'
]);

function isPrecisionGroup(group: SearchKeywordGroupV1): boolean {
  return PRECISION_LABEL_PATTERN.test(group.label.trim());
}

function normalizedSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-Hant').replace(/\s+/g, ' ').trim();
}

function queryTerms(query: string): string[] {
  return query
    .replace(QUERY_OPERATOR_PATTERN, ' ')
    .replace(QUERY_PUNCTUATION_PATTERN, ' ')
    .split(/[\s,，、;；|/]+/)
    .map((term) => normalizedSearchText(term))
    .filter((term) => term.length >= 2 && !GENERIC_104_QUERY_TERMS.has(term) && !/^\d+$/.test(term));
}

function validateGroupLayout(request: SearchKeywordsRequestV1, groups: SearchKeywordGroupV1[]): void {
  const is104 = request.source === '104-vip-search';
  const min = is104 ? 5 : 3;
  const max = is104 ? 8 : 5;
  if (groups.length < min || groups.length > max) throw new Error('SEARCH_KEYWORDS_INVALID_GROUP_COUNT');
  if (!is104) return;

  const precision = groups.filter(isPrecisionGroup);
  const standard = groups.length - precision.length;
  if (standard < 3 || standard > 5 || precision.length < 2 || precision.length > 3) {
    throw new Error('SEARCH_KEYWORDS_INVALID_104_GROUP_LAYOUT');
  }
  const jdText = normalizedSearchText(request.jd);
  for (const group of precision) {
    const terms = queryTerms(group.query);
    const anchors = [...new Set(terms.filter((term) => jdText.includes(term)))];
    const invented = terms.filter((term) => !jdText.includes(term));
    // Precision groups must be visibly conjunctive and grounded in at least
    // two terms copied from the supplied JD. Synonym expansion remains
    // available in the original standard groups, not in this strict tier.
    if (!/\bAND\b/i.test(group.query) || anchors.length < 2 || invented.length > 0) {
      throw new Error('SEARCH_KEYWORDS_INVALID_104_PRECISION_GROUP');
    }
  }
}

export function sanitizeSearchKeywordsRequest(value: unknown): SearchKeywordsRequestV1 {
  const parsed = searchKeywordsRequestV1Schema.parse(value);
  return { ...parsed, jd: redact(parsed.jd) };
}

export const searchKeywordsResponseSchema = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      minItems: 3,
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          groupNumber: { type: 'integer', minimum: 1, maximum: 8 },
          label: { type: 'string' },
          query: { type: 'string' },
          rationale: { type: 'string' },
          focus: { type: 'array', items: { type: 'string' } },
        },
        required: ['groupNumber', 'label', 'query', 'rationale', 'focus'],
      },
    },
    fieldSuggestions: {
      type: 'object',
      properties: {
        jobTitles: { type: 'array', items: { type: 'string' }, maxItems: 3 },
        locations: { type: 'array', items: { type: 'string' }, maxItems: 2 },
        skills: { type: 'array', items: { type: 'string' }, maxItems: 6 },
      },
      required: ['jobTitles', 'locations', 'skills'],
      additionalProperties: false,
    },
  },
  required: ['groups'],
} as const;

export function buildSearchKeywordsPrompt(request: SearchKeywordsRequestV1): string {
  const isLinkedIn = request.source === 'linkedin-recruiter-search';
  return [
    isLinkedIn ? 'You are Talent Nexus helping a recruiter search candidates in LinkedIn Recruiter.' : 'You are Talent Nexus helping a recruiter search the currently available 104 candidate database.',
    isLinkedIn ? 'Turn the recruiter-provided job description into 3 to 5 alternative Boolean keyword groups that can be pasted into the LinkedIn Recruiter Keywords field.' : 'Turn the recruiter-provided job description into 5 to 8 total keyword groups for the 104 VIP candidate search box: preserve the original 3 to 5 progression groups, then add 2 to 3 additional groups labeled "精準限定 1", "精準限定 2" (and optionally "精準限定 3").',
    isLinkedIn ? 'Follow LinkedIn Recruiter Boolean rules exactly: use uppercase AND, OR, and NOT; use parentheses for grouping; use straight double quotes for exact phrases. Do not use +, -, wildcard *, braces, square brackets, angle brackets, regex, URLs, salaries, contact details, names, or invented requirements.' : 'Follow practical 104 search behavior: keep queries concise, use exact role/skill terms, and use AND only when it clarifies a strict combination. Do not use unsupported wildcards, regex, URLs, salaries, contact details, names, or invented requirements.',
    isLinkedIn ? 'Also return conservative fieldSuggestions for optional recruiter-controlled fields: at most 3 jobTitles, 2 locations, and 6 skills. Use only explicit JD terms; leave an array empty when the JD does not support it. Do not suggest companies, schools, graduation years, industries, or hidden/profile data.' : 'Do not return fieldSuggestions for 104; keyword groups are the only requested output.',
    isLinkedIn ? 'Return a useful progression: a precise must-have group, a balanced group, and a broader transferable/adjacent group. Add fourth or fifth groups only when the JD supports genuinely different search angles.' : 'For 104, groups 1 to 3 (or 1 to 5) are the existing precise/balanced/broader progression. The final 2 to 3 "精準限定" groups are a separate strict tier: each must use AND, include one explicit role/title plus at least two high-signal technologies, products, platforms, methods or domain terms copied from the JD, and never be role-only, industry-only or a single broad keyword. Use only literal JD terms in this strict tier; do not invent synonyms or requirements.',
    'Each query must be distinct, human-readable, and directly usable without further editing. Keep English technical terms when they are common in Taiwan recruiting and include Traditional Chinese equivalents when helpful.',
    'The rationale and focus fields are short recruiter guidance, not candidate claims. Do not include PII or credentials.',
    'Return JSON matching the provided schema and nothing else.',
    `JOB DESCRIPTION:\n${request.jd}`,
  ].join('\n\n');
}

export async function runSearchKeywords(provider: AiProvider, rawRequest: unknown): Promise<SearchKeywordsResponseV1> {
  const request = sanitizeSearchKeywordsRequest(rawRequest);
  const generated = await provider.generateStructured({ prompt: buildSearchKeywordsPrompt(request), schema: searchKeywordsResponseSchema });
  const parsed = searchKeywordsResponseV1Schema.safeParse(generated.json);
  if (!parsed.success) throw new Error('SEARCH_KEYWORDS_INVALID_AI_RESPONSE');
  validateGroupLayout(request, parsed.data.groups);
  const safeGroups = parsed.data.groups.map((group) => {
    const query = request.source === 'linkedin-recruiter-search' ? normalizeLinkedInQuery(group.query) : group.query;
    if (request.source === 'linkedin-recruiter-search' && !isLinkedInQuerySafe(query)) throw new Error('SEARCH_KEYWORDS_INVALID_LINKEDIN_QUERY');
    return {
      ...group,
      label: redact(group.label, 80),
      query: redact(query, 500),
      rationale: redact(group.rationale, 300),
      focus: group.focus.map((item) => redact(item, 80)),
    };
  });
  const safeFieldSuggestions = request.source === 'linkedin-recruiter-search' ? {
    jobTitles: (parsed.data.fieldSuggestions?.jobTitles || []).map((item) => redact(item, 120)).filter(Boolean).slice(0, 3),
    locations: (parsed.data.fieldSuggestions?.locations || []).map((item) => redact(item, 120)).filter(Boolean).slice(0, 2),
    skills: (parsed.data.fieldSuggestions?.skills || []).map((item) => redact(item, 120)).filter(Boolean).slice(0, 6),
  } : undefined;
  const safe = searchKeywordsResponseV1Schema.safeParse({ groups: safeGroups, ...(safeFieldSuggestions ? { fieldSuggestions: safeFieldSuggestions } : {}) });
  if (!safe.success) throw new Error('SEARCH_KEYWORDS_INVALID_AI_RESPONSE');
  const fieldSuggestions = safe.data.fieldSuggestions;
  return fieldSuggestions ? { groups: [...safe.data.groups].sort((a, b) => a.groupNumber - b.groupNumber), fieldSuggestions } : { groups: [...safe.data.groups].sort((a, b) => a.groupNumber - b.groupNumber) };
}
