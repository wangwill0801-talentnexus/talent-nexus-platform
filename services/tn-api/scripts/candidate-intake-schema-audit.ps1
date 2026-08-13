$ErrorActionPreference='Stop'
$psql='C:\Program Files\PostgreSQL\17\bin\psql.exe'
$settings=@{}
foreach($line in Get-Content -LiteralPath 'E:\TalentNexus\config\tn-api.env') {
  if($line -match '^([A-Z0-9_]+)=(.*)$') { $settings[$matches[1]]=$matches[2] }
}
$uri=[Uri]$settings.DATABASE_URL
$userInfo=$uri.UserInfo.Split(':',2)
$user=[Uri]::UnescapeDataString($userInfo[0])
$password=[Uri]::UnescapeDataString($userInfo[1])
$database=$uri.AbsolutePath.TrimStart('/')
if($database -ne 'talentnexus' -or $uri.Host -notin @('127.0.0.1','localhost')) { throw 'Unexpected database target.' }
$pgpass=Join-Path $env:TEMP ('tn-schema-audit-'+[guid]::NewGuid().ToString('N')+'.pgpass')
try {
  Set-Content -LiteralPath $pgpass -Value "$($uri.Host):$($uri.Port):$database`:$user`:$password" -NoNewline -Encoding ascii
  & icacls $pgpass /inheritance:r /grant:r 'Administrators:F' 'SYSTEM:F' | Out-Null
  $env:PGPASSFILE=$pgpass
  $query=@"
WITH target_tables(name) AS (VALUES
 ('candidate_ai_profiles'),('candidate_ai_work_experiences'),('candidate_ai_educations'),
 ('candidate_ai_terms'),('candidate_resume_evidence'),('candidate_processing_state'))
SELECT json_build_object(
  'migration003',(SELECT count(*) FROM schema_migrations WHERE id='003_candidate_intake_foundation.sql'),
  'tables',(SELECT count(*) FROM target_tables WHERE to_regclass('public.'||name) IS NOT NULL),
  'foreignKeys',(SELECT count(*) FROM pg_constraint constraint_row JOIN pg_class table_row ON table_row.oid=constraint_row.conrelid WHERE constraint_row.contype='f' AND table_row.relname IN (SELECT name FROM target_tables)),
  'uniqueOrPrimary',(SELECT count(*) FROM pg_constraint constraint_row JOIN pg_class table_row ON table_row.oid=constraint_row.conrelid WHERE constraint_row.contype IN ('p','u') AND table_row.relname IN (SELECT name FROM target_tables)),
  'checks',(SELECT count(*) FROM pg_constraint constraint_row JOIN pg_class table_row ON table_row.oid=constraint_row.conrelid WHERE constraint_row.contype='c' AND table_row.relname IN (SELECT name FROM target_tables)),
  'indexes',(SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename IN (SELECT name FROM target_tables)),
  'orphanProfiles',(SELECT count(*) FROM candidate_ai_profiles profile LEFT JOIN candidates candidate ON candidate.id=profile.candidate_id LEFT JOIN candidate_enrichment_snapshots snapshot ON snapshot.id=profile.enrichment_snapshot_id WHERE candidate.id IS NULL OR snapshot.id IS NULL),
  'orphanAiWork',(SELECT count(*) FROM candidate_ai_work_experiences work LEFT JOIN candidates candidate ON candidate.id=work.candidate_id LEFT JOIN candidate_enrichment_snapshots snapshot ON snapshot.id=work.enrichment_snapshot_id WHERE candidate.id IS NULL OR snapshot.id IS NULL),
  'orphanAiEducation',(SELECT count(*) FROM candidate_ai_educations education LEFT JOIN candidates candidate ON candidate.id=education.candidate_id LEFT JOIN candidate_enrichment_snapshots snapshot ON snapshot.id=education.enrichment_snapshot_id WHERE candidate.id IS NULL OR snapshot.id IS NULL),
  'orphanTerms',(SELECT count(*) FROM candidate_ai_terms term LEFT JOIN candidates candidate ON candidate.id=term.candidate_id LEFT JOIN candidate_enrichment_snapshots snapshot ON snapshot.id=term.enrichment_snapshot_id WHERE candidate.id IS NULL OR snapshot.id IS NULL),
  'orphanEvidence',(SELECT count(*) FROM candidate_resume_evidence evidence LEFT JOIN candidates candidate ON candidate.id=evidence.candidate_id LEFT JOIN candidate_enrichment_snapshots snapshot ON snapshot.id=evidence.enrichment_snapshot_id WHERE candidate.id IS NULL OR snapshot.id IS NULL),
  'orphanProcessing',(SELECT count(*) FROM candidate_processing_state processing LEFT JOIN candidates candidate ON candidate.id=processing.candidate_id LEFT JOIN candidate_enrichment_snapshots snapshot ON snapshot.id=processing.latest_snapshot_id WHERE candidate.id IS NULL OR (processing.latest_snapshot_id IS NOT NULL AND snapshot.id IS NULL))
);
"@
  $result=& $psql -h $uri.Host -p $uri.Port -U $user -d $database -X -A -t -v ON_ERROR_STOP=1 -c $query
  if($LASTEXITCODE -ne 0){throw 'Candidate intake schema audit failed.'}
  $result | Where-Object {$_} | Select-Object -Last 1
} finally {
  Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pgpass -Force -ErrorAction SilentlyContinue
}
