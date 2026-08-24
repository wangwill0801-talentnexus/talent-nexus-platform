import assert from 'node:assert/strict';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataType, newDb } from 'pg-mem';
import { v7 as uuidv7 } from 'uuid';
import { runMigrations } from '../src/db/migrations.js';
import type { DatabaseClient, DatabasePool } from '../src/db/pool.js';
import { CandidateEnrichmentService } from '../src/services/candidate-enrichment-service.js';
import { CandidateProcessingService, type ProcessingJob, type ProcessingJobExecutor } from '../src/services/candidate-processing-service.js';
import { HistoricalBackfillService } from '../src/services/historical-backfill-service.js';

async function database():Promise<DatabasePool>{
  const memory=newDb({autoCreateForeignKeyIndices:true});
  memory.public.registerOperator({operator:'~',left:DataType.text,right:DataType.text,returns:DataType.bool,implementation:(value:string,pattern:string)=>new RegExp(pattern).test(value)});
  memory.public.registerFunction({name:'trim',args:[DataType.text],returns:DataType.text,implementation:(value:string)=>value.trim()});
  memory.public.registerFunction({name:'length',args:[DataType.text],returns:DataType.integer,implementation:(value:string)=>value.length});
  memory.public.registerFunction({name:'lpad',args:[DataType.text,DataType.integer,DataType.text],returns:DataType.text,implementation:(value:string,size:number,fill:string)=>`${fill.repeat(Math.max(0,size-value.length))}${value}`.slice(-size)});
  const pool=new (memory.adapters.createPg().Pool)();
  await runMigrations(pool as never,join(dirname(fileURLToPath(import.meta.url)),'..','migrations'));
  return {
    query:(text:string,params?:unknown[])=>pool.query(text.replace(' SKIP LOCKED',''),params),
    connect:async()=>{const client=await pool.connect();return {query:(text:string,params?:unknown[])=>client.query(text.replace(' SKIP LOCKED',''),params),release:()=>client.release()} as DatabaseClient;},
    end:()=>pool.end()
  } as unknown as DatabasePool;
}
async function seed(pool:DatabasePool){
  const candidateId=uuidv7(),sourceId=uuidv7();
  await pool.query("INSERT INTO source_instances (id,source_system,instance_key,display_name) VALUES ($1,'pinpin','pinpin-prod','Controlled')",[sourceId]);
  await pool.query("INSERT INTO candidates (id,candidate_code,display_name) VALUES ($1,'TN00000999','Controlled Processing')",[candidateId]);
  await pool.query("INSERT INTO candidate_external_refs (id,candidate_id,source_instance_id,external_candidate_id) VALUES ($1,$2,$3,'43999')",[uuidv7(),candidateId,sourceId]);
  await new CandidateEnrichmentService(pool).storeCandidateEnrichment({candidateId,source:{kind:'pdf',system:'controlled',reference:'fixture',contentSha256:'a'.repeat(64)},pluginVersion:'test',parserVersion:'parser-v1',aiMetadata:{provider:'gemini',model:'model-v1'},payload:{schemaVersion:'standard_resume_v1',summary:'Controlled',experience:[{company:'A'}],education:[{school:'B'}],skills:['C']}});
  return candidateId;
}

test('same processing identity enqueues once and projection rebuild is snapshot-preserving',async()=>{
  const pool=await database(),candidateId=await seed(pool),service=new CandidateProcessingService(pool);
  const first=await service.enqueueByIdentifier('43999','rebuild_projection');
  const replay=await service.enqueueByIdentifier('43999','rebuild_projection');
  assert.equal(first.status,'created');assert.equal(replay.status,'unchanged');assert.equal(first.job.id,replay.job.id);
  const before=(await pool.query<{id:string}>('SELECT id FROM candidate_enrichment_snapshots WHERE candidate_id=$1',[candidateId])).rows[0]!.id;
  const processed=await service.runOne();
  assert.equal(processed?.status,'completed');assert.equal(processed?.outputSnapshotId,before);
  assert.equal((await pool.query<{count:string}>('SELECT count(*)::text count FROM candidate_enrichment_snapshots WHERE candidate_id=$1',[candidateId])).rows[0]?.count,'1');
  assert.equal((await pool.query<{count:string}>('SELECT count(*)::text count FROM candidate_ai_profiles WHERE candidate_id=$1',[candidateId])).rows[0]?.count,'1');
  assert.equal(await service.runOne(),null);
  await pool.end();
});

