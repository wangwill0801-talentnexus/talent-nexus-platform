param(
  [Parameter(Mandatory=$true)][string]$ReleaseZip,
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9A-Fa-f]{64}$')][string]$ExpectedSha256
)
$ErrorActionPreference='Stop'
$appRoot='E:\TalentNexus\tn-api'
$deployRoot='E:\TalentNexus\deploy'
$stamp=Get-Date -Format 'yyyyMMdd_HHmmss'
$staging=Join-Path $deployRoot "candidate-intake-hotfix-$stamp"
$rollback=Join-Path $deployRoot "candidate-intake-hotfix-rollback-$stamp"

if (-not (Test-Path -LiteralPath $ReleaseZip)) { throw 'Release archive unavailable.' }
$actual=(Get-FileHash -LiteralPath $ReleaseZip -Algorithm SHA256).Hash
if ($actual -ne $ExpectedSha256.ToUpperInvariant()) { throw 'Release archive hash mismatch.' }
New-Item -ItemType Directory -Path $staging -Force | Out-Null
New-Item -ItemType Directory -Path $rollback -Force | Out-Null
Expand-Archive -LiteralPath $ReleaseZip -DestinationPath $staging -Force
if (-not (Test-Path (Join-Path $staging 'dist\server.js')) -or
    -not (Test-Path (Join-Path $staging 'dist\services\candidate-intake-production-verify.js'))) {
  throw 'Release structure invalid.'
}

function Wait-TnListenerExit {
  $deadline=(Get-Date).AddSeconds(30)
  do {
    $listener=Get-NetTCPConnection -State Listen -LocalPort 3333 -ErrorAction SilentlyContinue
    if (-not $listener) { return }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  throw 'TN API did not stop within the safe deployment window.'
}

Copy-Item -LiteralPath (Join-Path $appRoot 'dist') -Destination (Join-Path $rollback 'dist') -Recurse
Copy-Item -LiteralPath (Join-Path $appRoot 'src') -Destination (Join-Path $rollback 'src') -Recurse
Copy-Item -LiteralPath (Join-Path $appRoot 'package.json') -Destination (Join-Path $rollback 'package.json')

try {
  Stop-ScheduledTask -TaskName 'TalentNexusApi'
  Wait-TnListenerExit
  Copy-Item -Path (Join-Path $staging 'dist\*') -Destination (Join-Path $appRoot 'dist') -Recurse -Force
  Copy-Item -Path (Join-Path $staging 'src\*') -Destination (Join-Path $appRoot 'src') -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $staging 'package.json') -Destination (Join-Path $appRoot 'package.json') -Force
  Start-ScheduledTask -TaskName 'TalentNexusApi'
  $deadline=(Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Seconds 1
    try { $health=(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3333/health' -TimeoutSec 3).StatusCode } catch { $health=0 }
  } while ($health -ne 200 -and (Get-Date) -lt $deadline)
  $listener=Get-NetTCPConnection -State Listen -LocalPort 3333 -ErrorAction Stop | Where-Object LocalAddress -eq '127.0.0.1' | Select-Object -First 1
  if ($health -ne 200 -or -not $listener) { throw 'Updated TN API health validation failed.' }
  [pscustomobject]@{status='deployed';health=$health;localOnly=$true;releaseHash=$actual;rollbackDirectory=(Split-Path $rollback -Leaf)} | ConvertTo-Json -Compress
} catch {
  Stop-ScheduledTask -TaskName 'TalentNexusApi' -ErrorAction SilentlyContinue
  Wait-TnListenerExit
  Copy-Item -Path (Join-Path $rollback 'dist\*') -Destination (Join-Path $appRoot 'dist') -Recurse -Force
  Copy-Item -Path (Join-Path $rollback 'src\*') -Destination (Join-Path $appRoot 'src') -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $rollback 'package.json') -Destination (Join-Path $appRoot 'package.json') -Force
  Start-ScheduledTask -TaskName 'TalentNexusApi'
  throw
}
