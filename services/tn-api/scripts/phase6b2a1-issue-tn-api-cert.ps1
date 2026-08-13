# Requests a single production Let's Encrypt certificate for the isolated TN IIS site.
# win-acme creates its renewable IIS certificate binding and scheduled renewal task.
$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

$siteName = 'TalentNexusApiEdge'
$hostName = 'tn-api.talentnexus.com.tw'
$wacs = 'E:\TalentNexus\win-acme\wacs.exe'
if (-not (Test-Path $wacs)) { throw 'win-acme is not installed at the approved location' }
$site = Get-Website -Name $siteName -ErrorAction Stop
$siteId = $site.id

& $wacs `
  --source iis `
  --siteid $siteId `
  --host $hostName `
  --validation filesystem `
  --validationsiteid $siteId `
  --installation iis `
  --installationsiteid $siteId `
  --certificatestore My `
  --emailaddress williamwang@talentnexus.com.tw `
  --accepttos

if ($LASTEXITCODE -ne 0) { throw "win-acme certificate request failed with exit code $LASTEXITCODE" }

$binding = Get-WebBinding -Name $siteName -Protocol https | Where-Object { $_.bindingInformation -match ':443:tn-api\.talentnexus\.com\.tw$' } | Select-Object -First 1
if ($null -eq $binding) { throw 'win-acme completed but the expected IIS HTTPS binding is missing' }

[pscustomobject]@{
  site = $siteName
  hostname = $hostName
  httpsBinding = $binding.bindingInformation
  sslFlags = $binding.sslFlags
} | ConvertTo-Json -Compress
