$ErrorActionPreference = 'Stop'
$envPath = 'E:\TalentNexus\config\tn-api.env'
$line = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^TN_API_TOKEN=' } | Select-Object -First 1
if (-not $line) { throw 'Internal token configuration is unavailable.' }
$token = $line.Substring('TN_API_TOKEN='.Length)
$headers = @{ Authorization = "Bearer $token" }
$base = 'http://127.0.0.1:3333'

function Status([string]$uri, [string]$method, [hashtable]$requestHeaders = @{}, [string]$body = $null) {
  try {
    $params = @{ UseBasicParsing = $true; Uri = $uri; Method = $method; Headers = $requestHeaders; TimeoutSec = 15 }
    if ($method -eq 'POST') { $params.ContentType = 'application/json'; $params.Body = [string]$body }
    return (Invoke-WebRequest @params).StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    throw
  }
}

[pscustomobject]@{
  health = Status "$base/health" 'GET'
  jobUnauthorized = Status "$base/api/v1/jobs/106" 'GET'
  invalidContext = Status "$base/api/v1/jobs/context" 'POST' $headers '{"sourceSystem":"pinpin","sourceInstance":"pinpin-prod","externalJobId":"not-a-job"}'
  job106 = Status "$base/api/v1/jobs/106" 'GET' $headers
  jobSearch106 = Status "$base/api/v1/jobs/106/search" 'POST' $headers '{}'
  candidateList = Status "$base/api/v1/candidates" 'GET' $headers
  searchCoverage = Status "$base/api/v1/talent-search/coverage" 'GET' $headers
  unknownCandidate = Status "$base/api/v1/talent-search/candidates/999999999" 'GET' $headers
} | ConvertTo-Json -Compress
