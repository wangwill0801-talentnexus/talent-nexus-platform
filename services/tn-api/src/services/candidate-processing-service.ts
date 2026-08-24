import { v7 as uuidv7 } from 'uuid';
import type { DatabaseClient, DatabasePool } from '../db/pool.js';
import { processingIdempotencyKey, type EnqueueProcessingJob, type ProcessingJobStatus, type ProcessingOperation } from '../domain/candidate-processing.js';

type JobRow = Record<string, unknown>;
export type ProcessingJob = {
  id: string; candidateId: string; evidenceId: string | null; extractionId: string | null;
  operation: ProcessingOperation; status: ProcessingJobStatus; attemptCount: number; maxAttempts: number;
  parserVersion: string; schemaVersion: string; evidenceFingerprint: string | null;
  aiProvider: string | null; aiModel: string | null; outputSnapshotId: string | null;
  lastErrorCode: string | null; createdAt: string;
};
export type ProcessingOutcome = { status: 'completed'; snapshotId?: string | null } | { status: 'retry'; errorCode: string; errorSummary?: string } | { status: 'needs_review'; errorCode: string; errorSummary?: string } | { status: 'failed'; errorCode: string; errorSummary?: string };
export interface ProcessingJobExecutor { execute(job: ProcessingJob, client: DatabaseClient): Promise<ProcessingOutcome>; }
export class CandidateProcessingError extends Error { constructor(readonly code:'CANDIDATE_NOT_FOUND'|'IDENTITY_AMBIGUOUS'|'EVIDENCE_NOT_ELIGIBLE'){super(code);} }

const projection = 'id,candidate_id,evidence_id,extraction_id,operation,status,attempt_count,max_attempts,parser_version,schema_version,evidence_fingerprint,ai_provider,ai_model,output_snapshot_id,last_error_code,created_at';
function job(row: JobRow): ProcessingJob { return { id:String(row.id),candidateId:String(row.candidate_id),evidenceId:row.evidence_id as string|null,extractionId:row.extraction_id as string|null,operation:row.operation as ProcessingOperation,status:row.status as ProcessingJobStatus,attemptCount:Number(row.attempt_count),maxAttempts:Number(row.max_attempts),parserVersion:String(row.parser_version),schemaVersion:String(row.schema_version),evidenceFingerprint:row.evidence_fingerprint as string|null,aiProvider:row.ai_provider as string|null,aiModel:row.ai_model as string|null,outputSnapshotId:row.output_snapshot_id as string|null,lastErrorCode:row.last_error_code as string|null,createdAt:new Date(String(row.created_at)).toISOString() }; }
function safeCode(value: string): string { return /^[A-Z0-9_]{1,64}$/.test(value) ? value : 'PROCESSING_ERROR'; }
function safeSummary(value?: string): string | null { if (!value) return null; return value.replace(/[\r\n\t]+/g,' ').slice(0,240); }

