# Read-only production verification for the deployed TN Entra resource server.
$ErrorActionPreference = 'Stop'

$configPath = 'E:\TalentNexus\config\tn-entra.env'
$task = Get-ScheduledTask -TaskName 'TalentNexusApi'
$listener = Get-NetTCPConnection -State Listen -LocalPort 3333 -ErrorAction SilentlyContinue | Select-Object -First 1
function Get-HttpStatus([string]$uri, [hashtable]$headers = @{}) {
  try {
    return (Invoke-WebRequest -UseBasicParsing -Uri $uri -Method Post -ContentType 'application/json' -Headers $headers -Body '{}' -TimeoutSec 15).StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    throw
  }
}

$health = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3333/health' -TimeoutSec 15
$missingTokenStatus = Get-HttpStatus 'https://tn-api.talentnexus.com.tw/api/v1/plugin-sidecar/candidate-enrichment'
$garbageTokenStatus = Get-HttpStatus 'https://tn-api.talentnexus.com.tw/api/v1/plugin-sidecar/candidate-enrichment' @{ Authorization = 'Bearer invalid-token' }

[pscustomobject]@{
  runtimeConfigExists = Test-Path -LiteralPath $configPath -PathType Leaf
  taskState = $task.State.ToString()
  apiLocalOnly = $null -ne $listener -and $listener.LocalAddress.ToString() -eq '127.0.0.1'
  healthStatus = $health.StatusCode
  publicNoTokenStatus = $missingTokenStatus
  publicGarbageTokenStatus = $garbageTokenStatus
} | ConvertTo-Json -Compress
