$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$apiRoot = Join-Path $repoRoot 'services\tn-api'
$releaseDir = Join-Path $apiRoot 'releases'
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ('tn-api-blob-release-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
  foreach ($item in @('dist', 'src', 'migrations')) { Copy-Item -LiteralPath (Join-Path $apiRoot $item) -Destination (Join-Path $stage $item) -Recurse }
  Copy-Item -LiteralPath (Join-Path $apiRoot 'package.json') -Destination (Join-Path $stage 'package.json')
  $zip = Join-Path $releaseDir 'tn-api-controlled-pinpin-blob-0604e0e.zip'
  if (Test-Path -LiteralPath $zip) { $zip = Join-Path $releaseDir ('tn-api-controlled-pinpin-blob-0604e0e-' + (Get-Date -Format 'yyyyMMddHHmmss') + '.zip') }
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
  $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
  Set-Content -LiteralPath ($zip + '.sha256') -Value ($hash + '  ' + (Split-Path $zip -Leaf)) -Encoding ascii
  [pscustomobject]@{ zip = $zip; sha256 = $hash; commit = (& git -C $repoRoot rev-parse HEAD) } | ConvertTo-Json -Compress
} finally { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }

