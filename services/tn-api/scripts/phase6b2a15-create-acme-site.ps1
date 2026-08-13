# Creates a static, host-specific HTTP-01 challenge site for the two ATS hostnames.
# It leaves the existing Pinpin 5678/5679 sites and their bindings untouched.
$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

$siteName = 'TalentNexusAtsAcmeChallenge'
$sitePath = 'E:\TalentNexus\ats-acme-challenge'
$hosts = @('ats.talentnexus.com.tw', 'ats-en.talentnexus.com.tw')

if (Get-Website -Name $siteName -ErrorAction SilentlyContinue) {
  throw "IIS site $siteName already exists; refusing to change it"
}
New-Item -ItemType Directory -Force -Path $sitePath | Out-Null

$acl = Get-Acl -LiteralPath $sitePath
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule('IIS_IUSRS', 'ReadAndExecute, Synchronize', 'ContainerInherit, ObjectInherit', 'None', 'Allow')
$acl.SetAccessRule($rule)
Set-Acl -LiteralPath $sitePath -AclObject $acl

New-Website -Name $siteName -PhysicalPath $sitePath -Port 80 -HostHeader $hosts[0] -Force | Out-Null
New-WebBinding -Name $siteName -Protocol http -Port 80 -HostHeader $hosts[1] | Out-Null
Start-Website -Name $siteName

[pscustomobject]@{
  site = $siteName
  bindings = @(Get-WebBinding -Name $siteName -Protocol http | Select-Object -ExpandProperty bindingInformation)
  purpose = 'ACME HTTP-01 validation only'
  pinpinHttpBindingsModified = $false
} | ConvertTo-Json -Compress
