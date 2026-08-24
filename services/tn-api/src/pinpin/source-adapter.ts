import { createRequire } from 'node:module';
import os from 'node:os';
import type { NativeConnection } from 'msnodesqlv8';
import { classifyPinpinAttachment, derivePinpinFileRef, type PinpinAttachmentClassification } from './attachment-metadata.js';

export const pinpinSourceTransport = 'shared-memory-lpc';

const require = createRequire(import.meta.url);

export type PinpinWorkRecord = {
  sourceRecordId: string;
  companyName: string | null;
  jobTitle: string | null;
  department: string | null;
  industryRaw: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean;
};

export type PinpinEducationRecord = {
  sourceRecordId: string;
  schoolName: string | null;
  degreeRaw: string | null;
  majorRaw: string | null;
  descriptionRaw: string | null;
  startDate: string | null;
  endDate: string | null;
  isCurrent: boolean | null;
};

export type PinpinDocumentMetadata = {
  externalDocumentId: string;
  candidateExternalId: string;
  originalFilename: string | null;
  fileExtension: string | null;
  fileSizeBytes: number | null;
  sourceCreatedAt: string | null;
  fileRef: string;
  classification: PinpinAttachmentClassification;
};

export type PinpinCandidateSnapshot = {
  externalCandidateId: string;
  displayName: string | null;
  sourceActive: boolean;
  primaryEmail: string | null;
  primaryPhone: string | null;
  locationText: string | null;
  desiredLocationsRaw: string | null;
  topEducationRaw: string | null;
  birthDateRaw: string | null;
  genderRaw: string | null;
  salaryRaw: number | null;
  tagsRaw: string | null;
  sourceRaw: string | null;
  noteRaw: string | null;
  deletedAt: string | null;
  workExperiences: PinpinWorkRecord[];
  educations: PinpinEducationRecord[];
  documents: PinpinDocumentMetadata[];
};

export type PinpinSourcePreflight = {
  totalCandidates: number;
  activeCandidates: number;
  inactiveCandidates: number;
  candidatesWithCompleteName: number;
  candidatesWithWork: number;
  candidatesWithEducation: number;
  candidatesWithDocuments: number;
  totalWorkRows: number;
  totalEducationRows: number;
  totalDocumentRows: number;
  importableWorkRows: number;
  importableEducationRows: number;
  importableDocumentRows: number;
};

export type PinpinIncrementalSignalSnapshot = {
  candidateIds: string[];
  candidateIdHighWater: number;
  history: Array<{ candidateId: string; stableId: string | null; changedAt: string | null }>;
  attachments: Array<{ candidateId: string; stableId: string; changedAt: string | null }>;
  deletions: Array<{ candidateId: string; changedAt: string | null }>;
  workIdHighWater: number | null;
  educationIdHighWater: number | null;
  schema: Array<{ table: string; column: string; type: string; nullable: boolean }>;
};

type Row = Record<string, unknown>;

const candidateProjection = `
  SELECT TOP ({{LIMIT}}) [ID], [Active], [A0101], [A0102], [A0103], [A01099], [A0118], [A0122], [A0112], [A0202], [A0124], [A9901], [CVSource], [LastRemark]
  FROM dbo.ZPResumeInfo
  WHERE [ID] > ?
  ORDER BY [ID] ASC`;

const candidateByIdProjection = `
  SELECT [ID], [Active], [A0101], [A0102], [A0103], [A01099], [A0118], [A0122], [A0112], [A0202], [A0124], [A9901], [CVSource], [LastRemark]
  FROM dbo.ZPResumeInfo
  WHERE [ID] = ?`;

const realPilotSelectionProjection = `
  SELECT TOP (5) [ID], [Active], [A0101], [A0102], [A0103], [A01099], [A0118], [A0122], [A0112], [A0202], [A0124], [A9901], [CVSource], [LastRemark]
  FROM dbo.ZPResumeInfo AS candidate
  WHERE candidate.[Active] = 1
    AND NULLIF(LTRIM(RTRIM(candidate.[A0101])), '') IS NOT NULL
    AND candidate.[ID] NOT IN (43177, 43184)
    AND candidate.[A0101] NOT LIKE '%SYSTEM TEST%'
    AND candidate.[A0101] NOT LIKE '%TN %TEST%'
    AND EXISTS (SELECT 1 FROM dbo.ZPResumeWork AS work WHERE work.[ResumeID] = candidate.[ID])
  ORDER BY
    CASE WHEN EXISTS (SELECT 1 FROM dbo.ZPResumeInfo_Annex_Other AS document WHERE document.[ZPResumeInfo_ID] = candidate.[ID]) THEN 0 ELSE 1 END,
    candidate.[ID] ASC`;

