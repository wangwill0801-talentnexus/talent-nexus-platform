param(
  [Parameter(Mandatory = $false)][ValidateRange(1, 20)][int]$ExpectedCount = 7,
  [Parameter(Mandatory = $false)][ValidateRange(30, 600)][int]$TimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
$appRoot = 'E:\TalentNexus\tn-api'
$envPath = 'E:\TalentNexus\config\tn-api.env'
$node = 'C:\Program Files\nodejs\node.exe'
$psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
$apiBase = 'http://127.0.0.1:3333'
$settings = @{}

foreach ($line in Get-Content -LiteralPath $envPath) {
  if ($line -match '^([A-Z0-9_]+)=(.*)$') { $settings[$matches[1]] = $matches[2] }
}
if (-not $settings.DATABASE_URL -or -not $settings.TN_API_TOKEN) { throw 'TN runtime configuration unavailable.' }

$uri = [Uri]$settings.DATABASE_URL
if ($uri.Host -notin @('127.0.0.1', 'localhost') -or $uri.AbsolutePath.TrimStart('/') -ne 'talentnexus') {
  throw 'Unexpected TN database target.'
}
$parts = $uri.UserInfo.Split(':', 2)
if ($parts.Count -ne 2) { throw 'Unexpected TN database credentials format.' }
$dbUser = [Uri]::UnescapeDataString($parts[0])
$dbPassword = [Uri]::UnescapeDataString($parts[1])
$database = $uri.AbsolutePath.TrimStart('/')
$pgpass = Join-Path $env:TEMP ('tn-evidence-pilot-' + [guid]::NewGuid().ToString('N') + '.pgpass')

function Query([string]$sql) {
  $output = & $psql -h $uri.Host -p $uri.Port -U $dbUser -d $database -X -A -t -v ON_ERROR_STOP=1 -c $sql
  if ($LASTEXITCODE -ne 0) { throw 'Pilot metadata query failed.' }
  return ($output | Where-Object { $_ -and $_.Trim() } | Select-Object -Last 1)
}

function QueryJson([string]$sql) {
  $line = Query $sql
  if (-not $line) { throw 'Pilot metadata query returned no result.' }
  return $line | ConvertFrom-Json
}

function Gate([string]$atsId) {
  if ($atsId -notmatch '^\d{1,18}$') { throw 'Planner returned a non-numeric ATS ID.' }
  $sql = @"
WITH target AS (
  SELECT DISTINCT r.candidate_id
  FROM candidate_external_refs r
  JOIN source_instances si ON si.id = r.source_instance_id
  WHERE si.source_system = 'pinpin'
    AND si.instance_key = 'pinpin-prod'
    AND r.external_candidate_id = '$atsId'
), latest_snapshot AS (
  SELECT s.id, s.candidate_id
  FROM candidate_enrichment_snapshots s
  WHERE s.candidate_id IN (SELECT candidate_id FROM target)
  ORDER BY s.created_at DESC, s.id DESC
  LIMIT 1
)
SELECT json_build_object(
  'candidate_count', (SELECT count(*) FROM target),
  'scoped_ref_count', (SELECT count(*) FROM candidate_external_refs r JOIN source_instances si ON si.id=r.source_instance_id WHERE r.candidate_id IN (SELECT candidate_id FROM target) AND si.source_system='pinpin' AND si.instance_key='pinpin-prod'),
  'latest_snapshot_evidence_count', (SELECT count(*) FROM latest_snapshot s JOIN candidate_resume_evidence e ON e.enrichment_snapshot_id=s.id WHERE e.processing_eligible=true),
  'content_backed_count', (SELECT count(*) FROM candidate_resume_evidence e WHERE e.candidate_id IN (SELECT candidate_id FROM target) AND e.processing_eligible=true AND e.representation_kind IN ('connector_text','connector_html','local_file_text')),
  'processable_evidence_count', (SELECT count(*) FROM candidate_resume_evidence e JOIN candidate_evidence_extractions x ON x.evidence_id=e.id AND x.candidate_id=e.candidate_id AND x.status='available' AND x.character_count>0 AND lower(x.content_sha256)=lower(e.content_sha256) AND x.extractor_version=e.extractor_version AND x.representation_kind=e.representation_kind WHERE e.candidate_id IN (SELECT candidate_id FROM target) AND e.processing_eligible=true AND e.representation_kind IN ('connector_text','connector_html','local_file_text') AND e.content_sha256 ~ '^[0-9a-f]{64}$' AND e.evidence_fingerprint ~ '^[0-9a-f]{64}$' AND e.evidence_identity_key ~ '^[0-9a-f]{64}$'),
  'valid_source_hash_count', (SELECT count(*) FROM candidate_resume_evidence e WHERE e.candidate_id IN (SELECT candidate_id FROM target) AND e.processing_eligible=true AND e.representation_kind IN ('connector_text','connector_html','local_file_text') AND e.content_sha256 ~ '^[0-9a-f]{64}$' AND e.evidence_fingerprint ~ '^[0-9a-f]{64}$' AND e.evidence_identity_key ~ '^[0-9a-f]{64}$' AND (NULLIF(trim(e.source_reference),'') IS NOT NULL OR NULLIF(trim(e.source_url),'') IS NOT NULL OR NULLIF(trim(e.attachment_reference),'') IS NOT NULL)),
  'matching_extraction_count', (SELECT count(*) FROM candidate_resume_evidence e JOIN candidate_evidence_extractions x ON x.evidence_id=e.id WHERE e.candidate_id IN (SELECT candidate_id FROM target) AND e.processing_eligible=true AND e.representation_kind IN ('connector_text','connector_html','local_file_text') AND x.status='available' AND x.character_count>0 AND lower(x.content_sha256)=lower(e.content_sha256) AND x.extractor_version=e.extractor_version AND x.representation_kind=e.representation_kind),
  'pending_job_count', (SELECT count(*) FROM candidate_processing_jobs j WHERE j.candidate_id IN (SELECT candidate_id FROM target) AND j.status IN ('queued','processing','retry_scheduled')),
  'snapshot_count', (SELECT count(*) FROM candidate_enrichment_snapshots s WHERE s.candidate_id IN (SELECT candidate_id FROM target)),
  'evidence_count', (SELECT count(*) FROM candidate_resume_evidence e WHERE e.candidate_id IN (SELECT candidate_id FROM target))
);
"@
  return QueryJson $sql
}

function JobStatus([string]$jobId) {
  if ($jobId -notmatch '^[0-9a-f-]{36}$') { throw 'Processing response returned an invalid job identifier.' }
  return QueryJson "SELECT json_build_object('status',status,'attempts',attempt_count,'output_snapshot_id',output_snapshot_id,'error_code',last_error_code) FROM candidate_processing_jobs WHERE id='$jobId'::uuid;"
}

function Enqueue([string]$atsId) {
  $headers = @{ Authorization = 'Bearer ' + $settings.TN_API_TOKEN }
  $body = @{ operation = 'process_new_evidence' } | ConvertTo-Json -Compress
  try {
    return Invoke-RestMethod -Method Post -Uri "$apiBase/internal/data-browser/candidates/$atsId/processing" -Headers $headers -ContentType 'application/json' -Body $body
  } catch {
    throw "Pilot enqueue failed for ATS $atsId."
  }
}

function WaitForCompletion([string]$jobId) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Seconds 1
    $job = JobStatus $jobId
  } while ($job.status -in @('queued','processing','retry_scheduled') -and (Get-Date) -lt $deadline)
  return $job
}

