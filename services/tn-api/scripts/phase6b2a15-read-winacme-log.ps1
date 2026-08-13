# Reads only recent win-acme diagnostic lines relevant to filesystem validation.
$ErrorActionPreference = 'Stop'
$root = 'C:\ProgramData\win-acme'
$log = Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction Stop |
  Where-Object { $_.Extension -in '.log','.txt' } |
  Sort-Object LastWriteTimeUtc -Descending |
  Select-Object -First 1
if ($null -eq $log) { throw 'No win-acme log file found' }
$lines = Get-Content -LiteralPath $log.FullName |
  Select-String -Pattern 'ats\.talentnexus\.com\.tw|FileSystem|webroot|well-known|challenge|validation|NotFound' |
  Select-Object -Last 80 |
  ForEach-Object { $_.Line }
[pscustomobject]@{ logFile = $log.Name; lines = @($lines) } | ConvertTo-Json -Depth 3 -Compress
