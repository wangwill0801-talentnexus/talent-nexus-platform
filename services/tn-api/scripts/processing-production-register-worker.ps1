$ErrorActionPreference='Stop'
$taskName='TalentNexusProcessingWorker';$app='E:\TalentNexus\tn-api';$log='E:\TalentNexusLogs\tn-processing-worker.log'
if(-not(Test-Path -LiteralPath (Join-Path $app 'dist\processing-worker.js'))){throw 'Processing worker runtime unavailable.'}
$existing=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if($existing){throw 'Processing worker task already exists; refusing to replace it automatically.'}
$arguments='/d /c ""C:\Program Files\nodejs\node.exe" --env-file="E:\TalentNexus\config\tn-api.env" "E:\TalentNexus\tn-api\dist\processing-worker.js" >> "'+$log+'" 2>&1"'
$action=New-ScheduledTaskAction -Execute 'C:\Windows\System32\cmd.exe' -Argument $arguments
$trigger=New-ScheduledTaskTrigger -AtStartup
$principal=New-ScheduledTaskPrincipal -UserId 'LOCAL SERVICE' -LogonType ServiceAccount -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3
$task=Get-ScheduledTask -TaskName $taskName;$info=Get-ScheduledTaskInfo -TaskName $taskName
if($task.Principal.UserId -ne 'LOCAL SERVICE'){throw 'Unexpected worker identity.'}
[pscustomobject]@{taskName=$taskName;state=$task.State.ToString();userId=$task.Principal.UserId;runLevel=$task.Principal.RunLevel.ToString();lastResult=$info.LastTaskResult}|ConvertTo-Json -Compress
