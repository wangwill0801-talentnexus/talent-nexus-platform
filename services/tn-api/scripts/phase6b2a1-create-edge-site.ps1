# Creates only the isolated HTTP IIS site used by the TN public edge and ACME HTTP-01 validation.
# It does not alter existing Pinpin sites, bindings, or application configuration.
$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

$siteName = 'TalentNexusApiEdge'
$hostName = 'tn-api.talentnexus.com.tw'
$sitePath = 'E:\TalentNexus\tn-api-edge'

if (Get-Website -Name $siteName -ErrorAction SilentlyContinue) {
  throw "IIS site $siteName already exists; refusing to alter an existing site"
}

New-Item -ItemType Directory -Force -Path $sitePath | Out-Null

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
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
'@
Set-Content -LiteralPath (Join-Path $sitePath 'web.config') -Value $webConfig -Encoding UTF8

# Grant only IIS read/execute access to this static edge configuration directory.
$acl = Get-Acl -LiteralPath $sitePath
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule('IIS_IUSRS', 'ReadAndExecute, Synchronize', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
$acl.SetAccessRule($rule)
Set-Acl -LiteralPath $sitePath -AclObject $acl

New-Website -Name $siteName -PhysicalPath $sitePath -Port 80 -HostHeader $hostName -Force | Out-Null
Start-Website -Name $siteName

$site = Get-Website -Name $siteName
$binding = Get-WebBinding -Name $siteName -Protocol http | Select-Object -First 1
[pscustomobject]@{
  site = $site.Name
  state = $site.State.ToString()
  physicalPath = $site.PhysicalPath
  binding = $binding.bindingInformation
  existingPinpinSitesModified = $false
} | ConvertTo-Json -Compress
