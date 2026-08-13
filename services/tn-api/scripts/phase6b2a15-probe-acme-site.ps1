# Reversible diagnostic for only the isolated ATS ACME challenge site.
$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

$root = 'E:\TalentNexus\ats-acme-challenge'
$probeDirectory = Join-Path $root '.well-known\acme-challenge'
$probe = Join-Path $probeDirectory 'tn-acme-probe'
New-Item -ItemType Directory -Force -Path $probeDirectory | Out-Null
Set-Content -LiteralPath $probe -Value 'TN_ACME_PROBE_OK' -NoNewline -Encoding ASCII
try {
  $hosts = @('ats.talentnexus.com.tw', 'ats-en.talentnexus.com.tw')
  $results = foreach ($hostName in $hosts) {
    $local = & curl.exe -s -o NUL -w '%{http_code}' -H "Host: $hostName" http://127.0.0.1/.well-known/acme-challenge/tn-acme-probe
    $public = & curl.exe -s -o NUL -w '%{http_code}' "http://$hostName/.well-known/acme-challenge/tn-acme-probe"
    [pscustomobject]@{ host = $hostName; localHostHeaderStatus = $local; publicStatus = $public }
  }
  [pscustomobject]@{
    bindings = @(Get-WebBinding -Name 'TalentNexusAtsAcmeChallenge' -Protocol http | Select-Object -ExpandProperty bindingInformation)
    results = $results
  } | ConvertTo-Json -Depth 4 -Compress
} finally {
  Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $probeDirectory -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $root '.well-known') -Force -ErrorAction SilentlyContinue
}
