$ErrorActionPreference = 'Stop'
$task = Get-ScheduledTask -TaskName 'TalentNexusApi'
$taskInfo = Get-ScheduledTaskInfo -TaskName 'TalentNexusApi'
$listeners = Get-NetTCPConnection -State Listen -LocalPort 3333,5432 -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess
$services = Get-Service postgresql-x64-17,W3SVC,MSSQLSERVER | Select-Object Name,Status,StartType
$nodeVersion = & 'C:\Program Files\nodejs\node.exe' --version
[pscustomobject]@{
  taskState=$task.State.ToString(); taskLastResult=$taskInfo.LastTaskResult; taskActions=@($task.Actions | Select-Object Execute,Arguments,WorkingDirectory)
  services=$services; listeners=$listeners; node=$nodeVersion
  appFiles=@(Get-ChildItem 'E:\TalentNexus\tn-api' -Force | Select-Object Name,Length,Mode)
  migrationFiles=@(Get-ChildItem 'E:\TalentNexus\tn-api\migrations' -File | Select-Object Name,Length)
} | ConvertTo-Json -Depth 5 -Compress