export async function persistSnapshotProjection(client: DatabaseClient, candidateId: string, snapshotId: string): Promise<void> {
    await client.query('DELETE FROM candidate_ai_terms WHERE enrichment_snapshot_id=$1',[snapshotId]);
    await client.query('DELETE FROM candidate_ai_work_experiences WHERE enrichment_snapshot_id=$1',[snapshotId]);
    await client.query('DELETE FROM candidate_ai_educations WHERE enrichment_snapshot_id=$1',[snapshotId]);
    await client.query('DELETE FROM candidate_ai_profiles WHERE enrichment_snapshot_id=$1',[snapshotId]);
    await client.query(`INSERT INTO candidate_ai_profiles (id,candidate_id,enrichment_snapshot_id,professional_summary,recruiter_summary,job_preferences) SELECT $1,$2,s.id,s.payload->>'summary',s.payload->>'recruiterSummary',s.payload->>'jobPreferences' FROM candidate_enrichment_snapshots s WHERE s.id=$3`,[uuidv7(),candidateId,snapshotId]);
    const payload = await client.query<{ payload: Record<string,unknown> }>('SELECT payload FROM candidate_enrichment_snapshots WHERE id=$1',[snapshotId]);
    const data=payload.rows[0]?.payload ?? {};
    for(const [index,item] of (Array.isArray(data.experience)?data.experience:[]).entries()){ const w=item as Record<string,unknown>; await client.query(`INSERT INTO candidate_ai_work_experiences (id,candidate_id,enrichment_snapshot_id,display_order,company_name,job_title,department,location_text,start_date_raw,end_date_raw,is_current,description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[uuidv7(),candidateId,snapshotId,index,w.company??null,w.title??null,w.department??null,w.location??null,w.startDate??null,w.endDate??null,w.isCurrent??null,w.description??null]); }
    for(const [index,item] of (Array.isArray(data.education)?data.education:[]).entries()){ const e=item as Record<string,unknown>; await client.query(`INSERT INTO candidate_ai_educations (id,candidate_id,enrichment_snapshot_id,display_order,school_name,degree_raw,major_raw,start_date_raw,end_date_raw) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[uuidv7(),candidateId,snapshotId,index,e.school??null,e.degree??null,e.major??null,e.startDate??null,e.endDate??null]); }
    const groups: Array<[string,unknown]>=[['skill',data.skills],['language',[...(Array.isArray(data.languages)?data.languages:[]),...(Array.isArray(data.languageDetails)?data.languageDetails:[])]],['certification',data.certifications],['project',data.projectExperience],['target_role',data.targetRoles],['search_keyword',data.coreKeywords]];
    for(const [type,values] of groups){ for(const [index,value] of (Array.isArray(values)?values:[]).entries()){ if(typeof value==='string'&&value.trim()) await client.query('INSERT INTO candidate_ai_terms (id,candidate_id,enrichment_snapshot_id,term_type,display_order,value) VALUES ($1,$2,$3,$4,$5,$6)',[uuidv7(),candidateId,snapshotId,type,index,value]); } }
}

export class ProjectionRebuildExecutor implements ProcessingJobExecutor {
  async execute(current: ProcessingJob, client: DatabaseClient): Promise<ProcessingOutcome> {
    if (current.operation !== 'rebuild_projection') return { status:'needs_review', errorCode:'PROCESSOR_NOT_CONFIGURED', errorSummary:'No approved evidence processor is configured for this operation.' };
    const snapshot = await client.query<{ id:string }>('SELECT id FROM candidate_enrichment_snapshots WHERE candidate_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[current.candidateId]);
    if (!snapshot.rows[0]) return { status:'needs_review', errorCode:'SNAPSHOT_NOT_FOUND' };
    const snapshotId=snapshot.rows[0].id;
    await persistSnapshotProjection(client,current.candidateId,snapshotId);
    return { status:'completed', snapshotId };
  }
}

export class CandidateProcessingService {
  constructor(private readonly database: DatabasePool, private readonly executor: ProcessingJobExecutor = new ProjectionRebuildExecutor()) {}

