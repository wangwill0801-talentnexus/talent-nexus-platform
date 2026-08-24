param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$ExpectedSha256,
  [Parameter(Mandatory = $true)][string]$Stamp
)

$ErrorActionPreference = 'Stop'
$appRoot = 'E:\TalentNexus\tn-api'
$dist = Join-Path $appRoot 'dist'
$backup = Join-Path $appRoot ("dist-previous-" + $Stamp)
$stage = Join-Path $appRoot ("staging-job-context-" + $Stamp)

if (-not (Test-Path -LiteralPath $ArchivePath)) { throw 'Release archive not found.' }
$actualSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $ArchivePath).Hash
if ($actualSha -ne $ExpectedSha256) { throw 'Release archive hash mismatch.' }
if (Test-Path -LiteralPath $backup) { throw 'Backup destination already exists.' }
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }

New-Item -ItemType Directory -Path $stage | Out-Null
Expand-Archive -LiteralPath $ArchivePath -DestinationPath $stage -Force
if (-not (Test-Path -LiteralPath (Join-Path $stage 'server.js'))) { throw 'Release archive is missing server.js.' }

try {
  Stop-ScheduledTask -TaskName 'TalentNexusApi' -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  if (Test-Path -LiteralPath $dist) { Move-Item -LiteralPath $dist -Destination $backup }
  Move-Item -LiteralPath $stage -Destination $dist
  Start-ScheduledTask -TaskName 'TalentNexusApi'
  $healthy = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3333/health' -TimeoutSec 3
      if ($response.StatusCode -eq 200) { $healthy = $true; break }
    } catch { }
  }
  if (-not $healthy) { throw 'TN API health check failed after deployment.' }
  $listener = Get-NetTCPConnection -LocalPort 3333 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalAddress
  if (($listener | Sort-Object -Unique) -ne '127.0.0.1') { throw 'TN API listener is not localhost-only.' }
  Write-Output ('DEPLOYED ' + $actualSha)
}
catch {
  Stop-ScheduledTask -TaskName 'TalentNexusApi' -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  if (Test-Path -LiteralPath $dist) { Remove-Item -LiteralPath $dist -Recurse -Force }
  if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $dist }
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  Start-ScheduledTask -TaskName 'TalentNexusApi'
  throw
}
