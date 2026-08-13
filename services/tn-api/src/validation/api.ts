import { z } from 'zod';

const boundedText = z.string().trim().min(1).max(120).optional();

export const candidateListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  candidateCode: boundedText,
  name: boundedText,
  company: boundedText,
  title: boundedText
});

export const candidateIdentifierSchema = z.string().trim().min(1).max(64).refine(
  (value) => /^TN\d{8,}$/.test(value) || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  'Expected a TN candidate code or UUID.'
);
