# Read-only status check for the approved win-acme installation.
$ErrorActionPreference = 'Stop'
$wacs = 'E:\TalentNexus\win-acme\wacs.exe'
$exists = Test-Path $wacs
$signature = if ($exists) { (Get-AuthenticodeSignature -FilePath $wacs).Status.ToString() } else { 'Missing' }
$files = if (Test-Path 'E:\TalentNexus\win-acme') { @(Get-ChildItem 'E:\TalentNexus\win-acme' -File | Select-Object -First 5 -ExpandProperty Name) } else { @() }
[pscustomobject]@{ exists = $exists; signature = $signature; sampleFiles = $files } | ConvertTo-Json -Compress
