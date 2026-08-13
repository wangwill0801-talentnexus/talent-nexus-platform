import { loadConfig } from './config/env.js';
import { createPool } from './db/pool.js';
import { CandidateProcessingService } from './services/candidate-processing-service.js';

const config=loadConfig(),pool=createPool(config.databaseUrl),service=new CandidateProcessingService(pool);
let stopping=false;
process.once('SIGINT',()=>{stopping=true;});
process.once('SIGTERM',()=>{stopping=true;});

await service.recoverStaleClaims();
while(!stopping){
  try{
    const processed=await service.runOne();
    if(!processed) await new Promise(resolve=>setTimeout(resolve,5000));
  }catch(error){
    console.error(JSON.stringify({event:'processing_worker_error',errorCode:'PROCESSING_LOOP_ERROR',errorName:error instanceof Error?error.name:'UnknownError'}));
    await new Promise(resolve=>setTimeout(resolve,10000));
  }
}
await pool.end();
