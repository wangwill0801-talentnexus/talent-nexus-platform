# Verifies only HTTP status contracts. It never prints or returns the internal bearer token.
$ErrorActionPreference = 'Stop'

function Get-HttpStatus([string]$uri, [hashtable]$headers = @{}) {
  try {
    return (Invoke-WebRequest -UseBasicParsing -Uri $uri -Method Post -ContentType 'application/json' -Headers $headers -Body '{}' -TimeoutSec 15).StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    throw
  }
}

$tokenLine = Get-Content -LiteralPath 'E:\TalentNexus\config\tn-api.env' | Where-Object { $_ -match '^TN_API_TOKEN=' } | Select-Object -First 1
if (-not $tokenLine) { throw 'Internal token configuration is unavailable.' }
$internalToken = $tokenLine.Substring('TN_API_TOKEN='.Length)
$headers = @{ Authorization = "Bearer $internalToken" }
$sqlServer = Get-Service -Name 'MSSQLSERVER' -ErrorAction SilentlyContinue | Select-Object -First 1

[pscustomobject]@{
  publicWithInternalTokenStatus = Get-HttpStatus 'https://tn-api.talentnexus.com.tw/api/v1/plugin-sidecar/candidate-enrichment' $headers
  publicInternalRouteWithInternalTokenStatus = Get-HttpStatus 'https://tn-api.talentnexus.com.tw/internal/plugin-sidecar/v1/candidate-enrichment' $headers
  internalWithInternalTokenStatus = Get-HttpStatus 'http://127.0.0.1:3333/internal/plugin-sidecar/v1/candidate-enrichment' $headers
  iisRunning = (Get-Service -Name W3SVC).Status.ToString()
  sqlServerRunning = if ($sqlServer) { $sqlServer.Status.ToString() } else { 'Unknown' }
  postgresqlRunning = (Get-Service -Name 'postgresql-x64-17').Status.ToString()
} | ConvertTo-Json -Compress
