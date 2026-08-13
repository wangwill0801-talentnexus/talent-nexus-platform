# Installs only the reviewed runtime dependency and restarts the approved TN API task.
$ErrorActionPreference = 'Stop'
Set-Location 'E:\TalentNexus\tn-api'

& 'C:\Program Files\nodejs\npm.cmd' install --omit=dev --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw 'TN API runtime dependency installation failed.' }

Stop-ScheduledTask -TaskName 'TalentNexusApi'
Start-Sleep -Seconds 2
Start-ScheduledTask -TaskName 'TalentNexusApi'
Start-Sleep -Seconds 5

$task = Get-ScheduledTask -TaskName 'TalentNexusApi'
$listener = Get-NetTCPConnection -State Listen -LocalPort 3333 -ErrorAction SilentlyContinue | Select-Object -First 1
[pscustomobject]@{
  taskState = $task.State.ToString()
  apiLocalOnly = $null -ne $listener -and $listener.LocalAddress.ToString() -eq '127.0.0.1'
} | ConvertTo-Json -Compress