  async enqueue(input: EnqueueProcessingJob): Promise<{ status:'created'|'unchanged'; job:ProcessingJob }> {
    const key=processingIdempotencyKey(input), id=uuidv7(),client=await this.database.connect();
    try{
      await client.query('BEGIN');
      const prior=await client.query<JobRow>(`SELECT ${projection} FROM candidate_processing_jobs WHERE candidate_id=$1 AND idempotency_key=$2`,[input.candidateId,key]);
      if(prior.rows[0]){await client.query('COMMIT');return {status:'unchanged',job:job(prior.rows[0])};}
      const result=await client.query<JobRow>(`INSERT INTO candidate_processing_jobs (id,candidate_id,evidence_id,extraction_id,operation,status,max_attempts,evidence_fingerprint,extractor_version,parser_version,schema_version,ai_provider,ai_model,idempotency_key,requested_by) VALUES ($1,$2,$3,$4,$5,'queued',$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (candidate_id,idempotency_key) DO NOTHING RETURNING ${projection}`,[id,input.candidateId,input.evidenceId??null,input.extractionId??null,input.operation,input.maxAttempts??3,input.evidenceFingerprint??null,input.extractorVersion??null,input.parserVersion,input.schemaVersion,input.aiProvider??null,input.aiModel??null,key,input.requestedBy??'system']);
      const selected=result.rows[0] ? result.rows[0] : (await client.query<JobRow>(`SELECT ${projection} FROM candidate_processing_jobs WHERE candidate_id=$1 AND idempotency_key=$2`,[input.candidateId,key])).rows[0]!;
      if(result.rows[0]) await client.query(`INSERT INTO candidate_processing_state (candidate_id,status,schema_version,parser_version,processor_version,updated_at) VALUES ($1,'queued',$2,$3,$3,now()) ON CONFLICT(candidate_id) DO UPDATE SET status=CASE WHEN candidate_processing_state.status='completed' THEN candidate_processing_state.status ELSE 'queued' END,schema_version=$2,parser_version=$3,processor_version=$3,updated_at=now()`,[input.candidateId,input.schemaVersion,input.parserVersion]);
      await client.query('COMMIT'); return {status:result.rows[0]?'created':'unchanged',job:job(selected)};
    }catch(error){try{await client.query('ROLLBACK');}catch{} throw error;}finally{client.release();}
  }

  async enqueueByIdentifier(identifier:string,operation:ProcessingOperation,requestedBy='internal_operator'):Promise<{status:'created'|'unchanged';job:ProcessingJob}>{
    const candidates=await this.database.query<{id:string}>(`SELECT DISTINCT c.id FROM candidates c LEFT JOIN candidate_external_refs r ON r.candidate_id=c.id LEFT JOIN source_instances s ON s.id=r.source_instance_id WHERE c.id::text=$1 OR c.candidate_code=$1 OR (r.external_candidate_id=$1 AND s.source_system='pinpin' AND s.instance_key='pinpin-prod') LIMIT 2`,[identifier]);
    if(candidates.rows.length===0) throw new CandidateProcessingError('CANDIDATE_NOT_FOUND');
    if(candidates.rows.length!==1) throw new CandidateProcessingError('IDENTITY_AMBIGUOUS');
    const candidateId=candidates.rows[0]!.id;
    const sourceQuery=operation==='rebuild_projection'
      ? `SELECT s.id snapshot_id,s.schema_version,s.parser_version,s.ai_provider,s.ai_model,e.id evidence_id,e.evidence_fingerprint,e.extractor_version,e.processing_eligible,x.id extraction_id FROM candidate_enrichment_snapshots s LEFT JOIN candidate_resume_evidence e ON e.enrichment_snapshot_id=s.id LEFT JOIN candidate_evidence_extractions x ON x.evidence_id=e.id AND x.candidate_id=e.candidate_id AND x.status='available' AND x.character_count>0 AND lower(x.content_sha256)=lower(e.content_sha256) AND x.extractor_version=e.extractor_version AND x.representation_kind=e.representation_kind WHERE s.candidate_id=$1 ORDER BY s.created_at DESC,s.id DESC LIMIT 2`
      : `SELECT s.id snapshot_id,s.schema_version,s.parser_version,s.ai_provider,s.ai_model,e.id evidence_id,e.evidence_fingerprint,e.extractor_version,e.processing_eligible,x.id extraction_id FROM candidate_enrichment_snapshots s JOIN candidate_resume_evidence e ON e.enrichment_snapshot_id=s.id JOIN candidate_evidence_extractions x ON x.evidence_id=e.id AND x.candidate_id=e.candidate_id AND x.status='available' AND x.character_count>0 AND lower(x.content_sha256)=lower(e.content_sha256) AND x.extractor_version=e.extractor_version AND x.representation_kind=e.representation_kind WHERE s.candidate_id=$1 AND e.evidence_fingerprint IS NOT NULL AND e.processing_eligible=true ORDER BY s.created_at DESC,s.id DESC LIMIT 2`;
    const source=await this.database.query<Record<string,unknown>>(sourceQuery,[candidateId]);
    if(source.rows.length===0) throw new CandidateProcessingError('EVIDENCE_NOT_ELIGIBLE');
    const latest=source.rows[0]!;
    if(operation!=='rebuild_projection' && (!latest.evidence_id || !latest.extraction_id || !latest.evidence_fingerprint || latest.processing_eligible!==true)) throw new CandidateProcessingError('EVIDENCE_NOT_ELIGIBLE');
    return this.enqueue({candidateId,evidenceId:latest.evidence_id as string|null,extractionId:latest.extraction_id as string|null,operation,evidenceFingerprint:latest.evidence_fingerprint as string|null,extractorVersion:latest.extractor_version as string|null,parserVersion:String(latest.parser_version??'legacy_netlify_parser_unknown'),schemaVersion:String(latest.schema_version),aiProvider:latest.ai_provider as string|null,aiModel:latest.ai_model as string|null,requestedBy});
  }

