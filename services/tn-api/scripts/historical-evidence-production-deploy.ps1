param(
  [Parameter(Mandatory=$true)][string]$ReleaseZip,
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9A-Fa-f]{64}$')][string]$ExpectedSha256
)
$ErrorActionPreference='Stop'
$appRoot='E:\TalentNexus\tn-api';$deployRoot='E:\TalentNexus\deploy';$stamp=Get-Date -Format 'yyyyMMdd_HHmmss'
$staging=Join-Path $deployRoot "historical-evidence-$stamp";$rollback=Join-Path $deployRoot "historical-evidence-rollback-$stamp"
if(-not(Test-Path -LiteralPath $ReleaseZip)){throw 'Release archive unavailable.'}
$actual=(Get-FileHash -LiteralPath $ReleaseZip -Algorithm SHA256).Hash
if($actual-ne$ExpectedSha256.ToUpperInvariant()){throw 'Release archive hash mismatch.'}
New-Item -ItemType Directory -Path $staging,$rollback -Force|Out-Null
Expand-Archive -LiteralPath $ReleaseZip -DestinationPath $staging -Force
foreach($required in @('dist\server.js','dist\processing-worker.js','migrations\005_historical_evidence_bridge.sql','package.json')){if(-not(Test-Path(Join-Path $staging $required))){throw "Release structure invalid: $required"}}
foreach($item in @('dist','src','migrations')){Copy-Item -LiteralPath(Join-Path $appRoot $item)-Destination(Join-Path $rollback $item)-Recurse}
Copy-Item -LiteralPath(Join-Path $appRoot 'package.json')-Destination(Join-Path $rollback 'package.json')
function Wait-Api([int]$expected){$deadline=(Get-Date).AddSeconds(35);do{Start-Sleep -Seconds 1;try{$status=(Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3333/health' -TimeoutSec 3).StatusCode}catch{$status=0}}while($status-ne$expected-and(Get-Date)-lt$deadline);return $status}
try{
  Copy-Item -Path(Join-Path $staging 'migrations\*')-Destination(Join-Path $appRoot 'migrations')-Force
  Push-Location $appRoot
  try{&'C:\Program Files\nodejs\node.exe' '--env-file=E:\TalentNexus\config\tn-api.env' 'dist\migrate.js';if($LASTEXITCODE-ne 0){throw 'Migration execution failed.'}}finally{Pop-Location}
  Stop-ScheduledTask -TaskName 'TalentNexusProcessingWorker' -ErrorAction SilentlyContinue
  Stop-ScheduledTask -TaskName 'TalentNexusApi';if((Wait-Api 0)-ne 0){throw 'TN API did not stop.'}
  Copy-Item -Path(Join-Path $staging 'dist\*')-Destination(Join-Path $appRoot 'dist')-Recurse -Force
  Copy-Item -Path(Join-Path $staging 'src\*')-Destination(Join-Path $appRoot 'src')-Recurse -Force
  Copy-Item -LiteralPath(Join-Path $staging 'package.json')-Destination(Join-Path $appRoot 'package.json')-Force
  $aiConfig='E:\TalentNexus\config\tn-ai.env'
  if(Test-Path -LiteralPath $aiConfig){&icacls $aiConfig /grant:r 'LOCAL SERVICE:R'|Out-Null}
  Start-ScheduledTask -TaskName 'TalentNexusApi';if((Wait-Api 200)-ne 200){throw 'TN API health validation failed.'}
  Start-ScheduledTask -TaskName 'TalentNexusProcessingWorker'
  $listener=Get-NetTCPConnection -State Listen -LocalPort 3333|Where-Object LocalAddress -eq '127.0.0.1'|Select-Object -First 1
  if(-not$listener){throw 'TN API listener boundary failed.'}
  [pscustomobject]@{status='deployed';migration='005_historical_evidence_bridge.sql';health=200;localOnly=$true;releaseHash=$actual;rollbackDirectory=(Split-Path $rollback -Leaf);worker=(Get-ScheduledTask -TaskName 'TalentNexusProcessingWorker').State.ToString()}|ConvertTo-Json -Compress
}catch{
  Stop-ScheduledTask -TaskName 'TalentNexusProcessingWorker' -ErrorAction SilentlyContinue
  Stop-ScheduledTask -TaskName 'TalentNexusApi' -ErrorAction SilentlyContinue
  foreach($item in @('dist','src')){Copy-Item -Path(Join-Path $rollback "$item\*")-Destination(Join-Path $appRoot $item)-Recurse -Force}
  Copy-Item -Path(Join-Path $rollback 'migrations\*')-Destination(Join-Path $appRoot 'migrations')-Force
  Copy-Item -LiteralPath(Join-Path $rollback 'package.json')-Destination(Join-Path $appRoot 'package.json')-Force
  Start-ScheduledTask -TaskName 'TalentNexusApi'
  Start-ScheduledTask -TaskName 'TalentNexusProcessingWorker' -ErrorAction SilentlyContinue
  throw
}
