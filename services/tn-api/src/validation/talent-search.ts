import { z } from 'zod';

const item = z.string().trim().min(1).max(120);
const list = z.array(item).max(24).default([]);

export const talentSearchCriteriaSchema = z.object({
  intent: z.literal('candidate_search').default('candidate_search'),
  targetRoles: list,
  titles: list,
  skills: list,
  functions: list,
  industries: list,
  companies: list,
  locations: list,
  languages: list,
  education: list,
  seniority: z.string().trim().max(80).nullable().default(null),
  minExperienceYears: z.number().min(0).max(80).nullable().default(null),
  mustHave: list,
  niceToHave: list,
  keywords: list,
  excluded: list,
  freeText: z.string().trim().max(4_000).default(''),
  confidence: z.number().min(0).max(1).default(0)
});

export const talentSearchRequestSchema = z.object({
  criteria: talentSearchCriteriaSchema,
  limit: z.coerce.number().int().min(1).max(50).default(20)
});
