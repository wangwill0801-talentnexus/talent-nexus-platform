import type { DatabasePool } from '../db/pool.js';

export type BackfillReason = 'eligible_projection_rebuild'|'already_current'|'no_snapshot'|'no_evidence'|'ambiguous_evidence'|'soft_deleted';
export type BackfillAssessment = { candidateId:string; atsCandidateId:string|null; eligible:boolean; operation:'rebuild_projection'|null; reason:BackfillReason };

export class HistoricalBackfillService {
  constructor(private readonly database:DatabasePool){}
  async dryRun(limit=500):Promise<{observed:number;eligible:number;items:BackfillAssessment[]}>{
    const result=await this.database.query<Record<string,unknown>>(`SELECT DISTINCT c.id,c.canonical_status,ref.external_candidate_id FROM candidates c LEFT JOIN candidate_external_refs ref ON ref.candidate_id=c.id LEFT JOIN source_instances source ON source.id=ref.source_instance_id WHERE source.id IS NULL OR (source.source_system='pinpin' AND source.instance_key='pinpin-prod') ORDER BY c.id LIMIT $1`,[limit]);
    const items:BackfillAssessment[]=[];
    for(const row of result.rows){
      const count=async(table:string,where='')=>Number((await this.database.query<{count:string}>(`SELECT count(*)::text count FROM ${table} WHERE candidate_id=$1 ${where}`,[row.id])).rows[0]?.count);
      const snapshots=await count('candidate_enrichment_snapshots'),evidence=await count('candidate_resume_evidence'),completed=await count('candidate_processing_jobs',"AND status='completed'"); let reason:BackfillReason,eligible=false; if(String(row.canonical_status)==='inactive')reason='soft_deleted';else if(snapshots===0)reason='no_snapshot';else if(evidence===0)reason='no_evidence';else if(evidence>1)reason='ambiguous_evidence';else if(completed>0)reason='already_current';else{reason='eligible_projection_rebuild';eligible=true;} items.push({candidateId:String(row.id),atsCandidateId:row.external_candidate_id as string|null,eligible,operation:eligible?'rebuild_projection':null,reason});
    }
    return {observed:items.length,eligible:items.filter(item=>item.eligible).length,items};
  }
}
