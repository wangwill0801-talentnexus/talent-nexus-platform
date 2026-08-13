import { z } from 'zod';

const shortText = z.string().trim().max(500).nullable().optional();
const longText = z.string().trim().max(20_000).nullable().optional();
const dateText = z.string().trim().max(32).nullable().optional();
const textList = (limit: number) => z.array(z.string().trim().min(1).max(500)).max(limit).default([]);

const experienceSchema = z.object({
  company: shortText, title: shortText, startDate: dateText, endDate: dateText,
  isCurrent: z.boolean().nullable().optional(), department: shortText, location: shortText, description: longText,
}).passthrough();

const educationSchema = z.object({
  school: shortText, degree: shortText, major: shortText, startDate: dateText, endDate: dateText,
}).passthrough();

export const standardResumeV1Schema = z.object({
  schemaVersion: z.literal('standard_resume_v1'),
  name: shortText, englishName: shortText, phone: shortText, email: shortText, location: shortText,
  expectedLocation: shortText, linkedin: z.string().trim().max(2_048).nullable().optional(),
  currentEmployment: z.object({ company: shortText, title: shortText }).passthrough().nullable().optional(),
  experience: z.array(experienceSchema).max(100).default([]),
  education: z.array(educationSchema).max(100).default([]),
  skills: textList(300), languages: textList(100), languageDetails: textList(100), certifications: textList(200), projectExperience: textList(100),
  jobPreferences: longText, summary: longText,
  targetRoles: textList(100), recruiterSummary: longText, coreKeywords: textList(300), legacySearchNote: longText,
}).passthrough();

export type StandardResumeV1 = z.infer<typeof standardResumeV1Schema>;

export function parseStandardResumeV1(payload: unknown): StandardResumeV1 {
  return standardResumeV1Schema.parse(payload);
}
