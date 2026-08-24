export type PinpinAttachmentClassification = {
  filenameRaw: string | null;
  filenameNormalized: string | null;
  extension: string | null;
  documentType: 'resume' | 'recruiter_submission_report' | 'other';
  sourceOrigin: 'pinpin_imported_original' | 'manual_upload_assumed' | 'recruiter_submission' | 'unknown';
  classificationBasis: string;
  classificationConfidence: 'high' | 'medium' | 'low';
  isPrimaryResumeCandidate: boolean;
};

export type PinpinAttachmentMetadata = PinpinAttachmentClassification & {
  sourceSystem: 'pinpin';
  sourceInstance: 'pinpin-prod';
  atsCandidateId: string;
  attachmentId: string;
  fileRef: string;
  sizeBytes: number | null;
  createdAt: string | null;
};

function normalized(value: string | null | undefined): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.normalize('NFKC') : null;
}

export function derivePinpinFileRef(attachmentId: string | number): string {
  const value = String(attachmentId ?? '').trim();
  if (!/^\d{1,18}$/.test(value)) throw new Error('Invalid Pinpin attachment identifier.');
  return `CV${value}`;
}

export function classifyPinpinAttachment(filename: string | null | undefined): PinpinAttachmentClassification {
  const raw = typeof filename === 'string' && filename.trim() ? filename : null;
  const normalizedName = normalized(raw);
  const lower = normalizedName?.toLowerCase() ?? '';
  const extensionMatch = lower.match(/\.([a-z0-9]{1,12})$/);
  const extension = extensionMatch ? extensionMatch[1]! : null;
  const base = lower.replace(/\.[a-z0-9]{1,12}$/, '');

  if (/^talent nexus[-_]/i.test(base) && ['pdf', 'doc', 'docx'].includes(extension ?? '')) {
    return { filenameRaw: raw, filenameNormalized: normalizedName, extension, documentType: 'recruiter_submission_report', sourceOrigin: 'recruiter_submission', classificationBasis: 'recruiter-report filename pattern', classificationConfidence: 'high', isPrimaryResumeCandidate: false };
  }
  if ((base === '簡歷原件' || base === '简历原件') && ['html', 'htm'].includes(extension ?? '')) {
    return { filenameRaw: raw, filenameNormalized: normalizedName, extension, documentType: 'resume', sourceOrigin: 'pinpin_imported_original', classificationBasis: 'known Pinpin original-resume filename', classificationConfidence: 'high', isPrimaryResumeCandidate: true };
  }
  if (['pdf', 'doc', 'docx'].includes(extension ?? '')) {
    return { filenameRaw: raw, filenameNormalized: normalizedName, extension, documentType: 'resume', sourceOrigin: 'manual_upload_assumed', classificationBasis: 'resume-compatible document extension', classificationConfidence: 'medium', isPrimaryResumeCandidate: true };
  }
  return { filenameRaw: raw, filenameNormalized: normalizedName, extension, documentType: 'other', sourceOrigin: 'unknown', classificationBasis: extension ? 'unrecognized attachment type' : 'missing extension', classificationConfidence: 'low', isPrimaryResumeCandidate: false };
}

export function toPinpinAttachmentMetadata(input: { candidateId: string | number; attachmentId: string | number; filename: string | null; sizeBytes?: number | null; createdAt?: string | null }): PinpinAttachmentMetadata {
  const classification = classifyPinpinAttachment(input.filename);
  return {
    ...classification,
    sourceSystem: 'pinpin',
    sourceInstance: 'pinpin-prod',
    atsCandidateId: String(input.candidateId),
    attachmentId: String(input.attachmentId),
    fileRef: derivePinpinFileRef(input.attachmentId),
    sizeBytes: input.sizeBytes ?? null,
    createdAt: input.createdAt ?? null
  };
}

export function choosePreferredResume(candidates: PinpinAttachmentMetadata[]): { status: 'selected' | 'needs_review' | 'none'; attachment: PinpinAttachmentMetadata | null } {
  const resumes = candidates.filter((item) => item.isPrimaryResumeCandidate);
  if (!resumes.length) return { status: 'none', attachment: null };
  if (resumes.length === 1) return { status: 'selected', attachment: resumes[0]! };
  const dated = resumes.filter((item) => item.createdAt).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (dated.length === resumes.length && dated[0]!.createdAt !== dated[1]!.createdAt) return { status: 'selected', attachment: dated[0]! };
  return { status: 'needs_review', attachment: null };
}
