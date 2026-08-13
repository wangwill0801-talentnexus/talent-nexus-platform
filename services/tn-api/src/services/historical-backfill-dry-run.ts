import { loadConfig } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { HistoricalBackfillService } from './historical-backfill-service.js';

const config=loadConfig(),pool=createPool(config.databaseUrl);
try{
  const report=await new HistoricalBackfillService(pool).dryRun();
  const reasons=Object.fromEntries([...new Set(report.items.map(item=>item.reason))].sort().map(reason=>[reason,report.items.filter(item=>item.reason===reason).length]));
  console.log(JSON.stringify({observed:report.observed,eligible:report.eligible,reasons}));
}finally{await pool.end();}
