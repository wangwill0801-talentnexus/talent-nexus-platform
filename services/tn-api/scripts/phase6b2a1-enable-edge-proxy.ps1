# Enables ARR proxy capability server-wide and writes reverse-proxy rules only to TalentNexusApiEdge.
# No existing IIS site, binding, or Pinpin web.config is modified.
$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

$siteName = 'TalentNexusApiEdge'
$sitePath = 'E:\TalentNexus\tn-api-edge'
$hostName = 'tn-api.talentnexus.com.tw'
$target = 'http://127.0.0.1:3333'

if (-not (Get-Website -Name $siteName -ErrorAction SilentlyContinue)) { throw "Expected isolated site $siteName is missing" }
if (-not (Get-WebGlobalModule | Where-Object { $_.Name -eq 'ApplicationRequestRouting' })) { throw 'ARR module is missing' }
if (-not (Get-WebGlobalModule | Where-Object { $_.Name -eq 'RewriteModule' })) { throw 'URL Rewrite module is missing' }

$proxyBefore = Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled'
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled' -Value $true
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'preserveHostHeader' -Value $true
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'reverseRewriteHostInResponseHeaders' -Value $false

$webConfig = @'
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="Allow ACME HTTP-01" stopProcessing="true">
          <match url="^\.well-known/acme-challenge/.*" />
          <action type="None" />
        </rule>
        <rule name="Redirect TN edge HTTP to HTTPS" stopProcessing="true">
          <match url="(.*)" />
          <conditions>
            <add input="{HTTPS}" pattern="off" />
          </conditions>
          <action type="Redirect" url="https://tn-api.talentnexus.com.tw/{R:1}" redirectType="Permanent" />
        </rule>
        <rule name="Reverse proxy only to local TN API" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:3333/{R:1}" appendQueryString="true" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
'@
Set-Content -LiteralPath (Join-Path $sitePath 'web.config') -Value $webConfig -Encoding UTF8

$proxyAfter = Get-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled'
$httpsBinding = Get-WebBinding -Name $siteName -Protocol https | Where-Object { $_.bindingInformation -match ':443:tn-api\.talentnexus\.com\.tw$' } | Select-Object -First 1
[pscustomobject]@{
  site = $siteName
  host = $hostName
  proxyTarget = $target
  proxyEnabledBefore = [bool]$proxyBefore.Value
  proxyEnabledAfter = [bool]$proxyAfter.Value
  httpsBinding = $httpsBinding.bindingInformation
  existingPinpinSitesModified = $false
} | ConvertTo-Json -Compress
