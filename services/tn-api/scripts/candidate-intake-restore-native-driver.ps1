$ErrorActionPreference='Stop'
$source='E:\TalentNexus\tn-api.pre-candidate-intake-20260813_160343\node_modules\msnodesqlv8\build'
$target='E:\TalentNexus\tn-api\node_modules\msnodesqlv8\build'
if (-not (Test-Path -LiteralPath (Join-Path $source 'Release\sqlserver.node'))) {
  throw 'Previously validated native SQL driver is unavailable.'
}
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force
if (-not (Test-Path -LiteralPath (Join-Path $target 'Release\sqlserver.node'))) {
  throw 'Native SQL driver restore verification failed.'
}
[pscustomobject]@{restored=$true;source='previous-validated-runtime';target='current-tn-api-runtime'} | ConvertTo-Json -Compress
