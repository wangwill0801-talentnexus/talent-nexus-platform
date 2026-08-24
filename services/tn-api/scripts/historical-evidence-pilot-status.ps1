param([Parameter(Mandatory = $true)][ValidatePattern('^\d{1,18}$')][string]$CandidateId)

$ErrorActionPreference = 'Stop'
$envPath = 'E:\TalentNexus\config\tn-api.env'
$psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
$settings = @{}
foreach ($line in Get-Content -LiteralPath $envPath) {
  if ($line -match '^([A-Z0-9_]+)=(.*)$') { $settings[$matches[1]] = $matches[2] }
}
if (-not $settings.DATABASE_URL) { throw 'TN database configuration unavailable.' }
$uri = [Uri]$settings.DATABASE_URL
if ($uri.Host -notin @('127.0.0.1', 'localhost') -or $uri.AbsolutePath.TrimStart('/') -ne 'talentnexus') { throw 'Unexpected TN database target.' }
$parts = $uri.UserInfo.Split(':', 2)
$dbUser = [Uri]::UnescapeDataString($parts[0])
$dbPassword = [Uri]::UnescapeDataString($parts[1])
$database = $uri.AbsolutePath.TrimStart('/')
$pgpass = Join-Path $env:TEMP ('tn-evidence-status-' + [guid]::NewGuid().ToString('N') + '.pgpass')
try {
  Set-Content -LiteralPath $pgpass -Value "$($uri.Host):$($uri.Port):$database`:$dbUser`:$dbPassword" -NoNewline -Encoding ascii
  & icacls $pgpass /inheritance:r /grant:r 'Administrators:F' 'SYSTEM:F' | Out-Null
  $env:PGPASSFILE = $pgpass
  $sql = @"
WITH target AS (
  SELECT DISTINCT r.candidate_id
  FROM candidate_external_refs r
  JOIN source_instances si ON si.id=r.source_instance_id
  WHERE si.source_system='pinpin' AND si.instance_key='pinpin-prod' AND r.external_candidate_id='$CandidateId'
), latest_snapshot AS (
  SELECT s.id FROM candidate_enrichment_snapshots s
  WHERE s.candidate_id IN (SELECT candidate_id FROM target)
  ORDER BY s.created_at DESC, s.id DESC LIMIT 1
), latest_job AS (
  SELECT j.* FROM candidate_processing_jobs j
  WHERE j.candidate_id IN (SELECT candidate_id FROM target)
  ORDER BY j.created_at DESC, j.id DESC LIMIT 1
)
SELECT json_build_object(
  'candidateCount',(SELECT count(*) FROM target),
  'processingStatus',(SELECT status FROM candidate_processing_state WHERE candidate_id IN (SELECT candidate_id FROM target) LIMIT 1),
  'processingErrorCode',(SELECT last_error_code FROM candidate_processing_state WHERE candidate_id IN (SELECT candidate_id FROM target) LIMIT 1),
  'latestJobStatus',(SELECT status FROM latest_job),
  'latestJobId',(SELECT id FROM latest_job),
  'latestJobErrorCode',(SELECT last_error_code FROM latest_job),
  'latestJobAttempts',(SELECT attempt_count FROM latest_job),
  'latestJobOutputSnapshotPresent',COALESCE((SELECT output_snapshot_id IS NOT NULL FROM latest_job),false),
  'jobCount',(SELECT count(*) FROM candidate_processing_jobs WHERE candidate_id IN (SELECT candidate_id FROM target)),
  'evidenceCount',(SELECT count(*) FROM candidate_resume_evidence WHERE candidate_id IN (SELECT candidate_id FROM target)),
  'contentBackedCount',(SELECT count(*) FROM candidate_resume_evidence WHERE candidate_id IN (SELECT candidate_id FROM target) AND processing_eligible=true AND representation_kind IN ('connector_text','connector_html','local_file_text')),
  'latestSnapshotEvidenceCount',(SELECT count(*) FROM latest_snapshot s JOIN candidate_resume_evidence e ON e.enrichment_snapshot_id=s.id),
  'latestSnapshotContentEvidenceCount',(SELECT count(*) FROM latest_snapshot s JOIN candidate_resume_evidence e ON e.enrichment_snapshot_id=s.id WHERE e.processing_eligible=true AND e.representation_kind IN ('connector_text','connector_html','local_file_text')),
  'matchingExtractionCount',(SELECT count(*) FROM candidate_resume_evidence e JOIN candidate_evidence_extractions x ON x.evidence_id=e.id WHERE e.candidate_id IN (SELECT candidate_id FROM target) AND e.processing_eligible=true AND x.status='available' AND x.character_count>0 AND lower(x.content_sha256)=lower(e.content_sha256) AND x.extractor_version=e.extractor_version AND x.representation_kind=e.representation_kind)
);
"@
  $output = & $psql -h $uri.Host -p $uri.Port -U $dbUser -d $database -X -A -t -v ON_ERROR_STOP=1 -c $sql
  if ($LASTEXITCODE -ne 0) { throw 'Pilot status query failed.' }
  $output | Where-Object { $_ -and $_.Trim() } | Select-Object -Last 1
} finally {
  Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pgpass -Force -ErrorAction SilentlyContinue
}
