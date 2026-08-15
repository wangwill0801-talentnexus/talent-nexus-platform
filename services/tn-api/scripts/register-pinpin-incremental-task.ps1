$ErrorActionPreference = 'Stop'
$taskName = 'TalentNexusPinpinSync'
$node = 'C:\Program Files\nodejs\node.exe'
$entry = 'E:\TalentNexus\tn-api\dist\pinpin\incremental-sync.js'
$log = 'E:\TalentNexusLogs\tn-pinpin-sync.log'
foreach ($path in @($node, $entry)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required runtime path is missing: $path" } }
if (-not (Test-Path -LiteralPath (Split-Path -Parent $log))) { New-Item -ItemType Directory -Path (Split-Path -Parent $log) -Force | Out-Null }
$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + $entry + '" >> "' + $log + '" 2>&1')
$startup = New-ScheduledTaskTrigger -AtStartup
$interval = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Days 1)
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($startup, $interval) -Principal $principal -Settings $settings -Description 'Read-only Pinpin metadata incremental reconciliation for Talent Nexus.' -Force | Out-Null
$task = Get-ScheduledTask -TaskName $taskName
[pscustomobject]@{ taskName = $task.TaskName; state = $task.State; principal = $task.Principal.UserId; action = 'node incremental-sync.js'; intervalMinutes = 15 } | ConvertTo-Json -Compress