const workProjection = `
  SELECT [ID], [ResumeID], [YearB], [YearE], [Company], [F1], [Dept], [F5], [Industry], [IsCur]
  FROM dbo.ZPResumeWork
  WHERE [ResumeID] IN ({{IDS}})`;

const educationProjection = `
  SELECT [ID], [ResumeID], [YearB], [YearE], [School], [F1], [F2], [detail], [IsCur]
  FROM dbo.ZPResumeEdu
  WHERE [ResumeID] IN ({{IDS}})`;

const documentProjection = `
  SELECT [ID], [ZPResumeInfo_ID], [FileName], [FileType], [Filesize], [CreDate]
  FROM dbo.ZPResumeInfo_Annex_Other
  WHERE [ZPResumeInfo_ID] IN ({{IDS}})`;

const deletionProjection = `
  SELECT [FID], [DelDate]
  FROM dbo.zpresumeinfoDel
  WHERE [FID] IN ({{IDS}})`;

const preflightProjection = `
  SELECT
    (SELECT COUNT([ID]) FROM dbo.ZPResumeInfo) AS TotalCandidates,
    (SELECT COUNT([ID]) FROM dbo.ZPResumeInfo WHERE [Active] = 1) AS ActiveCandidates,
    (SELECT COUNT([ID]) FROM dbo.ZPResumeInfo WHERE ISNULL([Active], 0) <> 1) AS InactiveCandidates,
    (SELECT COUNT([ID]) FROM dbo.ZPResumeInfo WHERE NULLIF(LTRIM(RTRIM([A0101])), '') IS NOT NULL) AS CandidatesWithCompleteName,
    (SELECT COUNT([ID]) FROM dbo.ZPResumeInfo AS candidate WHERE EXISTS (SELECT 1 FROM dbo.ZPResumeWork AS work WHERE work.[ResumeID] = candidate.[ID])) AS CandidatesWithWork,
    (SELECT COUNT([ID]) FROM dbo.ZPResumeInfo AS candidate WHERE EXISTS (SELECT 1 FROM dbo.ZPResumeEdu AS education WHERE education.[ResumeID] = candidate.[ID])) AS CandidatesWithEducation,
    (SELECT COUNT([ID]) FROM dbo.ZPResumeInfo AS candidate WHERE EXISTS (SELECT 1 FROM dbo.ZPResumeInfo_Annex_Other AS document WHERE document.[ZPResumeInfo_ID] = candidate.[ID])) AS CandidatesWithDocuments,
    (SELECT COUNT([ID]) FROM dbo.ZPResumeWork) AS TotalWorkRows,
    (SELECT COUNT([ID]) FROM dbo.ZPResumeEdu) AS TotalEducationRows,
    (SELECT COUNT([ID]) FROM dbo.ZPResumeInfo_Annex_Other) AS TotalDocumentRows,
    (SELECT COUNT(work.[ID]) FROM dbo.ZPResumeWork AS work INNER JOIN dbo.ZPResumeInfo AS candidate ON candidate.[ID] = work.[ResumeID]) AS ImportableWorkRows,
    (SELECT COUNT(education.[ID]) FROM dbo.ZPResumeEdu AS education INNER JOIN dbo.ZPResumeInfo AS candidate ON candidate.[ID] = education.[ResumeID]) AS ImportableEducationRows,
    (SELECT COUNT(document.[ID]) FROM dbo.ZPResumeInfo_Annex_Other AS document INNER JOIN dbo.ZPResumeInfo AS candidate ON candidate.[ID] = document.[ZPResumeInfo_ID]) AS ImportableDocumentRows`;

const incrementalSchemaProjection = `
  SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME IN ('ZPResumeInfo', 'ZPResumeInfo_Note', 'ZPResumeInfo_Annex_Other', 'zpresumeinfoDel', 'ZPResumeWork', 'ZPResumeEdu')
  ORDER BY TABLE_NAME, ORDINAL_POSITION`;

