$ErrorActionPreference='Stop'
$apiTask=Get-ScheduledTask -TaskName 'TalentNexusApi'
$workerTask=Get-ScheduledTask -TaskName 'TalentNexusProcessingWorker' -ErrorAction SilentlyContinue
$listeners=Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(3333,5432,1433) } | Select-Object LocalAddress,LocalPort
[pscustomobject]@{
  apiTask=[pscustomobject]@{state=$apiTask.State.ToString();userId=$apiTask.Principal.UserId;logonType=$apiTask.Principal.LogonType.ToString();runLevel=$apiTask.Principal.RunLevel.ToString()}
  workerTask=if($workerTask){[pscustomobject]@{state=$workerTask.State.ToString();userId=$workerTask.Principal.UserId;logonType=$workerTask.Principal.LogonType.ToString();runLevel=$workerTask.Principal.RunLevel.ToString()}}else{$null}
  listeners=$listeners
  postgres=(Get-Service postgresql-x64-17 | Select-Object Name,Status,StartType)
  iis=(Get-Service W3SVC | Select-Object Name,Status,StartType)
  sql=(Get-Service MSSQLSERVER | Select-Object Name,Status,StartType)
} | ConvertTo-Json -Depth 5 -Compress