test('process_new_evidence resolves the matching available extraction before enqueue',async()=>{
  const pool=await database(),candidateId=await seed(pool);
  const evidence=(await pool.query<{id:string}>('SELECT id FROM candidate_resume_evidence WHERE candidate_id=$1',[candidateId])).rows[0]!.id;
  await pool.query("UPDATE candidate_resume_evidence SET processing_eligible=true,representation_kind='connector_text' WHERE id=$1",[evidence]);
  await pool.query("INSERT INTO candidate_evidence_extractions (id,evidence_id,candidate_id,extractor_version,content_sha256,representation_kind,character_count,status,normalization_version) VALUES ($1,$2,$3,'parser-v1',$4,'connector_text',42,'available','tn-text-nfkc-v1')",[uuidv7(),evidence,candidateId,'a'.repeat(64)]);
  const queued=await new CandidateProcessingService(pool).enqueueByIdentifier('43999','process_new_evidence');
  assert.equal(queued.status,'created');assert.equal(queued.job.operation,'process_new_evidence');assert.ok(queued.job.extractionId);
  await pool.end();
});

test('process_new_evidence skips a newer snapshot without usable evidence',async()=>{
  const pool=await database(),candidateId=await seed(pool);
  const evidence=(await pool.query<{id:string}>('SELECT id FROM candidate_resume_evidence WHERE candidate_id=$1',[candidateId])).rows[0]!.id;
  await pool.query("UPDATE candidate_resume_evidence SET processing_eligible=true,representation_kind='connector_text' WHERE id=$1",[evidence]);
  await pool.query("INSERT INTO candidate_evidence_extractions (id,evidence_id,candidate_id,extractor_version,content_sha256,representation_kind,character_count,status,normalization_version) VALUES ($1,$2,$3,'parser-v1',$4,'connector_text',42,'available','tn-text-nfkc-v1')",[uuidv7(),evidence,candidateId,'a'.repeat(64)]);
  await pool.query("INSERT INTO candidate_enrichment_snapshots (id,candidate_id,schema_version,source_kind,payload,payload_fingerprint,idempotency_key,created_at) VALUES ($1,$2,'standard_resume_v1','manual','{}',$3,$4,now()+interval '1 second')",[uuidv7(),candidateId,'b'.repeat(64),'c'.repeat(64)]);
  const queued=await new CandidateProcessingService(pool).enqueueByIdentifier('43999','process_new_evidence');
  assert.ok(queued.job.extractionId);assert.equal(queued.job.evidenceId,evidence);
  await pool.end();
});

test('bounded retry becomes dead letter and records only safe error metadata',async()=>{
  const pool=await database(),candidateId=await seed(pool);
  await pool.query("UPDATE candidate_resume_evidence SET processing_eligible=true,representation_kind='connector_text' WHERE candidate_id=$1",[candidateId]);
  const retryExecutor:ProcessingJobExecutor={execute:async(_job:ProcessingJob,_client:DatabaseClient)=>({status:'retry',errorCode:'PROVIDER_TEMPORARY',errorSummary:'sanitized transient'})};
  const service=new CandidateProcessingService(pool,retryExecutor);
  await service.enqueue({candidateId,evidenceId:(await pool.query<{id:string}>('SELECT id FROM candidate_resume_evidence WHERE candidate_id=$1',[candidateId])).rows[0]!.id,operation:'process_new_evidence',evidenceFingerprint:'a'.repeat(64),extractorVersion:'extractor-v1',parserVersion:'parser-v2',schemaVersion:'standard_resume_v1',aiProvider:'gemini',aiModel:'model-v2',maxAttempts:1});
  const result=await service.runOne();
  assert.equal(result?.status,'dead_letter');assert.equal(result?.lastErrorCode,'PROVIDER_TEMPORARY');
  const state=await pool.query<{status:string;last_error_code:string}>('SELECT status,last_error_code FROM candidate_processing_state WHERE candidate_id=$1',[candidateId]);
  assert.equal(state.rows[0]?.status,'dead_letter');assert.equal(state.rows[0]?.last_error_code,'PROVIDER_TEMPORARY');
  const retried=await service.retryJob(result!.id);assert.equal(retried?.status,'queued');assert.equal(retried?.attemptCount,0);assert.equal(retried?.lastErrorCode,null);
  await pool.end();
});

