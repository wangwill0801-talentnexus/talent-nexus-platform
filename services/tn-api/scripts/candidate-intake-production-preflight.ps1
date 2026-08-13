param([ValidateSet('pre','post')][string]$Mode = 'pre')
$ErrorActionPreference = 'Stop'

$envPath = 'E:\TalentNexus\config\tn-api.env'
$psql = Get-ChildItem 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -ErrorAction Stop | Select-Object -First 1 -ExpandProperty FullName
$settings = @{}
foreach ($line in Get-Content -LiteralPath $envPath) {
  if ($line -match '^([A-Z0-9_]+)=(.*)$') { $settings[$matches[1]] = $matches[2] }
}
if (-not $settings.DATABASE_URL) { throw 'TN database configuration unavailable.' }
$uri = [Uri]$settings.DATABASE_URL
$userInfo = $uri.UserInfo.Split(':', 2)
if ($userInfo.Count -ne 2) { throw 'TN database configuration invalid.' }
$user = [Uri]::UnescapeDataString($userInfo[0])
$password = [Uri]::UnescapeDataString($userInfo[1])
$database = $uri.AbsolutePath.TrimStart('/')
if ($database -ne 'talentnexus' -or $uri.Host -notin @('127.0.0.1','localhost')) { throw 'Unexpected TN database target.' }

$pgpass = Join-Path $env:TEMP ('tn-preflight-' + [guid]::NewGuid().ToString('N') + '.pgpass')
try {
  Set-Content -LiteralPath $pgpass -Value "$($uri.Host):$($uri.Port):$database`:$user`:$password" -NoNewline -Encoding ascii
  & icacls $pgpass /inheritance:r /grant:r 'Administrators:F' 'SYSTEM:F' | Out-Null
  $env:PGPASSFILE = $pgpass
  $query = @"
SELECT json_build_object(
  'database', current_database(),
  'migrations', COALESCE((SELECT json_agg(id ORDER BY id) FROM schema_migrations), '[]'::json),
  'candidates', (SELECT count(*) FROM candidates),
  'external_refs', (SELECT count(*) FROM candidate_external_refs),
  'work', (SELECT count(*) FROM candidate_work_experiences),
  'education', (SELECT count(*) FROM candidate_educations),
  'documents', (SELECT count(*) FROM candidate_documents),
  'snapshots', (SELECT count(*) FROM candidate_enrichment_snapshots),
  'duplicate_scoped_refs', (SELECT count(*) FROM (SELECT source_instance_id,external_candidate_id FROM candidate_external_refs GROUP BY source_instance_id,external_candidate_id HAVING count(*)>1) d),
  'candidate_43198_refs', (SELECT count(*) FROM candidate_external_refs r JOIN source_instances s ON s.id=r.source_instance_id WHERE s.source_system='pinpin' AND s.instance_key='pinpin-prod' AND r.external_candidate_id='43198'),
  'candidate_43198_candidates', (SELECT count(DISTINCT r.candidate_id) FROM candidate_external_refs r JOIN source_instances s ON s.id=r.source_instance_id WHERE s.source_system='pinpin' AND s.instance_key='pinpin-prod' AND r.external_candidate_id='43198'),
  'candidate_43198_snapshots', (SELECT count(*) FROM candidate_enrichment_snapshots e WHERE e.candidate_id IN (SELECT r.candidate_id FROM candidate_external_refs r JOIN source_instances s ON s.id=r.source_instance_id WHERE s.source_system='pinpin' AND s.instance_key='pinpin-prod' AND r.external_candidate_id='43198'))
);
"@
  $output = & $psql -h $uri.Host -p $uri.Port -U $user -d $database -X -A -t -v ON_ERROR_STOP=1 -c $query
  if ($LASTEXITCODE -ne 0) { throw 'TN production preflight query failed.' }
  [pscustomobject]@{ mode=$Mode; databaseAudit=($output | Where-Object { $_ } | Select-Object -Last 1 | ConvertFrom-Json); postTables=if($Mode -eq 'post'){@('candidate_ai_profiles','candidate_ai_work_experiences','candidate_ai_educations','candidate_ai_terms','candidate_resume_evidence','candidate_processing_state') | ForEach-Object { [pscustomobject]@{name=$_; exists=(& $psql -h $uri.Host -p $uri.Port -U $user -d $database -X -A -t -v ON_ERROR_STOP=1 -c "SELECT to_regclass('public.$_') IS NOT NULL;" | Select-Object -Last 1).Trim() -eq 't' } }}else{@()} } | ConvertTo-Json -Depth 5 -Compress
} finally {
  Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pgpass -Force -ErrorAction SilentlyContinue
}
