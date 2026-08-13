# Runs previously approved synthetic-only TN regressions. No Pinpin write or BLOB read is performed.
$ErrorActionPreference = 'Stop'
Set-Location 'E:\TalentNexus\tn-api'

function Invoke-NodeJson([string]$scriptPath) {
  $output = & 'C:\Program Files\nodejs\node.exe' $scriptPath 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Regression failed: $scriptPath" }
  return ($output | Select-Object -Last 1)
}

[pscustomobject]@{
  aiCheck = Invoke-NodeJson 'dist\ai\ai-check.js'
  enrichment = Invoke-NodeJson 'dist\services\enrichment-controlled-verify.js'
  sidecar = Invoke-NodeJson 'dist\services\plugin-sidecar-controlled-verify.js'
} | ConvertTo-Json -Compress
