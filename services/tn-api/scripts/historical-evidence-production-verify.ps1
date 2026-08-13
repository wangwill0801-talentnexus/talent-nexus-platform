$ErrorActionPreference='Stop'
$envPath='E:\TalentNexus\config\tn-api.env';$psql='C:\Program Files\PostgreSQL\17\bin\psql.exe';$settings=@{}
foreach($line in Get-Content -LiteralPath $envPath){if($line-match'^([A-Z0-9_]+)=(.*)$'){$settings[$matches[1]]=$matches[2]}}
if(-not$settings.DATABASE_URL){throw 'TN database configuration unavailable.'}
$uri=[Uri]$settings.DATABASE_URL;$parts=$uri.UserInfo.Split(':',2);$user=[Uri]::UnescapeDataString($parts[0]);$password=[Uri]::UnescapeDataString($parts[1]);$database=$uri.AbsolutePath.TrimStart('/')
if($database-ne'talentnexus'-or$uri.Host-notin@('127.0.0.1','localhost')){throw 'Unexpected TN database target.'}
$pgpass=Join-Path $env:TEMP('tn-evidence-verify-'+[guid]::NewGuid().ToString('N')+'.pgpass')
try{
  Set-Content -LiteralPath $pgpass -Value "$($uri.Host):$($uri.Port):$database`:$user`:$password" -NoNewline -Encoding ascii
  &icacls $pgpass /inheritance:r /grant:r 'Administrators:F' 'SYSTEM:F'|Out-Null;$env:PGPASSFILE=$pgpass
  $sql=@"
SELECT json_build_object(
'migration_005',(SELECT count(*) FROM schema_migrations WHERE id='005_historical_evidence_bridge.sql'),
'identity_index',to_regclass('public.candidate_resume_evidence_identity_unique_idx') IS NOT NULL,
'duplicate_refs',(SELECT count(*) FROM(SELECT source_instance_id,external_candidate_id FROM candidate_external_refs GROUP BY 1,2 HAVING count(*)>1)d),
'orphan_profiles',(SELECT count(*) FROM candidate_ai_profiles p LEFT JOIN candidates c ON c.id=p.candidate_id WHERE c.id IS NULL),
'orphan_work',(SELECT count(*) FROM candidate_ai_work_experiences p LEFT JOIN candidates c ON c.id=p.candidate_id WHERE c.id IS NULL),
'orphan_education',(SELECT count(*) FROM candidate_ai_educations p LEFT JOIN candidates c ON c.id=p.candidate_id WHERE c.id IS NULL),
'orphan_evidence',(SELECT count(*) FROM candidate_resume_evidence e LEFT JOIN candidates c ON c.id=e.candidate_id WHERE c.id IS NULL),
'orphan_extractions',(SELECT count(*) FROM candidate_evidence_extractions x LEFT JOIN candidate_resume_evidence e ON e.id=x.evidence_id WHERE e.id IS NULL),
'orphan_jobs',(SELECT count(*) FROM candidate_processing_jobs j LEFT JOIN candidates c ON c.id=j.candidate_id WHERE c.id IS NULL));
"@
  $audit=&$psql -h $uri.Host -p $uri.Port -U $user -d $database -X -A -t -v ON_ERROR_STOP=1 -c $sql
  if($LASTEXITCODE-ne 0){throw 'Verification query failed.'}
  $health=(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3333/health' -TimeoutSec 10).StatusCode
  $public=(Invoke-WebRequest -UseBasicParsing 'https://tn-api.talentnexus.com.tw/health' -TimeoutSec 15).StatusCode
  $zh=(Invoke-WebRequest -UseBasicParsing 'https://ats.talentnexus.com.tw/webapp/' -TimeoutSec 15).StatusCode
  $en=(Invoke-WebRequest -UseBasicParsing 'https://ats-en.talentnexus.com.tw/webapp/' -TimeoutSec 15).StatusCode
  $listeners=Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|Where-Object{$_.LocalPort-in@(3333,5432,1433)}|Select-Object LocalAddress,LocalPort
  [pscustomobject]@{audit=($audit|Where-Object{$_}|Select-Object -Last 1|ConvertFrom-Json);health=$health;publicHealth=$public;pinpinZh=$zh;pinpinEn=$en;apiTask=(Get-ScheduledTask -TaskName 'TalentNexusApi').State.ToString();workerTask=(Get-ScheduledTask -TaskName 'TalentNexusProcessingWorker').State.ToString();listeners=$listeners;pinpinWrites=0;blobReads=0}|ConvertTo-Json -Depth 5 -Compress
}finally{Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue;Remove-Item -LiteralPath $pgpass -Force -ErrorAction SilentlyContinue}
