$ErrorActionPreference = 'Stop'

$listener = Get-NetTCPConnection -State Listen -LocalPort 3333 -ErrorAction SilentlyContinue |
  Where-Object { $_.LocalAddress -eq '127.0.0.1' } |
  Select-Object -First 1
if ($listener) { 'TN_LISTENER=LOCALHOST_ONLY' } else { 'TN_LISTENER=ABSENT' }

try {
  $response = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3333/health' -TimeoutSec 10
  "TN_HEALTH=$($response.StatusCode)"
} catch {
  'TN_HEALTH=UNREACHABLE'
}

if (Test-Path 'E:\TalentNexusLogs\tn-api.log') {
  $tail = Get-Content 'E:\TalentNexusLogs\tn-api.log' -Tail 12 -ErrorAction SilentlyContinue
  if ($tail -match 'EPERM|Error:|ERR_') { 'TN_LOG_HAS_RECENT_RUNTIME_ERROR=YES' } else { 'TN_LOG_HAS_RECENT_RUNTIME_ERROR=NO' }
}