  async runOne(): Promise<ProcessingJob | null> {
    const client=await this.database.connect(); const claim=uuidv7();
    try{
      await client.query('BEGIN');
      const selected=await client.query<JobRow>(`SELECT ${projection} FROM candidate_processing_jobs WHERE status IN ('queued','retry_scheduled') AND available_at<=now() ORDER BY available_at,created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`);
      if(!selected.rows[0]){await client.query('COMMIT');return null;}
      const current=job(selected.rows[0]);
      const claimed=await client.query<JobRow>(`UPDATE candidate_processing_jobs SET status='processing',attempt_count=attempt_count+1,claim_token=$2,claimed_at=now(),started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1 RETURNING ${projection}`,[current.id,claim]);
      const active=job(claimed.rows[0]!);
      await client.query(`INSERT INTO candidate_processing_state (candidate_id,status,latest_job_id,schema_version,parser_version,processor_version,updated_at) VALUES ($1,'processing',$2,$3,$4,$4,now()) ON CONFLICT(candidate_id) DO UPDATE SET status='processing',latest_job_id=$2,schema_version=$3,parser_version=$4,processor_version=$4,last_error_code=NULL,updated_at=now()`,[active.candidateId,active.id,active.schemaVersion,active.parserVersion]);
      const outcome=await this.executor.execute(active,client);
      const errorCode='errorCode' in outcome?safeCode(outcome.errorCode):null, summary='errorSummary' in outcome?safeSummary(outcome.errorSummary):null;
      let finalStatus:ProcessingJobStatus=outcome.status==='completed'?'completed':outcome.status==='needs_review'?'needs_review':outcome.status==='failed'?'failed':active.attemptCount>=active.maxAttempts?'dead_letter':'retry_scheduled';
      const available=finalStatus==='retry_scheduled'?new Date(Date.now()+Math.min(300_000,30_000*Math.pow(2,Math.max(0,active.attemptCount-1)))).toISOString():null;
      const finished=['completed','failed','needs_review','dead_letter'].includes(finalStatus);
      const updated=await client.query<JobRow>(`UPDATE candidate_processing_jobs SET status=$2,available_at=COALESCE($3::timestamptz,available_at),finished_at=CASE WHEN $4 THEN now() ELSE NULL END,claim_token=NULL,last_error_code=$5,last_error_summary=$6,output_snapshot_id=COALESCE($7,output_snapshot_id),updated_at=now() WHERE id=$1 AND claim_token=$8 RETURNING ${projection}`,[active.id,finalStatus,available,finished,errorCode,summary,'snapshotId' in outcome?outcome.snapshotId??null:null,claim]);
      await client.query(`UPDATE candidate_processing_state SET status=$2,latest_job_id=$3,latest_snapshot_id=COALESCE($4,latest_snapshot_id),last_error_code=$5,stale_reason=CASE WHEN $2='completed' THEN NULL ELSE stale_reason END,ai_last_processed_at=CASE WHEN $2='completed' THEN now() ELSE ai_last_processed_at END,updated_at=now() WHERE candidate_id=$1`,[active.candidateId,finalStatus==='retry_scheduled'?'processing':finalStatus,active.id,'snapshotId' in outcome?outcome.snapshotId??null:null,errorCode]);
      await client.query('COMMIT'); return job(updated.rows[0]!);
    }catch(error){try{await client.query('ROLLBACK');}catch{} throw error;}finally{client.release();}
  }

