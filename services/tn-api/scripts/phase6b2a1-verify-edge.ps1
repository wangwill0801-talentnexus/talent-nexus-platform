# Non-PII verification of the TN public HTTPS edge. Secrets are used only in memory and never emitted.
$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

function Get-HttpStatus {
  param([string]$Uri, [string]$Method = 'GET', [hashtable]$Headers = @{}, [string]$Body = $null)
  try {
    $parameters = @{ Uri = $Uri; Method = $Method; Headers = $Headers; UseBasicParsing = $true; TimeoutSec = 30; ErrorAction = 'Stop' }
    if (-not [string]::IsNullOrEmpty($Body)) { $parameters['Body'] = $Body; $parameters['ContentType'] = 'application/json' }
    $response = Invoke-WebRequest @parameters
    return [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) { return [int]$_.Exception.Response.StatusCode }
    throw
  }
}

$envPath = 'E:\TalentNexus\config\tn-api.env'
$tokenLine = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^TN_API_TOKEN=' } | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($tokenLine)) { throw 'TN API token is missing from protected runtime configuration' }
$token = $tokenLine.Substring('TN_API_TOKEN='.Length)

$publicBase = 'https://tn-api.talentnexus.com.tw'
$siteName = 'TalentNexusApiEdge'
$cert = Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.Subject -eq 'CN=tn-api.talentnexus.com.tw' } | Sort-Object NotAfter -Descending | Select-Object -First 1
$task = Get-ScheduledTask -TaskName 'win-acme renew (acme-v02.api.letsencrypt.org)' -ErrorAction Stop
$listeners = Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 3333,5432,1433 } | Select-Object LocalAddress,LocalPort

[pscustomobject]@{
  publicHealth = Get-HttpStatus -Uri "$publicBase/health"
  localHealth = Get-HttpStatus -Uri 'http://127.0.0.1:3333/health'
  authorizationForwarded = (Get-HttpStatus -Uri "$publicBase/api/v1/candidates?limit=1" -Headers @{ Authorization = "Bearer $token" }) -eq 200
  unauthenticatedSidecarStatus = Get-HttpStatus -Uri "$publicBase/internal/plugin-sidecar/v1/candidate-enrichment" -Method 'POST' -Body '{}'
  certificateSubject = if ($cert) { $cert.Subject } else { 'Missing' }
  certificateIssuer = if ($cert) { $cert.Issuer } else { 'Missing' }
  certificateExpires = if ($cert) { $cert.NotAfter.ToUniversalTime().ToString('yyyy-MM-dd') } else { 'Missing' }
  renewalTaskState = $task.State.ToString()
  httpsBinding = (Get-WebBinding -Name $siteName -Protocol https | Select-Object -First 1).bindingInformation
  localProtectedListeners = @($listeners)
  pinpinZh = Get-HttpStatus -Uri 'http://127.0.0.1:5679/webapp/'
  pinpinEn = Get-HttpStatus -Uri 'http://127.0.0.1:5678/webapp/'
} | ConvertTo-Json -Depth 4 -Compress
