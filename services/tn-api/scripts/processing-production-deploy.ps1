param(
  [Parameter(Mandatory=$true)][string]$ReleaseZip,
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9A-Fa-f]{64}$')][string]$ExpectedSha256
)
$ErrorActionPreference='Stop'
$appRoot='E:\TalentNexus\tn-api';$deployRoot='E:\TalentNexus\deploy';$stamp=Get-Date -Format 'yyyyMMdd_HHmmss'
$staging=Join-Path $deployRoot "processing-$stamp";$rollback=Join-Path $deployRoot "processing-rollback-$stamp"
if(-not(Test-Path -LiteralPath $ReleaseZip)){throw 'Release archive unavailable.'}
$actual=(Get-FileHash -LiteralPath $ReleaseZip -Algorithm SHA256).Hash
if($actual -ne $ExpectedSha256.ToUpperInvariant()){throw 'Release archive hash mismatch.'}
New-Item -ItemType Directory -Path $staging,$rollback -Force | Out-Null
Expand-Archive -LiteralPath $ReleaseZip -DestinationPath $staging -Force
foreach($required in @('dist\server.js','dist\processing-worker.js','migrations\004_candidate_evidence_processing.sql','package.json')){if(-not(Test-Path (Join-Path $staging $required))){throw "Release structure invalid: $required"}}
Copy-Item -LiteralPath (Join-Path $appRoot 'dist') -Destination (Join-Path $rollback 'dist') -Recurse
Copy-Item -LiteralPath (Join-Path $appRoot 'src') -Destination (Join-Path $rollback 'src') -Recurse
Copy-Item -LiteralPath (Join-Path $appRoot 'migrations') -Destination (Join-Path $rollback 'migrations') -Recurse
Copy-Item -LiteralPath (Join-Path $appRoot 'package.json') -Destination (Join-Path $rollback 'package.json')

function Wait-Api([int]$expected){$deadline=(Get-Date).AddSeconds(30);do{Start-Sleep -Seconds 1;try{$status=(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3333/health' -TimeoutSec 3).StatusCode}catch{$status=0}}while($status-ne$expected-and(Get-Date)-lt$deadline);return $status}
try{
  Copy-Item -Path (Join-Path $staging 'migrations\*') -Destination (Join-Path $appRoot 'migrations') -Force
  Push-Location $appRoot
  try{& 'C:\Program Files\nodejs\node.exe' '--env-file=E:\TalentNexus\config\tn-api.env' 'dist\migrate.js';if($LASTEXITCODE-ne 0){throw 'Migration execution failed.'}}finally{Pop-Location}
  Stop-ScheduledTask -TaskName 'TalentNexusApi';if((Wait-Api 0)-ne 0){throw 'TN API did not stop.'}
  Copy-Item -Path (Join-Path $staging 'dist\*') -Destination (Join-Path $appRoot 'dist') -Recurse -Force
  Copy-Item -Path (Join-Path $staging 'src\*') -Destination (Join-Path $appRoot 'src') -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $staging 'package.json') -Destination (Join-Path $appRoot 'package.json') -Force
  Start-ScheduledTask -TaskName 'TalentNexusApi';if((Wait-Api 200)-ne 200){throw 'Updated TN API health validation failed.'}
  $listener=Get-NetTCPConnection -State Listen -LocalPort 3333 | Where-Object LocalAddress -eq '127.0.0.1' | Select-Object -First 1
  if(-not$listener){throw 'TN API listener boundary failed.'}
  [pscustomobject]@{status='deployed';migration='004_candidate_evidence_processing.sql';health=200;localOnly=$true;releaseHash=$actual;rollbackDirectory=(Split-Path $rollback -Leaf)}|ConvertTo-Json -Compress
}catch{
  Stop-ScheduledTask -TaskName 'TalentNexusApi' -ErrorAction SilentlyContinue
  Copy-Item -Path (Join-Path $rollback 'dist\*') -Destination (Join-Path $appRoot 'dist') -Recurse -Force
  Copy-Item -Path (Join-Path $rollback 'src\*') -Destination (Join-Path $appRoot 'src') -Recurse -Force
  Copy-Item -Path (Join-Path $rollback 'migrations\*') -Destination (Join-Path $appRoot 'migrations') -Force
  Copy-Item -LiteralPath (Join-Path $rollback 'package.json') -Destination (Join-Path $appRoot 'package.json') -Force
  Start-ScheduledTask -TaskName 'TalentNexusApi';throw
}
