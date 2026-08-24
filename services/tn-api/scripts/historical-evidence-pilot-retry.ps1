param([Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f-]{36}$')][string]$JobId)
$ErrorActionPreference = 'Stop'
$tokenLine = Get-Content -LiteralPath 'E:\TalentNexus\config\tn-api.env' | Where-Object { $_ -match '^TN_API_TOKEN=' } | Select-Object -First 1
if (-not $tokenLine) { throw 'TN API bearer configuration unavailable.' }
$token = ($tokenLine -replace '^TN_API_TOKEN=','').Trim().Trim('"').Trim("'")
if (-not $token) { throw 'TN API bearer configuration invalid.' }
$headers = @{ Authorization = 'Bearer ' + $token }
try {
  $response = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3333/internal/data-browser/processing/$JobId/retry" -Headers $headers -ContentType 'application/json' -Body '{}'
  [pscustomobject]@{ status = 'retry_requested'; jobStatus = [string]$response.data.status; operation = [string]$response.data.operation } | ConvertTo-Json -Compress
} catch {
  throw 'Pilot retry request failed.'
}