function text(value: unknown): string | null {
  if (typeof value !== 'string') return value == null ? null : String(value);
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function asNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value: unknown): string | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function yearMonthToDate(value: unknown): string | null {
  const match = text(value)?.match(/^(\d{4})-(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-01` : null;
}

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function rowsFrom(result: unknown, depth = 0): Row[] {
  if (depth > 5 || result == null) return [];
  if (Array.isArray(result)) {
    if (result.every(isRow)) return result;
    return result.flatMap((item) => rowsFrom(item, depth + 1));
  }
  if (isRow(result)) {
    if ('first' in result) return rowsFrom(result.first, depth + 1);
    if ('rows' in result) return rowsFrom(result.rows, depth + 1);
  }
  return [];
}

function setting(input: string, keys: string[]): string {
  for (const entry of input.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 1) continue;
    const key = entry.slice(0, separator).trim().toLowerCase();
    if (keys.includes(key)) return entry.slice(separator + 1).trim();
  }
  return '';
}

function localConnectionString(environment: NodeJS.ProcessEnv): string {
  const raw = environment.PINPIN_SQL_CONNECTION_STRING;
  if (!raw) throw new Error('Pinpin source configuration is unavailable.');
  const username = setting(raw, ['user id', 'uid', 'user']);
  const password = setting(raw, ['password', 'pwd']);
  const database = setting(raw, ['database', 'initial catalog']) || 'HiBole-2';
  if (!username || !password || database !== 'HiBole-2') throw new Error('Pinpin source configuration is invalid.');
  return `Driver={SQL Server Native Client 10.0};Server=lpc:${os.hostname()};Database=${database};Uid=${username};Pwd=${password};`;
}

function safeLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 200) throw new Error('Invalid Pinpin page size.');
  return value;
}

function inClause(ids: number[]): string {
  if (ids.length === 0) return 'NULL';
  return ids.map(() => '?').join(', ');
}

function field(row: Row, name: string): unknown {
  return row[name] ?? row[name.toLowerCase()] ?? row[name.toUpperCase()];
}

export function mapSnapshot(candidate: Row, works: Row[], educations: Row[], documents: Row[], deletions: Row[]): PinpinCandidateSnapshot {
  const candidateId = asNumber(field(candidate, 'ID'));
  if (candidateId == null) throw new Error('Pinpin candidate identifier is invalid.');
  const matching = (rows: Row[], key: string) => rows.filter((row) => asNumber(field(row, key)) === candidateId);
  const deletion = matching(deletions, 'FID').sort((left, right) => (toIso(field(right, 'DelDate')) || '').localeCompare(toIso(field(left, 'DelDate')) || ''))[0];
  return {
    externalCandidateId: String(candidateId),
    displayName: text(field(candidate, 'A0101')),
    sourceActive: asNumber(field(candidate, 'Active')) === 1,
    primaryEmail: text(field(candidate, 'A0122')),
    primaryPhone: text(field(candidate, 'A0118')),
    locationText: text(field(candidate, 'A0112')),
    desiredLocationsRaw: text(field(candidate, 'A0202')),
    topEducationRaw: text(field(candidate, 'A0124')),
    birthDateRaw: text(field(candidate, 'A0103')),
    genderRaw: text(field(candidate, 'A0102')),
    salaryRaw: asNumber(field(candidate, 'A01099')),
    tagsRaw: text(field(candidate, 'A9901')),
    sourceRaw: text(field(candidate, 'CVSource')),
    noteRaw: text(field(candidate, 'LastRemark')),
    deletedAt: deletion ? toIso(field(deletion, 'DelDate')) : null,
    workExperiences: matching(works, 'ResumeID').map((row) => ({
      sourceRecordId: String(asNumber(field(row, 'ID')) ?? ''),
      companyName: text(field(row, 'Company')),
      jobTitle: text(field(row, 'F1')),
      department: text(field(row, 'F5')) ?? text(field(row, 'Dept')),
      industryRaw: text(field(row, 'Industry')),
      startDate: yearMonthToDate(field(row, 'YearB')),
      endDate: yearMonthToDate(field(row, 'YearE')),
      isCurrent: asNumber(field(row, 'IsCur')) === 1,
    })),
    educations: matching(educations, 'ResumeID').map((row) => ({
      sourceRecordId: String(asNumber(field(row, 'ID')) ?? ''),
      schoolName: text(field(row, 'School')),
      degreeRaw: text(field(row, 'F1')),
      majorRaw: text(field(row, 'F2')),
      descriptionRaw: text(field(row, 'detail')),
      startDate: yearMonthToDate(field(row, 'YearB')),
      endDate: yearMonthToDate(field(row, 'YearE')),
      isCurrent: field(row, 'IsCur') == null ? null : asNumber(field(row, 'IsCur')) === 1,
    })),
    documents: matching(documents, 'ZPResumeInfo_ID').map((row) => {
      const externalDocumentId = String(asNumber(field(row, 'ID')) ?? '');
      const originalFilename = text(field(row, 'FileName'));
      return {
      externalDocumentId,
      candidateExternalId: String(candidateId),
      originalFilename,
      fileExtension: text(field(row, 'FileType')),
      fileSizeBytes: asNumber(field(row, 'Filesize')),
      sourceCreatedAt: toIso(field(row, 'CreDate')),
      fileRef: derivePinpinFileRef(externalDocumentId),
      classification: classifyPinpinAttachment(originalFilename),
      };
    }),
  };
}

export class PinpinSourceAdapter {
  private constructor(private readonly connection: NativeConnection) {}

  static async connect(environment: NodeJS.ProcessEnv = process.env): Promise<PinpinSourceAdapter> {
    const sql = require('msnodesqlv8') as { promises: { open(connectionString: string): Promise<NativeConnection> } };
    return new PinpinSourceAdapter(await sql.promises.open(localConnectionString(environment)));
  }

  async close(): Promise<void> {
    await this.connection.promises.close();
  }

  async readPage(afterExternalId: number, pageSize: number): Promise<PinpinCandidateSnapshot[]> {
    const limit = safeLimit(pageSize);
    const candidates = rowsFrom(await this.connection.promises.query(candidateProjection.replace('{{LIMIT}}', String(limit)), [afterExternalId]));
    return this.hydrate(candidates);
  }

  async readCandidate(externalCandidateId: number): Promise<PinpinCandidateSnapshot | null> {
    if (!Number.isSafeInteger(externalCandidateId) || externalCandidateId < 1) throw new Error('Pinpin candidate identifier is invalid.');
    const candidates = rowsFrom(await this.connection.promises.query(candidateByIdProjection, [externalCandidateId]));
    const snapshots = await this.hydrate(candidates);
    return snapshots.length === 1 ? snapshots[0]! : null;
  }

  async readPreflight(): Promise<PinpinSourcePreflight> {
    const row = rowsFrom(await this.connection.promises.query(preflightProjection))[0];
    if (!row) throw new Error('Pinpin source preflight returned no aggregate row.');
    const required = (name: string): number => {
      const value = asNumber(field(row, name));
      if (value == null || value < 0) throw new Error('Pinpin source preflight aggregate is invalid.');
      return value;
    };
    return {
      totalCandidates: required('TotalCandidates'),
      activeCandidates: required('ActiveCandidates'),
      inactiveCandidates: required('InactiveCandidates'),
      candidatesWithCompleteName: required('CandidatesWithCompleteName'),
      candidatesWithWork: required('CandidatesWithWork'),
      candidatesWithEducation: required('CandidatesWithEducation'),
      candidatesWithDocuments: required('CandidatesWithDocuments'),
      totalWorkRows: required('TotalWorkRows'),
      totalEducationRows: required('TotalEducationRows'),
      totalDocumentRows: required('TotalDocumentRows'),
      importableWorkRows: required('ImportableWorkRows'),
      importableEducationRows: required('ImportableEducationRows'),
      importableDocumentRows: required('ImportableDocumentRows'),
    };
  }

  async readIncrementalSignals(): Promise<PinpinIncrementalSignalSnapshot> {
    const schemaRows = rowsFrom(await this.connection.promises.query(incrementalSchemaProjection));
    const allowedSchemaColumns: Record<string, string[]> = {
      ZPResumeInfo: ['ID', 'Active', 'RDate', 'ModifyUser'], ZPResumeInfo_Note: ['ID', 'ResumeID', 'LastDate'],
      ZPResumeInfo_Annex_Other: ['ID', 'ZPResumeInfo_ID', 'CreDate'], zpresumeinfoDel: ['ID', 'FID', 'DelDate'],
      ZPResumeWork: ['ID', 'ResumeID'], ZPResumeEdu: ['ID', 'ResumeID'],
    };
    const schema = schemaRows.map((row) => ({
      table: text(field(row, 'TABLE_NAME')) ?? '', column: text(field(row, 'COLUMN_NAME')) ?? '',
      type: text(field(row, 'DATA_TYPE')) ?? '', nullable: text(field(row, 'IS_NULLABLE')) === 'YES',
    })).filter((row) => row.table && row.column && allowedSchemaColumns[row.table]?.includes(row.column));
    const hasColumn = (table: string, column: string) => schema.some((row) => row.table === table && row.column === column);
    const candidates = rowsFrom(await this.connection.promises.query('SELECT [ID] FROM dbo.ZPResumeInfo ORDER BY [ID] ASC'));
    const candidateIds = candidates.map((row) => asNumber(field(row, 'ID'))).filter((value): value is number => value != null).map(String);
    const currentCandidateIds = new Set(candidateIds);
    const noteProjection = hasColumn('ZPResumeInfo_Note', 'ID')
      ? 'SELECT [ID], [ResumeID], [LastDate] FROM dbo.ZPResumeInfo_Note WHERE [ResumeID] IS NOT NULL'
      : 'SELECT [ResumeID], [LastDate] FROM dbo.ZPResumeInfo_Note WHERE [ResumeID] IS NOT NULL';
    const historyRows = hasColumn('ZPResumeInfo_Note', 'ResumeID') && hasColumn('ZPResumeInfo_Note', 'LastDate')
      ? rowsFrom(await this.connection.promises.query(noteProjection)) : [];
    const attachmentRows = rowsFrom(await this.connection.promises.query('SELECT [ID], [ZPResumeInfo_ID], [CreDate] FROM dbo.ZPResumeInfo_Annex_Other WHERE [ZPResumeInfo_ID] IS NOT NULL'));
    const deletionRows = rowsFrom(await this.connection.promises.query('SELECT [FID], [DelDate] FROM dbo.zpresumeinfoDel WHERE [FID] IS NOT NULL'));
    const workHighWater = rowsFrom(await this.connection.promises.query('SELECT MAX([ID]) AS MaxID FROM dbo.ZPResumeWork'));
    const educationHighWater = rowsFrom(await this.connection.promises.query('SELECT MAX([ID]) AS MaxID FROM dbo.ZPResumeEdu'));
    return {
      candidateIds,
      candidateIdHighWater: Math.max(0, ...candidateIds.map(Number)),
      history: historyRows.map((row) => ({ candidateId: String(asNumber(field(row, 'ResumeID')) ?? ''), stableId: hasColumn('ZPResumeInfo_Note', 'ID') ? String(asNumber(field(row, 'ID')) ?? '') : null, changedAt: toIso(field(row, 'LastDate')) })).filter((row) => currentCandidateIds.has(row.candidateId)),
      attachments: attachmentRows.map((row) => ({ candidateId: String(asNumber(field(row, 'ZPResumeInfo_ID')) ?? ''), stableId: String(asNumber(field(row, 'ID')) ?? ''), changedAt: toIso(field(row, 'CreDate')) })).filter((row) => currentCandidateIds.has(row.candidateId) && row.stableId),
      deletions: deletionRows.map((row) => ({ candidateId: String(asNumber(field(row, 'FID')) ?? ''), changedAt: toIso(field(row, 'DelDate')) })).filter((row) => currentCandidateIds.has(row.candidateId)),
      workIdHighWater: asNumber(field(workHighWater[0] ?? {}, 'MaxID')),
      educationIdHighWater: asNumber(field(educationHighWater[0] ?? {}, 'MaxID')),
      schema,
    };
  }

  async selectRealPilotCandidates(): Promise<PinpinCandidateSnapshot[]> {
    const candidates = rowsFrom(await this.connection.promises.query(realPilotSelectionProjection));
    const snapshots = await this.hydrate(candidates);
    if (snapshots.length !== 5) throw new Error('Phase 4C deterministic pilot selection did not yield exactly five candidates.');
    return snapshots;
  }

  private async hydrate(candidates: Row[]): Promise<PinpinCandidateSnapshot[]> {
    const ids = candidates.map((row) => asNumber(field(row, 'ID'))).filter((id): id is number => id != null);
    if (ids.length === 0) return [];
    const params = ids.map((id) => id as unknown);
    // SQL Server Native Client 10.0 permits one active statement per ODBC connection.
    // Keep all source reads sequential so a legacy driver cannot interleave result sets.
    const works = rowsFrom(await this.connection.promises.query(workProjection.replace('{{IDS}}', inClause(ids)), params));
    const educations = rowsFrom(await this.connection.promises.query(educationProjection.replace('{{IDS}}', inClause(ids)), params));
    const documents = rowsFrom(await this.connection.promises.query(documentProjection.replace('{{IDS}}', inClause(ids)), params));
    const deletions = rowsFrom(await this.connection.promises.query(deletionProjection.replace('{{IDS}}', inClause(ids)), params));
    return candidates.map((candidate) => mapSnapshot(candidate, works, educations, documents, deletions));
  }
}
