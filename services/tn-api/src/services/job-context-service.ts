import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import type { DatabasePool } from '../db/pool.js';
import type { AiProvider } from '../ai/types.js';

export type JobContextInput = {
  sourceSystem: 'pinpin';
  sourceInstance: 'pinpin-prod';
  externalJobId: string;
  sourceUrl?: string | null;
  title?: string | null;
  client?: string | null;
  description?: string | null;
  requirements?: string | null;
  location?: string | null;
  salary?: string | null;
  supplemental?: string | null;
};

export type JobContextService = {
  upsert(input: JobContextInput): Promise<Record<string, unknown>>;
  get(externalJobId: string): Promise<Record<string, unknown> | null>;
  searchQuery(externalJobId: string): Promise<string | null>;
};

const text = (value: unknown, limit = 12000): string | null => {
  const result = String(value ?? '').trim();
  return result ? result.slice(0, limit) : null;
};

function fingerprint(input: JobContextInput): string {
  return createHash('sha256').update(JSON.stringify({
    title: text(input.title), client: text(input.client), description: text(input.description, 30000),
    requirements: text(input.requirements, 30000), location: text(input.location), salary: text(input.salary),
    supplemental: text(input.supplemental, 12000)
  })).digest('hex');
}

const intelligenceSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    roleFamily: { type: 'string' }, seniority: { type: 'string' },
    mustHave: { type: 'array', items: { type: 'string' } },
    niceToHave: { type: 'array', items: { type: 'string' } },
    searchTerms: { type: 'array', items: { type: 'string' } }
  }, required: ['roleFamily', 'seniority', 'mustHave', 'niceToHave', 'searchTerms']
};

function cleanSearchTerm(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/[<>]/g, '').replace(/[。．.、,，;；:：]+$/g, '').trim()
    : '';
}

function usableSearchTerm(value: unknown): value is string {
  const term = cleanSearchTerm(value);
  if (!term) return false;
  if (!term || /^\d+[.)、．:\：-]?$/.test(term)) return false;
  if (/^(?:null|undefined|n\/a|na|待確認|未提供|工作內容|職缺內容|職務類別|產業類別|公司規模|管理責任|年資|經驗|以上|人以上|導入|獎金|年終獎金|福利|勞保|健保|三節|退休金|待遇面議)$/i.test(term)) return false;
  if (/(?:直接管理人數|公司規模|管理責任|職務類別|產業類別)/i.test(term)) return false;
  return term.length >= 2;
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => cleanSearchTerm(item).replace(/^(?:[-•*]\s*|\d+[.)、．:\：-]\s*)/, ''))
      .filter(usableSearchTerm))].slice(0, 30)
    : [];
}

export class PostgresJobContextService implements JobContextService {
  public constructor(private readonly db: DatabasePool, private readonly ai?: AiProvider) {}

