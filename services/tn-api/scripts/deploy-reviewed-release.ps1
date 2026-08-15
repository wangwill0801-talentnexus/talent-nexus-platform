param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$ExpectedSha256
)

$ErrorActionPreference = 'Stop'
$appRoot = 'E:\TalentNexus\tn-api'
$taskName = 'TalentNexusApi'
$archive = (Resolve-Path -LiteralPath $ArchivePath).Path
$resolvedAppRoot = (Resolve-Path -LiteralPath $appRoot).Path
if ($resolvedAppRoot -ne $appRoot) { throw 'Unexpected TN application path.' }
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $ExpectedSha256) { throw 'Release hash mismatch.' }

$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$stage = "E:\TalentNexus\deploy-stage-$stamp"
$backup = "E:\TalentNexus\backup-$stamp"
New-Item -ItemType Directory -Path $stage | Out-Null
New-Item -ItemType Directory -Path $backup | Out-Null
try {
  Expand-Archive -LiteralPath $archive -DestinationPath $stage
  foreach ($required in @('dist\server.js', 'dist\pinpin\manual-sync.js', 'package.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $stage $required))) { throw "Release missing $required" }
  }
  Copy-Item -LiteralPath (Join-Path $appRoot 'dist') -Destination (Join-Path $backup 'dist') -Recurse
  Copy-Item -LiteralPath (Join-Path $appRoot 'src') -Destination (Join-Path $backup 'src') -Recurse
  Copy-Item -LiteralPath (Join-Path $appRoot 'package.json') -Destination (Join-Path $backup 'package.json')
  Stop-ScheduledTask -TaskName $taskName
  Start-Sleep -Seconds 2
  Copy-Item -Path (Join-Path $stage 'dist\*') -Destination (Join-Path $appRoot 'dist') -Recurse -Force
  Copy-Item -Path (Join-Path $stage 'src\*') -Destination (Join-Path $appRoot 'src') -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $stage 'package.json') -Destination (Join-Path $appRoot 'package.json') -Force
  Start-ScheduledTask -TaskName $taskName
  Start-Sleep -Seconds 3
  $state = (Get-ScheduledTask -TaskName $taskName).State
  if ($state -ne 'Running') { throw 'TalentNexusApi did not return to Running.' }
  [pscustomobject]@{ status = 'deployed'; backup = $backup; task = $state; archiveSha256 = $ExpectedSha256 } | ConvertTo-Json -Compress
} catch {
  try { Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue } catch { }
  throw
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}
