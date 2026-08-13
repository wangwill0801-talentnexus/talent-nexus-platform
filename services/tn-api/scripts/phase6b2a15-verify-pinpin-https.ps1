# Status-only Phase 6B.2A-1.5 verification. It never submits Pinpin forms or reads candidate data.
$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

function Get-Status {
  param([string]$Uri)
  try { return [int](Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop).StatusCode }
  catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }; throw }
}
function Get-HeaderValue {
  param([string]$Uri, [string]$Name)
  $response = Invoke-WebRequest -Uri $Uri -Method Head -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
  return [string]$response.Headers[$Name]
}

$zhHttps = 'https://ats.talentnexus.com.tw/webapp/'
$enHttps = 'https://ats-en.talentnexus.com.tw/webapp/'
$zhHttpLegacy = 'http://ats.talentnexus.com.tw:5679/webapp/'
$enHttpLegacy = 'http://ats-en.talentnexus.com.tw:5678/webapp/'
$zhHttpStandard = 'http://ats.talentnexus.com.tw/webapp/'
$enHttpStandard = 'http://ats-en.talentnexus.com.tw/webapp/'
$zhHtml = (Invoke-WebRequest -Uri $zhHttps -UseBasicParsing -TimeoutSec 30).Content
$enHtml = (Invoke-WebRequest -Uri $enHttps -UseBasicParsing -TimeoutSec 30).Content
$renewalFiles = Get-ChildItem 'C:\ProgramData\win-acme' -Recurse -Filter '*.json' -File -ErrorAction SilentlyContinue
$renewalMatch = foreach ($hostName in @('ats.talentnexus.com.tw','ats-en.talentnexus.com.tw')) {
  $found = $false
  foreach ($file in $renewalFiles) {
    if (Select-String -LiteralPath $file.FullName -SimpleMatch $hostName -Quiet -ErrorAction SilentlyContinue) { $found = $true; break }
  }
  [pscustomobject]@{ host = $hostName; renewalConfigured = $found }
}

[pscustomobject]@{
  zhHttps = Get-Status $zhHttps
  enHttps = Get-Status $enHttps
  zhHttpLegacy = Get-Status $zhHttpLegacy
  enHttpLegacy = Get-Status $enHttpLegacy
  zhHttpStandard = Get-Status $zhHttpStandard
  enHttpStandard = Get-Status $enHttpStandard
  zhHsts = Get-HeaderValue $zhHttps 'Strict-Transport-Security'
  enHsts = Get-HeaderValue $enHttps 'Strict-Transport-Security'
  zhAbsoluteHttpReferenceCount = [regex]::Matches($zhHtml, '(?i)(?:src|href)=["'']http://').Count
  enAbsoluteHttpReferenceCount = [regex]::Matches($enHtml, '(?i)(?:src|href)=["'']http://').Count
  certificates = @(Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.Subject -match 'CN=(ats|ats-en)\.talentnexus\.com\.tw$' } | Select-Object Subject,Issuer,NotAfter,HasPrivateKey)
  renewalTask = (Get-ScheduledTask -TaskName 'win-acme renew (acme-v02.api.letsencrypt.org)').State.ToString()
  renewals = $renewalMatch
  tnPublicHealth = Get-Status 'https://tn-api.talentnexus.com.tw/health'
  tnLocalHealth = Get-Status 'http://127.0.0.1:3333/health'
  listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 3333,5432,1433 } | Select-Object LocalAddress,LocalPort)
  services = @(Get-Service postgresql-x64-17,W3SVC,MSSQLSERVER | Select-Object Name,Status)
} | ConvertTo-Json -Depth 6 -Compress
