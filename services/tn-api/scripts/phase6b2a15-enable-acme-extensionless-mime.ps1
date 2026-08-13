# Enables extensionless text/plain challenge tokens only on the isolated ATS ACME site.
$ErrorActionPreference = 'Stop'
$sitePath = 'E:\TalentNexus\ats-acme-challenge'
$webConfig = @'
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <staticContent>
      <mimeMap fileExtension="." mimeType="text/plain" />
    </staticContent>
  </system.webServer>
</configuration>
'@
Set-Content -LiteralPath (Join-Path $sitePath 'web.config') -Value $webConfig -Encoding UTF8
[pscustomobject]@{
  site = 'TalentNexusAtsAcmeChallenge'
  extensionlessMime = 'text/plain'
  pinpinSitesModified = $false
} | ConvertTo-Json -Compress
