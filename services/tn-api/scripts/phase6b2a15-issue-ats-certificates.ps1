# Requests separate production Let's Encrypt certificates and installs them only on the matching Pinpin IIS sites.
# The ACME challenge files are served by the isolated static HTTP challenge site.
$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

$wacs = 'E:\TalentNexus\win-acme\wacs.exe'
$challengeRoot = 'E:\TalentNexus\ats-acme-challenge'
$targets = @(
  @{ host = 'ats.talentnexus.com.tw'; port = 5679 },
  @{ host = 'ats-en.talentnexus.com.tw'; port = 5678 }
)
if (-not (Test-Path $wacs)) { throw 'win-acme is missing' }
if (-not (Test-Path $challengeRoot)) { throw 'ACME challenge root is missing' }

foreach ($target in $targets) {
  $site = Get-Website | Where-Object {
    @(Get-WebBinding -Name $_.Name -Protocol http | Where-Object {
      $_.bindingInformation -eq "*:$($target.port):$($target.host)"
    }).Count -gt 0
  } | Select-Object -First 1
  if ($null -eq $site) { throw "Pinpin site for $($target.host) is not uniquely identifiable" }
  $existingHttps = Get-WebBinding -Name $site.Name -Protocol https | Where-Object {
    $_.bindingInformation -eq "*:443:$($target.host)"
  } | Select-Object -First 1
  if ($existingHttps) { continue }

  & $wacs `
    --source manual `
    --host $target.host `
    --validation filesystem `
    --webroot $challengeRoot `
    --installation iis `
    --installationsiteid $site.id `
    --sslport 443 `
    --sslipaddress '*' `
    --certificatestore My `
    --emailaddress williamwang@talentnexus.com.tw `
    --accepttos
  if ($LASTEXITCODE -ne 0) { throw "win-acme failed for $($target.host) with exit code $LASTEXITCODE" }
}

$result = foreach ($target in $targets) {
  $site = Get-Website | Where-Object {
    @(Get-WebBinding -Name $_.Name -Protocol https | Where-Object {
      $_.bindingInformation -eq "*:443:$($target.host)"
    }).Count -gt 0
  } | Select-Object -First 1
  [pscustomobject]@{ host = $target.host; site = $site.Name; httpsBinding = (Get-WebBinding -Name $site.Name -Protocol https | Where-Object { $_.bindingInformation -eq "*:443:$($target.host)" } | Select-Object -First 1).bindingInformation }
}
[pscustomobject]@{ certificates = $result } | ConvertTo-Json -Depth 4 -Compress