  async markStale(candidateId:string,reason:string):Promise<void>{ const safe=safeCode(reason); await this.database.query(`UPDATE candidate_processing_state SET status='stale',stale_reason=$2,updated_at=now() WHERE candidate_id=$1`,[candidateId,safe]); }

  async retryJob(jobId:string):Promise<ProcessingJob|null>{
    const client=await this.database.connect();
    try{
      await client.query('BEGIN');
      const prior=await client.query<JobRow>(`SELECT ${projection} FROM candidate_processing_jobs WHERE id=$1 AND status IN ('failed','needs_review','dead_letter') FOR UPDATE`,[jobId]);
      if(!prior.rows[0]){await client.query('ROLLBACK');return null;}
      const previous=job(prior.rows[0]);
      let extractionId=previous.extractionId;
      // Recover jobs created by the pre-fix enqueue path. They may have a
      // valid evidence row but no extraction_id; resolve only the exact
      // matching available extraction and fail closed on ambiguity.
      if(previous.operation==='process_new_evidence'&&!extractionId&&previous.evidenceId&&previous.evidenceFingerprint){
        const matches=await client.query<{id:string}>(`SELECT x.id FROM candidate_evidence_extractions x WHERE x.evidence_id=$1 AND x.candidate_id=$2 AND x.status='available' AND x.character_count>0 AND lower(x.content_sha256)=lower($3) LIMIT 2`,[previous.evidenceId,previous.candidateId,previous.evidenceFingerprint]);
        if(matches.rows.length===1) extractionId=matches.rows[0]!.id;
      }
      const result=await client.query<JobRow>(`UPDATE candidate_processing_jobs SET status='queued',extraction_id=COALESCE($2,extraction_id),attempt_count=0,available_at=now(),claimed_at=NULL,claim_token=NULL,finished_at=NULL,last_error_code=NULL,last_error_summary=NULL,updated_at=now() WHERE id=$1 RETURNING ${projection}`,[jobId,extractionId]);
      const current=job(result.rows[0]!);
      await client.query(`UPDATE candidate_processing_state SET status='queued',latest_job_id=$2,last_error_code=NULL,updated_at=now() WHERE candidate_id=$1`,[current.candidateId,current.id]);
      await client.query('COMMIT');
      return current;
    }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();}
  }

  async recoverStaleClaims(olderThanMinutes=15):Promise<number>{
    const result=await this.database.query<{id:string}>(`UPDATE candidate_processing_jobs SET status=CASE WHEN attempt_count>=max_attempts THEN 'dead_letter' ELSE 'retry_scheduled' END,available_at=now(),claim_token=NULL,last_error_code='WORKER_INTERRUPTED',last_error_summary='Worker claim expired before completion.',updated_at=now() WHERE status='processing' AND claimed_at < now() - ($1::text || ' minutes')::interval RETURNING id`,[Math.max(1,Math.min(1440,olderThanMinutes))]);
    return result.rows.length;
  }
}
