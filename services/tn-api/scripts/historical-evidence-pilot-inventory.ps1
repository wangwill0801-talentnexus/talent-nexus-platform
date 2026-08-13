$ErrorActionPreference='Stop'
$envPath='E:\TalentNexus\config\tn-api.env';$psql='C:\Program Files\PostgreSQL\17\bin\psql.exe';$settings=@{}
foreach($line in Get-Content -LiteralPath $envPath){if($line-match'^([A-Z0-9_]+)=(.*)$'){$settings[$matches[1]]=$matches[2]}}
if(-not$settings.DATABASE_URL){throw 'TN database configuration unavailable.'}
$uri=[Uri]$settings.DATABASE_URL;$parts=$uri.UserInfo.Split(':',2);$user=[Uri]::UnescapeDataString($parts[0]);$password=[Uri]::UnescapeDataString($parts[1]);$database=$uri.AbsolutePath.TrimStart('/')
if($database-ne'talentnexus'-or$uri.Host-notin@('127.0.0.1','localhost')){throw 'Unexpected TN database target.'}
$pgpass=Join-Path $env:TEMP ('tn-historical-inventory-'+[guid]::NewGuid().ToString('N')+'.pgpass')
try{
  Set-Content -LiteralPath $pgpass -Value "$($uri.Host):$($uri.Port):$database`:$user`:$password" -NoNewline -Encoding ascii
  &icacls $pgpass /inheritance:r /grant:r 'Administrators:F' 'SYSTEM:F'|Out-Null;$env:PGPASSFILE=$pgpass
  $query=@"
WITH scoped AS (
 SELECT c.id,r.external_candidate_id ats_id,c.canonical_status
 FROM candidates c JOIN candidate_external_refs r ON r.candidate_id=c.id JOIN source_instances si ON si.id=r.source_instance_id
 WHERE si.source_system='pinpin' AND si.instance_key='pinpin-prod'
), latest AS (
 SELECT DISTINCT ON(candidate_id) id,candidate_id,source_kind,source_system,source_reference,source_url,schema_version,parser_version,ai_provider,ai_model,payload_fingerprint,created_at
 FROM candidate_enrichment_snapshots ORDER BY candidate_id,created_at DESC,id DESC
)
SELECT json_agg(row_to_json(x) ORDER BY x.has_evidence DESC,x.ats_id) FROM (
 SELECT s.ats_id,s.canonical_status,l.source_kind,l.source_system,l.schema_version,
  CASE WHEN l.parser_version IS NULL THEN false ELSE true END parser_version_recorded,
  CASE WHEN l.ai_provider IS NULL THEN false ELSE true END provider_recorded,
  CASE WHEN l.ai_model IS NULL THEN false ELSE true END model_recorded,
  CASE WHEN l.payload_fingerprint ~ '^[0-9a-f]{64}$' THEN true ELSE false END snapshot_fingerprint_recorded,
  count(DISTINCT e.id)::int evidence_count,count(DISTINCT ex.id)::int extraction_count,count(DISTINCT j.id)::int job_count,
  (count(DISTINCT e.id)>0) has_evidence,
  count(DISTINCT p.id)::int profile_count,count(DISTINCT w.id)::int ai_work_count,count(DISTINCT ed.id)::int ai_education_count,count(DISTINCT t.id)::int ai_term_count
 FROM scoped s JOIN latest l ON l.candidate_id=s.id
 LEFT JOIN candidate_resume_evidence e ON e.candidate_id=s.id
 LEFT JOIN candidate_evidence_extractions ex ON ex.candidate_id=s.id
 LEFT JOIN candidate_processing_jobs j ON j.candidate_id=s.id
 LEFT JOIN candidate_ai_profiles p ON p.candidate_id=s.id
 LEFT JOIN candidate_ai_work_experiences w ON w.candidate_id=s.id
 LEFT JOIN candidate_ai_educations ed ON ed.candidate_id=s.id
 LEFT JOIN candidate_ai_terms t ON t.candidate_id=s.id
 GROUP BY s.ats_id,s.canonical_status,l.source_kind,l.source_system,l.schema_version,l.parser_version,l.ai_provider,l.ai_model,l.payload_fingerprint
) x;
"@
  $output=&$psql -h $uri.Host -p $uri.Port -U $user -d $database -X -A -t -v ON_ERROR_STOP=1 -c $query
  if($LASTEXITCODE-ne 0){throw 'Historical evidence inventory failed.'}
  $json=$output|Where-Object{$_}|Select-Object -Last 1
  if(-not$json){'[]'}else{$json}
}finally{Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue;Remove-Item -LiteralPath $pgpass -Force -ErrorAction SilentlyContinue}
