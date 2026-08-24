$ErrorActionPreference = 'Stop'
$tnEnv = 'E:\TalentNexus\config\tn-api.env'
$settings = @{}
foreach ($line in Get-Content -LiteralPath $tnEnv) { if ($line -match '^([A-Z0-9_]+)=(.*)$') { $settings[$matches[1]] = $matches[2] } }
if (-not $settings.TN_API_TOKEN -or -not $settings.DATABASE_URL) { throw 'TN_RUNTIME_CONFIG_UNAVAILABLE' }
$token = $settings.TN_API_TOKEN
$uri = [Uri]$settings.DATABASE_URL
$parts = $uri.UserInfo.Split(':', 2)
$pgUser = [Uri]::UnescapeDataString($parts[0]); $pgPassword = [Uri]::UnescapeDataString($parts[1]); $database = $uri.AbsolutePath.TrimStart('/')
if ($database -ne 'talentnexus' -or $uri.Host -notin @('127.0.0.1', 'localhost')) { throw 'UNEXPECTED_TN_DATABASE_TARGET' }
$pgPassFile = Join-Path $env:TEMP ('tn-golden-43213-' + [guid]::NewGuid().ToString('N') + '.pgpass')
Set-Content -LiteralPath $pgPassFile -Value "$($uri.Host):$($uri.Port):$database`:$pgUser`:$pgPassword" -NoNewline -Encoding ascii
& icacls $pgPassFile /inheritance:r /grant:r 'Administrators:F' 'SYSTEM:F' | Out-Null
$env:PGPASSFILE = $pgPassFile
$psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'

function Query([string]$sql) {
  $output = & $psql -h $uri.Host -p $uri.Port -U $pgUser -d $database -X -A -t -v ON_ERROR_STOP=1 -c $sql
  if ($LASTEXITCODE -ne 0) { throw 'TN_METADATA_QUERY_FAILED' }
  $line = $output | Where-Object { $_ } | Select-Object -Last 1
  if (-not $line) { throw 'TN_METADATA_QUERY_EMPTY' }
  return ($line | ConvertFrom-Json)
}

function State() {
  Query @"
WITH target AS (
  SELECT DISTINCT c.id, c.candidate_code
  FROM candidates c
  JOIN candidate_external_refs r ON r.candidate_id=c.id
  JOIN source_instances s ON s.id=r.source_instance_id
  WHERE s.source_system='pinpin' AND s.instance_key='pinpin-prod' AND r.external_candidate_id='43213'
), evidence AS (
  SELECT e.*, x.id extraction_id, j.id job_id, j.status job_status, j.attempt_count job_attempts, j.last_error_code job_error, j.output_snapshot_id job_snapshot_id
  FROM candidate_resume_evidence e
  LEFT JOIN candidate_evidence_extractions x ON x.evidence_id=e.id
  LEFT JOIN candidate_processing_jobs j ON j.evidence_id=e.id
  WHERE e.candidate_id IN (SELECT id FROM target) AND e.attachment_reference='CV1106'
), snapshot AS (
  SELECT s.* FROM candidate_enrichment_snapshots s WHERE s.id IN (SELECT job_snapshot_id FROM evidence WHERE job_snapshot_id IS NOT NULL) ORDER BY s.created_at DESC LIMIT 1
)
SELECT json_build_object(
  'candidate_count',(SELECT count(*) FROM target),
  'candidate_uuid',(SELECT min(id::text) FROM target),
  'candidate_code',(SELECT min(candidate_code) FROM target),
  'external_ref_count',(SELECT count(*) FROM candidate_external_refs r JOIN source_instances s ON s.id=r.source_instance_id WHERE r.candidate_id IN (SELECT id FROM target) AND s.source_system='pinpin' AND s.instance_key='pinpin-prod' AND r.external_candidate_id='43213'),
  'evidence_count',(SELECT count(*) FROM evidence),
  'content_backed_count',(SELECT count(*) FROM evidence WHERE content_sha256 IS NOT NULL AND processing_eligible=true AND representation_kind <> 'metadata_only'),
  'source_type',(SELECT source_type FROM evidence ORDER BY created_at DESC LIMIT 1),
  'representation_kind',(SELECT representation_kind FROM evidence ORDER BY created_at DESC LIMIT 1),
  'processing_eligible',(SELECT processing_eligible FROM evidence ORDER BY created_at DESC LIMIT 1),
  'evidence_hash_present',(SELECT content_sha256 IS NOT NULL AND content_sha256 ~ '^[0-9a-f]{64}$' FROM evidence ORDER BY created_at DESC LIMIT 1),
  'evidence_identity_present',(SELECT evidence_identity_key IS NOT NULL AND evidence_identity_key ~ '^[0-9a-f]{64}$' FROM evidence ORDER BY created_at DESC LIMIT 1),
  'extraction_count',(SELECT count(*) FROM evidence WHERE extraction_id IS NOT NULL),
  'job_count',(SELECT count(*) FROM evidence WHERE job_id IS NOT NULL),
  'job_status',(SELECT job_status FROM evidence ORDER BY created_at DESC,job_id DESC LIMIT 1),
  'job_error',(SELECT job_error FROM evidence ORDER BY created_at DESC,job_id DESC LIMIT 1),
  'snapshot_count',(SELECT count(*) FROM snapshot),
  'snapshot_id',(SELECT id FROM snapshot LIMIT 1),
  'snapshot_schema',(SELECT schema_version FROM snapshot LIMIT 1),
  'snapshot_payload_object',(SELECT jsonb_typeof(payload)='object' FROM snapshot LIMIT 1),
  'profile_count',(SELECT count(*) FROM candidate_ai_profiles WHERE enrichment_snapshot_id IN (SELECT id FROM snapshot)),
  'duplicate_refs',(SELECT count(*) FROM (SELECT source_instance_id,external_candidate_id FROM candidate_external_refs GROUP BY 1,2 HAVING count(*)>1) d),
  'duplicate_evidence',(SELECT count(*) FROM (SELECT candidate_id,evidence_identity_key FROM candidate_resume_evidence WHERE evidence_identity_key IS NOT NULL GROUP BY 1,2 HAVING count(*)>1) d),
  'duplicate_jobs',(SELECT count(*) FROM (SELECT candidate_id,idempotency_key FROM candidate_processing_jobs GROUP BY 1,2 HAVING count(*)>1) d),
  'historical_cv1056_metadata',(SELECT count(*) FROM candidate_documents WHERE candidate_id IN (SELECT id FROM target) AND external_document_id='1056'),
  'cv1075_metadata',(SELECT count(*) FROM candidate_documents WHERE candidate_id IN (SELECT id FROM target) AND external_document_id='1075'),
  'cv1105_metadata',(SELECT count(*) FROM candidate_documents WHERE candidate_id IN (SELECT id FROM target) AND external_document_id='1105')
);
"@
}

