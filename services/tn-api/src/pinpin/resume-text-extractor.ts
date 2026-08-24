import { inflateRawSync } from 'node:zlib';
import { normalizeEvidenceText } from '../domain/evidence-intake.js';

const MAX_TEXT = 500_000;
const MAX_XML_ENTRY = 10 * 1024 * 1024;

export class ResumeTextExtractionError extends Error {
  constructor(readonly code: 'UNSUPPORTED_FILE' | 'INVALID_DOCX' | 'EMPTY_TEXT' | 'TEXT_TOO_LARGE') { super(code); }
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === 'apos') return "'";
    const number = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
    return Number.isFinite(number) ? String.fromCodePoint(Math.min(0x10ffff, Math.max(0, number))) : whole;
  });
}

function xmlText(xml: string): string {
  return decodeEntities(xml
    .replace(/<w:(?:tab|br)\b[^>]*\/?>/gi, '\t')
    .replace(/<w:p\b[^>]*>/gi, '\n')
    .replace(/<\/w:p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ''));
}

function centralDirectory(buffer: Buffer): Array<{ name: string; method: number; compressedSize: number; uncompressedSize: number; localOffset: number }> {
  const start = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new ResumeTextExtractionError('INVALID_DOCX');
  const entries = buffer.readUInt16LE(eocd + 10);
  const size = buffer.readUInt32LE(eocd + 12);
  const offset = buffer.readUInt32LE(eocd + 16);
  if (entries > 1024 || size > buffer.length || offset + size > buffer.length) throw new ResumeTextExtractionError('INVALID_DOCX');
  const result: Array<{ name: string; method: number; compressedSize: number; uncompressedSize: number; localOffset: number }> = [];
  let cursor = offset;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new ResumeTextExtractionError('INVALID_DOCX');
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    result.push({ name, method, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

function unzipEntry(buffer: Buffer, entry: { method: number; compressedSize: number; uncompressedSize: number; localOffset: number }): Buffer {
  if (entry.uncompressedSize > MAX_XML_ENTRY || entry.compressedSize > buffer.length) throw new ResumeTextExtractionError('TEXT_TOO_LARGE');
  const offset = entry.localOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) throw new ResumeTextExtractionError('INVALID_DOCX');
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buffer.length) throw new ResumeTextExtractionError('INVALID_DOCX');
  const compressed = buffer.subarray(start, end);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) {
    try {
      const inflated = inflateRawSync(compressed, { maxOutputLength: MAX_XML_ENTRY });
      if (inflated.length > MAX_XML_ENTRY) throw new ResumeTextExtractionError('TEXT_TOO_LARGE');
      return inflated;
    } catch (error) {
      if (error instanceof ResumeTextExtractionError) throw error;
      throw new ResumeTextExtractionError('INVALID_DOCX');
    }
  }
  throw new ResumeTextExtractionError('INVALID_DOCX');
}

function htmlText(content: Buffer): string {
  const value = content.toString('utf8').replace(/^\uFEFF/, '');
  return decodeEntities(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));
}

export function extractResumeText(content: Buffer, extension: string | null): { text: string; representationKind: 'local_file_text'; extractorVersion: string } {
  const normalizedExtension = extension?.toLowerCase() ?? '';
  let extracted: string;
  let extractorVersion: string;
  if (normalizedExtension === 'docx') {
    const entries = centralDirectory(content).filter((entry) => entry.name === 'word/document.xml' || /^word\/(?:header|footer)\d+\.xml$/i.test(entry.name));
    if (!entries.length) throw new ResumeTextExtractionError('INVALID_DOCX');
    extracted = entries.map((entry) => xmlText(unzipEntry(content, entry).toString('utf8'))).join('\n');
    extractorVersion = 'tn-pinpin-docx-text-v1';
  } else if (normalizedExtension === 'html' || normalizedExtension === 'htm') {
    extracted = htmlText(content);
    extractorVersion = 'tn-pinpin-html-text-v1';
  } else {
    throw new ResumeTextExtractionError('UNSUPPORTED_FILE');
  }
  const text = normalizeEvidenceText(extracted);
  if (!text) throw new ResumeTextExtractionError('EMPTY_TEXT');
  if (text.length > MAX_TEXT) throw new ResumeTextExtractionError('TEXT_TOO_LARGE');
  return { text, representationKind: 'local_file_text', extractorVersion };
}

