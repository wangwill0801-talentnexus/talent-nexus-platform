import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import type { NativeConnection } from 'msnodesqlv8';
import { classifyPinpinAttachment, derivePinpinFileRef, type PinpinAttachmentClassification } from './attachment-metadata.js';
import { rowsFrom } from './source-adapter.js';

const require = createRequire(import.meta.url);
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

export type PinpinBlobConnection = Pick<NativeConnection, 'promises'>;

export type PinpinBlobReadRequest = {
  atsCandidateId: string | number;
  attachmentId: string | number;
};

export type PinpinBlobAttachment = {
  atsCandidateId: string;
  attachmentId: string;
  fileRef: string;
  filename: string | null;
  extension: string | null;
  mimeType: string;
  classification: PinpinAttachmentClassification;
  declaredSizeBytes: number | null;
  actualSizeBytes: number;
  declaredSizeMatches: boolean | null;
  sourceCreatedAt: string | null;
  sha256: string;
  content: Buffer;
};

export class PinpinBlobReadError extends Error {
  constructor(readonly code: 'BLOB_INVALID_REQUEST' | 'BLOB_NOT_FOUND' | 'BLOB_OWNERSHIP_MISMATCH' | 'BLOB_NULL' | 'BLOB_UNSUPPORTED' | 'BLOB_TOO_LARGE' | 'BLOB_PERMISSION_DENIED' | 'BLOB_READ_FAILED') {
    super(code);
  }
}

type Row = Record<string, unknown>;

function field(row: Row, name: string): unknown {
  return row[name] ?? row[name.toLowerCase()] ?? row[name.toUpperCase()];
}

function numeric(value: unknown): number | null {
  const result = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(result) && result >= 1 ? result : null;
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const result = String(value).trim();
  return result || null;
}

function iso(value: unknown): string | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asBuffer(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) return Buffer.from(value);
  return null;
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

function localBlobConnectionString(environment: NodeJS.ProcessEnv): string {
  const raw = environment.PINPIN_SQL_BLOB_CONNECTION_STRING;
  if (!raw) throw new PinpinBlobReadError('BLOB_READ_FAILED');
  const username = setting(raw, ['user id', 'uid', 'user']);
  const password = setting(raw, ['password', 'pwd']);
  const database = setting(raw, ['database', 'initial catalog']) || 'HiBole-2';
  if (!username || !password || database !== 'HiBole-2') throw new PinpinBlobReadError('BLOB_READ_FAILED');
  return `Driver={SQL Server Native Client 10.0};Server=lpc:${os.hostname()};Database=${database};Uid=${username};Pwd=${password};`;
}

function mime(extension: string | null): string {
  switch (extension) {
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'doc': return 'application/msword';
    case 'pdf': return 'application/pdf';
    case 'html':
    case 'htm': return 'text/html';
    default: return 'application/octet-stream';
  }
}

export class PinpinBlobAttachmentReader {
  constructor(private readonly connection: PinpinBlobConnection, private readonly maxBytes = DEFAULT_MAX_BYTES) {
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 100 * 1024 * 1024) throw new Error('Invalid Pinpin BLOB size limit.');
  }

  static async connect(environment: NodeJS.ProcessEnv = process.env): Promise<PinpinBlobAttachmentReader> {
    const sql = require('msnodesqlv8') as { promises: { open(connectionString: string): Promise<NativeConnection> } };
    const configured = Number(environment.PINPIN_BLOB_MAX_BYTES ?? DEFAULT_MAX_BYTES);
    return new PinpinBlobAttachmentReader(await sql.promises.open(localBlobConnectionString(environment)), configured);
  }

  async close(): Promise<void> { await this.connection.promises.close(); }

  async readAttachmentContent(request: PinpinBlobReadRequest): Promise<PinpinBlobAttachment> {
    const candidate = String(request.atsCandidateId ?? '').trim();
    const attachment = String(request.attachmentId ?? '').trim();
    if (!/^\d{1,18}$/.test(candidate) || !/^\d{1,18}$/.test(attachment)) throw new PinpinBlobReadError('BLOB_INVALID_REQUEST');
    const rows = rowsFrom(await this.connection.promises.query(`
      SELECT [ID], [ZPResumeInfo_ID], [FileName], [FileType], [Filesize], [CreDate], [Annex]
      FROM dbo.ZPResumeInfo_Annex_Other
      WHERE [ID] = ? AND [ZPResumeInfo_ID] = ?`, [Number(attachment), Number(candidate)]));
    if (rows.length === 0) throw new PinpinBlobReadError('BLOB_NOT_FOUND');
    if (rows.length !== 1) throw new PinpinBlobReadError('BLOB_READ_FAILED');
    const row = rows[0]!;
    if (numeric(field(row, 'ID')) !== Number(attachment) || numeric(field(row, 'ZPResumeInfo_ID')) !== Number(candidate)) throw new PinpinBlobReadError('BLOB_OWNERSHIP_MISMATCH');
    const filename = text(field(row, 'FileName'));
    const classification = classifyPinpinAttachment(filename);
    if (classification.documentType !== 'resume' || !classification.extension || !['docx', 'doc', 'pdf', 'html', 'htm'].includes(classification.extension)) throw new PinpinBlobReadError('BLOB_UNSUPPORTED');
    const declaredSize = field(row, 'Filesize') == null ? null : Number(field(row, 'Filesize'));
    if (declaredSize != null && (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > this.maxBytes)) throw new PinpinBlobReadError('BLOB_TOO_LARGE');
    const content = asBuffer(field(row, 'Annex'));
    if (!content) throw new PinpinBlobReadError('BLOB_NULL');
    if (content.length > this.maxBytes) throw new PinpinBlobReadError('BLOB_TOO_LARGE');
    return {
      atsCandidateId: candidate,
      attachmentId: attachment,
      fileRef: derivePinpinFileRef(attachment),
      filename,
      extension: classification.extension,
      mimeType: mime(classification.extension),
      classification,
      declaredSizeBytes: declaredSize,
      actualSizeBytes: content.length,
      declaredSizeMatches: declaredSize == null ? null : declaredSize === content.length,
      sourceCreatedAt: iso(field(row, 'CreDate')),
      sha256: createHash('sha256').update(content).digest('hex'),
      content
    };
  }
}

