# Narrow read-only inspection for Phase 6B.2A-1.5. No Pinpin, IIS, database or network change.
$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

$hosts = @('ats.talentnexus.com.tw', 'ats-en.talentnexus.com.tw')
$dns = foreach ($hostName in $hosts) {
  $answers = @(Resolve-DnsName -Name $hostName -Type A -Server 8.8.8.8 -ErrorAction Stop |
    Where-Object { $_.Type -eq 'A' } | Select-Object -ExpandProperty IPAddress)
  [pscustomobject]@{ host = $hostName; addresses = $answers }
}

$sites = foreach ($site in Get-Website) {
  $bindings = @(Get-WebBinding -Name $site.Name | Where-Object {
    $_.bindingInformation -match 'ats\.talentnexus\.com\.tw|ats-en\.talentnexus\.com\.tw|tn-api\.talentnexus\.com\.tw'
  } | ForEach-Object {
    [pscustomobject]@{ protocol = $_.protocol; binding = $_.bindingInformation; sslFlags = $_.sslFlags }
  })
  if ($bindings.Count -gt 0) {
    [pscustomobject]@{ site = $site.Name; state = $site.State.ToString(); applicationPool = $site.applicationPool; bindings = $bindings }
  }
}

$certificates = @(Get-ChildItem Cert:\LocalMachine\My | Where-Object {
  $_.Subject -match 'CN=(ats|ats-en|tn-api)\.talentnexus\.com\.tw$'
} | Select-Object Subject,Issuer,NotAfter,HasPrivateKey)

$renewalTask = Get-ScheduledTask -TaskName 'win-acme renew (acme-v02.api.letsencrypt.org)' -ErrorAction SilentlyContinue
$renewalFiles = if (Test-Path 'C:\ProgramData\win-acme\httpsacme-v02.api.letsencrypt.org\Renewals') {
  @(Get-ChildItem 'C:\ProgramData\win-acme\httpsacme-v02.api.letsencrypt.org\Renewals' -File | Select-Object -ExpandProperty Name)
} else { @() }

[pscustomobject]@{
  dns = $dns
  relevantSites = $sites
  relevantCertificates = $certificates
  renewalTaskState = if ($renewalTask) { $renewalTask.State.ToString() } else { 'Missing' }
  renewalFiles = $renewalFiles
} | ConvertTo-Json -Depth 6 -Compress