  public async upsert(input: JobContextInput): Promise<Record<string, unknown>> {
    const externalJobId = String(input.externalJobId).trim();
    const contentFingerprint = fingerprint(input);
    const values = [
      input.sourceSystem, input.sourceInstance, externalJobId, text(input.title), text(input.client),
      text(input.description, 30000), text(input.requirements, 30000), text(input.location), text(input.salary),
      text(input.sourceUrl, 2000), { supplemental: text(input.supplemental, 12000) }, contentFingerprint
    ];
    const existing = await this.db.query<Record<string, unknown>>(
      'SELECT id,content_fingerprint FROM jobs WHERE source_system=$1 AND source_instance_key=$2 AND external_job_id=$3',
      values.slice(0, 3)
    );
    const jobId = existing.rows[0]?.id ? String(existing.rows[0].id) : uuidv7();
    const result = await this.db.query<Record<string, unknown>>(`
      INSERT INTO jobs (id,source_system,source_instance_key,external_job_id,title,client_name,description,requirements,location_text,salary_text,source_url,context,content_fingerprint)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (source_system,source_instance_key,external_job_id) DO UPDATE SET
        title=EXCLUDED.title, client_name=EXCLUDED.client_name, description=EXCLUDED.description,
        requirements=EXCLUDED.requirements, location_text=EXCLUDED.location_text, salary_text=EXCLUDED.salary_text,
        source_url=EXCLUDED.source_url, context=EXCLUDED.context, content_fingerprint=EXCLUDED.content_fingerprint,
        last_seen_at=now(), updated_at=now()
      RETURNING id,external_job_id,title,client_name,description,requirements,location_text,salary_text,source_url,content_fingerprint,status,created_at,updated_at
    `, [jobId, ...values]);
    const job = result.rows[0]!;
    if (this.ai && existing.rows[0]?.content_fingerprint !== contentFingerprint) {
      try {
        const generated = await this.ai.generateStructured({
          prompt: `將以下已驗證職缺資料整理成搜尋用結構。不得補造未提供的要求。\n職稱：${text(input.title) ?? ''}\n職缺內容：${text(input.description, 30000) ?? ''}\n要求：${text(input.requirements, 30000) ?? ''}\n補充：${text(input.supplemental, 12000) ?? ''}`,
          schema: intelligenceSchema
        });
        const row = generated.json && typeof generated.json === 'object' ? generated.json as Record<string, unknown> : {};
        await this.db.query(
          'INSERT INTO job_intelligence (id,job_id,content_fingerprint,role_family,seniority,must_have,nice_to_have,search_terms,model_tier) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (job_id,content_fingerprint) DO NOTHING',
          [uuidv7(), job.id, contentFingerprint, text(row.roleFamily), text(row.seniority), list(row.mustHave), list(row.niceToHave), list(row.searchTerms), 'default']
        );
      } catch {
        // Structured enrichment is optional; verified raw Job context remains available.
      }
    }
    return job;
  }

  public async get(externalJobId: string): Promise<Record<string, unknown> | null> {
    const result = await this.db.query<Record<string, unknown>>(`
      SELECT j.id,j.external_job_id AS "externalJobId",j.title,j.client_name AS client,j.description,j.requirements,
        j.location_text AS location,j.salary_text AS salary,j.source_url AS "sourceUrl",
        j.content_fingerprint AS fingerprint,j.status,j.updated_at AS "updatedAt",
        ji.role_family AS "roleFamily",ji.seniority,ji.must_have AS "mustHave",ji.nice_to_have AS "niceToHave",ji.search_terms AS "searchTerms"
      FROM jobs j LEFT JOIN LATERAL (SELECT * FROM job_intelligence WHERE job_id=j.id ORDER BY created_at DESC LIMIT 1) ji ON true
      WHERE j.source_system='pinpin' AND j.source_instance_key='pinpin-prod' AND j.external_job_id=$1 LIMIT 2
    `, [externalJobId]);
    return result.rows.length === 1 ? result.rows[0]! : null;
  }

  public async searchQuery(externalJobId: string): Promise<string | null> {
    const row = await this.get(externalJobId);
    if (!row) return null;
    // Prefer compact, structured Job Intelligence terms. Passing the entire
    // numbered JD into the natural-language parser caused bullet markers
    // such as "1." / "2." to become fake search keywords. Raw JD remains
    // available through GET /jobs/:id and is only used when enrichment is
    // unavailable.
    const structured = [row.title, row.roleFamily, row.location,
      ...(Array.isArray(row.mustHave) ? row.mustHave : []), ...(Array.isArray(row.niceToHave) ? row.niceToHave : []),
      ...(Array.isArray(row.searchTerms) ? row.searchTerms : [])]
      .map(cleanSearchTerm)
      .filter(usableSearchTerm);
    const terms = structured.length >= 2
      ? structured
      : [row.title, row.description, row.requirements, row.location].map(cleanSearchTerm).filter(usableSearchTerm);
    const query = [...new Set(terms.map((value) => value.trim()).filter(Boolean))].join('\n').trim();
    return query ? query.slice(0, 4000) : null;
  }
}