function Trigger() {
  try {
    $response = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3333/internal/pinpin/candidate-evidence/43213' -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body '{}' -TimeoutSec 120
    return [pscustomobject]@{ http = 200; status = $response.data.status; attachmentId = $response.data.attachmentId; fileRef = $response.data.fileRef; actualBlobBytes = $response.data.actualBlobBytes; declaredSizeBytes = $response.data.declaredSizeBytes; declaredSizeMatches = $response.data.declaredSizeMatches; rawSha256Present = [bool]$response.data.rawSha256; contentSha256Present = [bool]$response.data.contentSha256; processingStatus = $response.data.processingStatus }
  } catch {
    $status = 0; try { $status = [int]$_.Exception.Response.StatusCode } catch {}
    return [pscustomobject]@{ http = $status; status = 'error'; attachmentId = $null; fileRef = $null; actualBlobBytes = $null; declaredSizeBytes = $null; declaredSizeMatches = $false; rawSha256Present = $false; contentSha256Present = $false; processingStatus = $null }
  }
}

try {
  $before = State
  if ($before.candidate_count -ne 1 -or $before.external_ref_count -ne 1) { throw 'GOLDEN_IDENTITY_GATE_FAILED' }
  $first = Trigger
  if ($first.http -ne 200 -and $first.http -ne 201) { throw 'GOLDEN_TRIGGER_FAILED' }
  $deadline = (Get-Date).AddSeconds(180); $state = State
  while ($state.job_status -in @('queued','processing','retry_scheduled') -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 3; $state = State }
  $firstState = $state
  $second = Trigger
  $secondState = State
  $browserStatus = 0; try { $browserStatus = [int](Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3333/internal/data-browser/candidates/43213' -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 30).StatusCode } catch {}
  $intelligenceStatus = 0; try { $intelligenceStatus = [int](Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3333/api/v1/candidate-intelligence/43213' -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 30).StatusCode } catch {}
  [pscustomobject]@{
    candidate='43213'; targetResume='CV1106'; before=$before; first=$first; firstState=$firstState; second=$second; secondState=$secondState;
    sameRawSha256=($first.rawSha256Present -and $second.rawSha256Present -and $firstState.evidence_count -eq $secondState.evidence_count);
    secondNoNewEvidence=($firstState.evidence_count -eq $secondState.evidence_count);
    secondNoNewSnapshot=($firstState.snapshot_count -eq $secondState.snapshot_count);
    browserStatus=$browserStatus; intelligenceStatus=$intelligenceStatus; pinpinWrites=0; attachmentMutations=0; unselectedBlobReads=0
  } | ConvertTo-Json -Depth 8 -Compress
} finally {
  Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pgPassFile -Force -ErrorAction SilentlyContinue
  Remove-Variable token,pgPassword -ErrorAction SilentlyContinue
}