test('retry repairs a legacy process_new_evidence job missing extraction identity',async()=>{
  const pool=await database(),candidateId=await seed(pool);
  const evidence=(await pool.query<{id:string}>('SELECT id FROM candidate_resume_evidence WHERE candidate_id=$1',[candidateId])).rows[0]!.id;
  await pool.query("UPDATE candidate_resume_evidence SET processing_eligible=true,representation_kind='connector_text' WHERE id=$1",[evidence]);
  await pool.query("INSERT INTO candidate_evidence_extractions (id,evidence_id,candidate_id,extractor_version,content_sha256,representation_kind,character_count,status,normalization_version) VALUES ($1,$2,$3,'parser-v1',$4,'connector_text',42,'available','tn-text-nfkc-v1')",[uuidv7(),evidence,candidateId,'a'.repeat(64)]);
  const executor:ProcessingJobExecutor={execute:async(current:ProcessingJob)=>current.extractionId?{status:'completed'}:{status:'needs_review',errorCode:'EVIDENCE_NOT_ELIGIBLE'}};
  const service=new CandidateProcessingService(pool,executor);
  const queued=await service.enqueue({candidateId,evidenceId:evidence,operation:'process_new_evidence',evidenceFingerprint:'a'.repeat(64),extractorVersion:'parser-v1',parserVersion:'parser-v1',schemaVersion:'standard_resume_v1',aiProvider:'gemini',maxAttempts:1});
  const failed=await service.runOne();assert.equal(failed?.status,'needs_review');assert.equal(failed?.extractionId,null);
  const retried=await service.retryJob(queued.job.id);assert.equal(retried?.status,'queued');assert.ok(retried?.extractionId);
  const processed=await service.runOne();assert.equal(processed?.status,'completed');
  await pool.end();
});

test('claim SQL carries the PostgreSQL concurrent-worker lock contract',async()=>{
  const source=await import('node:fs/promises').then(fs=>fs.readFile(join(dirname(fileURLToPath(import.meta.url)),'..','src','services','candidate-processing-service.ts'),'utf8'));
  assert.match(source,/FOR UPDATE SKIP LOCKED/);
});

test('unsupported or unverifiable evidence fails closed for operator reprocess',async()=>{
  const pool=await database();await seed(pool);const service=new CandidateProcessingService(pool);
  await assert.rejects(service.enqueueByIdentifier('43999','reprocess_profile'),(error:unknown)=>error instanceof Error&&error.message==='EVIDENCE_NOT_ELIGIBLE');
  await pool.end();
});

test('historical backfill remains a read-only eligibility report',async()=>{
  const pool=await database();await seed(pool);
  const before=Number((await pool.query<{count:string}>('SELECT count(*)::text count FROM candidate_processing_jobs')).rows[0]?.count);
  const report=await new HistoricalBackfillService(pool).dryRun();
  const after=Number((await pool.query<{count:string}>('SELECT count(*)::text count FROM candidate_processing_jobs')).rows[0]?.count);
  assert.equal(report.observed,1);assert.equal(report.eligible,0);assert.equal(report.items[0]?.reason,'already_current');assert.equal(after,before);
  await pool.end();
});
