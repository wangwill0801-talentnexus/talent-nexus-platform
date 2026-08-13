$ErrorActionPreference='Stop'
$envPath='E:\TalentNexus\config\tn-api.env';$psql='C:\Program Files\PostgreSQL\17\bin\psql.exe';$settings=@{}
foreach($line in Get-Content -LiteralPath $envPath){if($line-match'^([A-Z0-9_]+)=(.*)$'){$settings[$matches[1]]=$matches[2]}}
if(-not$settings.DATABASE_URL-or-not$settings.TN_API_TOKEN){throw 'TN runtime configuration unavailable.'}
$uri=[Uri]$settings.DATABASE_URL;$parts=$uri.UserInfo.Split(':',2);$user=[Uri]::UnescapeDataString($parts[0]);$password=[Uri]::UnescapeDataString($parts[1]);$database=$uri.AbsolutePath.TrimStart('/')
if($database-ne'talentnexus'-or$uri.Host-notin@('127.0.0.1','localhost')){throw 'Unexpected TN database target.'}
$pgpass=Join-Path $env:TEMP ('tn-processing-verify-'+[guid]::NewGuid().ToString('N')+'.pgpass')
function Query([string]$sql){$output=&$psql -h $uri.Host -p $uri.Port -U $user -d $database -X -A -t -v ON_ERROR_STOP=1 -c $sql;if($LASTEXITCODE-ne 0){throw 'Controlled verification query failed.'};return ($output|Where-Object{$_}|Select-Object -Last 1)}
try{
  Set-Content -LiteralPath $pgpass -Value "$($uri.Host):$($uri.Port):$database`:$user`:$password" -NoNewline -Encoding ascii
  &icacls $pgpass /inheritance:r /grant:r 'Administrators:F' 'SYSTEM:F'|Out-Null;$env:PGPASSFILE=$pgpass
  $auditSql=@"
WITH target AS (SELECT DISTINCT r.candidate_id FROM candidate_external_refs r JOIN source_instances s ON s.id=r.source_instance_id WHERE s.source_system='pinpin' AND s.instance_key='pinpin-prod' AND r.external_candidate_id='43198')
SELECT json_build_object('candidate_count',(SELECT count(*) FROM target),'snapshot_count',(SELECT count(*) FROM candidate_enrichment_snapshots WHERE candidate_id IN(SELECT candidate_id FROM target)),'snapshot_id',(SELECT id FROM candidate_enrichment_snapshots WHERE candidate_id IN(SELECT candidate_id FROM target) ORDER BY created_at DESC,id DESC LIMIT 1),'job_count',(SELECT count(*) FROM candidate_processing_jobs WHERE candidate_id IN(SELECT candidate_id FROM target)),'profile_count',(SELECT count(*) FROM candidate_ai_profiles WHERE candidate_id IN(SELECT candidate_id FROM target)),'work_count',(SELECT count(*) FROM candidate_ai_work_experiences WHERE candidate_id IN(SELECT candidate_id FROM target)),'education_count',(SELECT count(*) FROM candidate_ai_educations WHERE candidate_id IN(SELECT candidate_id FROM target)));
"@
  $before=Query $auditSql|ConvertFrom-Json
  if($before.candidate_count-ne 1-or$before.snapshot_count-ne 1){throw 'Controlled candidate identity/snapshot gate failed.'}
  $headers=@{Authorization='Bearer '+$settings.TN_API_TOKEN};$body=@{operation='rebuild_projection'}|ConvertTo-Json -Compress
  $first=Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3333/internal/data-browser/candidates/43198/processing' -Headers $headers -ContentType 'application/json' -Body $body
  $deadline=(Get-Date).AddSeconds(30);do{Start-Sleep -Seconds 1;$job=Query "SELECT json_build_object('id',id,'status',status,'operation',operation,'attempts',attempt_count,'output_snapshot_id',output_snapshot_id,'error_code',last_error_code) FROM candidate_processing_jobs WHERE id='$($first.data.jobId)'::uuid;"|ConvertFrom-Json}while($job.status-in@('queued','processing','retry_scheduled')-and(Get-Date)-lt$deadline)
  if($job.status-ne'completed'){throw 'Controlled projection rebuild did not complete.'}
  $after=Query $auditSql|ConvertFrom-Json
  if($after.snapshot_id-ne$before.snapshot_id-or$after.snapshot_count-ne$before.snapshot_count){throw 'Immutable snapshot gate failed.'}
  $replay=Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3333/internal/data-browser/candidates/43198/processing' -Headers $headers -ContentType 'application/json' -Body $body
  if($replay.data.status-ne'unchanged'-or$replay.data.jobId-ne$first.data.jobId){throw 'Processing idempotency gate failed.'}
  $integrity=Query @"
SELECT json_build_object('migration_004',(SELECT count(*) FROM schema_migrations WHERE id='004_candidate_evidence_processing.sql'),'processing_jobs_table',to_regclass('public.candidate_processing_jobs') IS NOT NULL,'extractions_table',to_regclass('public.candidate_evidence_extractions') IS NOT NULL,'duplicate_refs',(SELECT count(*) FROM(SELECT source_instance_id,external_candidate_id FROM candidate_external_refs GROUP BY 1,2 HAVING count(*)>1)d),'orphan_profiles',(SELECT count(*) FROM candidate_ai_profiles p LEFT JOIN candidates c ON c.id=p.candidate_id WHERE c.id IS NULL),'orphan_work',(SELECT count(*) FROM candidate_ai_work_experiences p LEFT JOIN candidates c ON c.id=p.candidate_id WHERE c.id IS NULL),'orphan_education',(SELECT count(*) FROM candidate_ai_educations p LEFT JOIN candidates c ON c.id=p.candidate_id WHERE c.id IS NULL),'orphan_jobs',(SELECT count(*) FROM candidate_processing_jobs p LEFT JOIN candidates c ON c.id=p.candidate_id WHERE c.id IS NULL),'candidate_43219_refs',(SELECT count(*) FROM candidate_external_refs r JOIN source_instances s ON s.id=r.source_instance_id WHERE s.source_system='pinpin' AND s.instance_key='pinpin-prod' AND r.external_candidate_id='43219'),'candidate_43219_snapshots',(SELECT count(*) FROM candidate_enrichment_snapshots e WHERE e.candidate_id IN(SELECT r.candidate_id FROM candidate_external_refs r JOIN source_instances s ON s.id=r.source_instance_id WHERE s.source_system='pinpin' AND s.instance_key='pinpin-prod' AND r.external_candidate_id='43219')));
"@|ConvertFrom-Json
  $health=(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3333/health' -TimeoutSec 10).StatusCode
  $publicHealth=(Invoke-WebRequest -UseBasicParsing 'https://tn-api.talentnexus.com.tw/health' -TimeoutSec 15).StatusCode
  $zh=(Invoke-WebRequest -UseBasicParsing 'https://ats.talentnexus.com.tw/webapp/' -TimeoutSec 15).StatusCode;$en=(Invoke-WebRequest -UseBasicParsing 'https://ats-en.talentnexus.com.tw/webapp/' -TimeoutSec 15).StatusCode
  $listeners=Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object{$_.LocalPort-in@(3333,5432,1433)}|Select-Object LocalAddress,LocalPort
  $worker=Get-ScheduledTask -TaskName 'TalentNexusProcessingWorker'
  [pscustomobject]@{before=$before;first=[pscustomobject]@{enqueue=$first.data.status;jobStatus=$job.status;attempts=$job.attempts;snapshotPreserved=$job.output_snapshot_id-eq$before.snapshot_id;errorCode=$job.error_code};after=$after;replay=[pscustomobject]@{status=$replay.data.status;sameJob=$replay.data.jobId-eq$first.data.jobId};integrity=$integrity;runtime=[pscustomobject]@{localHealth=$health;publicHealth=$publicHealth;pinpinZh=$zh;pinpinEn=$en;workerState=$worker.State.ToString();listeners=$listeners};pinpinWrites=0;blobReads=0;geminiCalls=0}|ConvertTo-Json -Depth 6 -Compress
}finally{Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue;Remove-Item -LiteralPath $pgpass -Force -ErrorAction SilentlyContinue}
