export type CandidateSummary = {
  id: string;
  candidateCode: string;
  displayName: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  locationText: string | null;
  currentCompany: string | null;
  currentTitle: string | null;
  canonicalStatus: string;
  createdAt: string;
  updatedAt: string;
};

export type ExternalReference = {
  id: string;
  sourceInstanceId: string;
  externalCandidateId: string;
  externalUrl: string | null;
  sourceActive: boolean;
  sourceDeletedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  metadata: Record<string, unknown>;
};

export type WorkExperience = {
  id: string;
  sourceInstanceId: string | null;
  sourceRecordId: string | null;
  companyName: string | null;
  jobTitle: string | null;
  department: string | null;
  industryRaw: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
  description: string | null;
  displayOrder: number | null;
};

export type Education = {
  id: string;
  sourceInstanceId: string | null;
  sourceRecordId: string | null;
  schoolName: string | null;
  degreeRaw: string | null;
  majorRaw: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean | null;
  displayOrder: number | null;
};

export type CandidateDocument = {
  id: string;
  sourceInstanceId: string | null;
  externalDocumentId: string | null;
  storageProvider: string;
  originalFilename: string | null;
  mimeType: string | null;
  fileExtension: string | null;
  fileSizeBytes: string | null;
  documentRole: string | null;
  documentStatus: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type CandidateDetail = CandidateSummary & {
  rawSourceMetadata: Record<string, unknown>;
  externalReferences: ExternalReference[];
  workExperiences: WorkExperience[];
  educations: Education[];
  documents: CandidateDocument[];
  tags: Array<{ id: string; tag: string; tagType: string | null; origin: string }>;
};

export type CandidateListQuery = {
  limit: number;
  offset: number;
  candidateCode?: string;
  name?: string;
  company?: string;
  title?: string;
};

export type CandidateListResult = {
  data: CandidateSummary[];
  total: number;
};

export interface CandidateRepository {
  health(): Promise<void>;
  list(query: CandidateListQuery): Promise<CandidateListResult>;
  findByIdOrCode(idOrCode: string): Promise<CandidateDetail | null>;
}
