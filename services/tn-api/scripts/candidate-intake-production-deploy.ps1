param(
  [Parameter(Mandatory=$true)][string]$ReleaseZip,
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9A-Fa-f]{64}$')][string]$ExpectedSha256
)
$ErrorActionPreference='Stop'
$appRoot='E:\TalentNexus\tn-api'
$deployRoot='E:\TalentNexus\deploy'
$stamp=Get-Date -Format 'yyyyMMdd_HHmmss'
$staging=Join-Path $deployRoot "candidate-intake-$stamp"
$previous="E:\TalentNexus\tn-api.pre-candidate-intake-$stamp"
if (-not (Test-Path -LiteralPath $ReleaseZip)) { throw 'Release archive unavailable.' }
$actual=(Get-FileHash -LiteralPath $ReleaseZip -Algorithm SHA256).Hash
if ($actual -ne $ExpectedSha256.ToUpperInvariant()) { throw 'Release archive hash mismatch.' }
New-Item -ItemType Directory -Path $deployRoot -Force | Out-Null
New-Item -ItemType Directory -Path $staging -Force | Out-Null
Expand-Archive -LiteralPath $ReleaseZip -DestinationPath $staging -Force
if (-not (Test-Path (Join-Path $staging 'dist\server.js')) -or -not (Test-Path (Join-Path $staging 'migrations\003_candidate_intake_foundation.sql'))) { throw 'Release structure invalid.' }
Push-Location $staging
try {
  & 'C:\Program Files\nodejs\npm.cmd' install --omit=dev --ignore-scripts
  if ($LASTEXITCODE -ne 0) { throw 'Production dependencies failed.' }
  & 'C:\Program Files\nodejs\node.exe' '--env-file=E:\TalentNexus\config\tn-api.env' 'dist\migrate.js'
  if ($LASTEXITCODE -ne 0) { throw 'Migration execution failed.' }
} finally { Pop-Location }

$swapped=$false
try {
  Stop-ScheduledTask -TaskName 'TalentNexusApi'
  Start-Sleep -Seconds 2
  Move-Item -LiteralPath $appRoot -Destination $previous
  Move-Item -LiteralPath $staging -Destination $appRoot
  $swapped=$true
  Start-ScheduledTask -TaskName 'TalentNexusApi'
  Start-Sleep -Seconds 6
  $health=(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3333/health' -TimeoutSec 10).StatusCode
  $listener=Get-NetTCPConnection -State Listen -LocalPort 3333 -ErrorAction Stop | Where-Object LocalAddress -eq '127.0.0.1' | Select-Object -First 1
  if ($health -ne 200 -or -not $listener) { throw 'New TN API health validation failed.' }
  [pscustomobject]@{status='deployed';migration='003_candidate_intake_foundation.sql';health=$health;localOnly=$true;previousDirectory=(Split-Path $previous -Leaf);releaseHash=$actual} | ConvertTo-Json -Compress
} catch {
  if ($swapped) {
    Stop-ScheduledTask -TaskName 'TalentNexusApi' -ErrorAction SilentlyContinue
    if (Test-Path $appRoot) { Move-Item $appRoot "$appRoot.failed-$stamp" }
    Move-Item $previous $appRoot
    Start-ScheduledTask -TaskName 'TalentNexusApi'
  }
  throw
}