try {
  Set-Content -LiteralPath $pgpass -Value "$($uri.Host):$($uri.Port):$database`:$dbUser`:$dbPassword" -NoNewline -Encoding ascii
  & icacls $pgpass /inheritance:r /grant:r 'Administrators:F' 'SYSTEM:F' | Out-Null
  $env:PGPASSFILE = $pgpass

  $planLine = & $node '--env-file=E:\TalentNexus\config\tn-api.env' "$appRoot\dist\services\historical-evidence-pilot-dry-run.js" 2>$null | Select-Object -Last 1
  if (-not $planLine) { throw 'Pilot planner returned no result.' }
  $plan = $planLine | ConvertFrom-Json
  $ids = @($plan.selectedAtsCandidateIds | ForEach-Object { [string]$_ })
  if ([int]$plan.selected -ne $ExpectedCount -or $ids.Count -ne $ExpectedCount) { throw 'Pilot cohort changed or is smaller than the authorized cohort.' }
  if (($ids | Sort-Object -Unique).Count -ne $ExpectedCount) { throw 'Pilot cohort contains duplicate ATS identities.' }

  $firstRun = @()
  foreach ($atsId in $ids) {
    $before = Gate $atsId
    if ([int]$before.candidate_count -ne 1 -or [int]$before.scoped_ref_count -ne 1 -or [int]$before.processable_evidence_count -ne 1 -or [int]$before.content_backed_count -ne 1 -or [int]$before.valid_source_hash_count -ne 1 -or [int]$before.matching_extraction_count -ne 1 -or [int]$before.pending_job_count -ne 0) {
      throw "Pilot metadata gate failed for ATS $atsId."
    }
    $request = Enqueue $atsId
    $job = JobStatus ([string]$request.data.jobId)
    if ($request.data.status -eq 'created') { $job = WaitForCompletion ([string]$request.data.jobId) }
    if ($job.status -ne 'completed' -or -not $job.output_snapshot_id) {
      [pscustomobject]@{ status = 'failed'; failedAtsId = $atsId; jobStatus = [string]$job.status; attempts = [int]$job.attempts; errorCode = [string]$job.error_code } | ConvertTo-Json -Compress
      throw "Pilot processing did not complete for ATS $atsId."
    }
    $after = Gate $atsId
    if ([int]$after.candidate_count -ne 1 -or [int]$after.scoped_ref_count -ne 1 -or [int]$after.content_backed_count -ne 1 -or [int]$after.valid_source_hash_count -ne 1 -or [int]$after.matching_extraction_count -ne 1 -or [int]$after.pending_job_count -ne 0) { throw "Pilot post-processing gate failed for ATS $atsId." }
    $firstRun += [pscustomobject]@{ status = [string]$request.data.status; jobStatus = [string]$job.status; snapshotCreated = ([int]$after.snapshot_count -gt [int]$before.snapshot_count) }
  }

  $secondRun = @()
  foreach ($atsId in $ids) {
    $request = Enqueue $atsId
    if ($request.data.status -ne 'unchanged') { throw "Pilot second-run was not a no-op for ATS $atsId." }
    $secondRun += [string]$request.data.status
  }

  $integrity = QueryJson @"
SELECT json_build_object(
  'duplicate_external_refs', (SELECT count(*) FROM (SELECT source_instance_id,external_candidate_id FROM candidate_external_refs GROUP BY 1,2 HAVING count(*)>1) d),
  'duplicate_evidence_identity', (SELECT count(*) FROM (SELECT candidate_id,evidence_identity_key FROM candidate_resume_evidence WHERE evidence_identity_key IS NOT NULL GROUP BY 1,2 HAVING count(*)>1) d),
  'duplicate_extraction_identity', (SELECT count(*) FROM (SELECT evidence_id,extractor_version,content_sha256 FROM candidate_evidence_extractions GROUP BY 1,2,3 HAVING count(*)>1) d),
  'duplicate_processing_identity', (SELECT count(*) FROM (SELECT candidate_id,idempotency_key FROM candidate_processing_jobs GROUP BY 1,2 HAVING count(*)>1) d),
  'duplicate_snapshot_identity', (SELECT count(*) FROM (SELECT candidate_id,schema_version,idempotency_key FROM candidate_enrichment_snapshots GROUP BY 1,2,3 HAVING count(*)>1) d),
  'orphan_evidence', (SELECT count(*) FROM candidate_resume_evidence e LEFT JOIN candidates c ON c.id=e.candidate_id WHERE c.id IS NULL),
  'orphan_jobs', (SELECT count(*) FROM candidate_processing_jobs j LEFT JOIN candidates c ON c.id=j.candidate_id WHERE c.id IS NULL)
);
"@
  [pscustomobject]@{
    status = 'completed'
    selected = $ids.Count
    firstRunCreated = @($firstRun | Where-Object { $_.status -eq 'created' }).Count
    firstRunUnchanged = @($firstRun | Where-Object { $_.status -eq 'unchanged' }).Count
    firstRunCompleted = @($firstRun | Where-Object { $_.jobStatus -eq 'completed' }).Count
    secondRunUnchanged = @($secondRun | Where-Object { $_ -eq 'unchanged' }).Count
    duplicateIntegrity = $integrity
    geminiCallCount = 'not_independently_observable_from_metadata'
    pinpinWrites = 0
    pinpinBlobReads = 0
  } | ConvertTo-Json -Depth 5 -Compress
} finally {
  Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pgpass -Force -ErrorAction SilentlyContinue
}
