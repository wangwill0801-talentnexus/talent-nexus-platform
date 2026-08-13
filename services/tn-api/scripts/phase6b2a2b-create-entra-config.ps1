# Creates only the deployment identifiers required by the TN Entra resource server.
# No client secret or token is written by this script.
$ErrorActionPreference = 'Stop'

$configDirectory = 'E:\TalentNexus\config'
$configPath = Join-Path $configDirectory 'tn-entra.env'
New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null

$content = [string]::Join([Environment]::NewLine, @(
  'ENTRA_TENANT_ID=26462e96-fb51-4267-bdd9-c087d72c8df9'
  'ENTRA_API_CLIENT_ID=03a79d54-a2a8-4a62-88ce-f1246c1d9d1d'
  'ENTRA_REQUIRED_SCOPE=TN.Sidecar.Write'
  'ENTRA_ISSUER=https://login.microsoftonline.com/26462e96-fb51-4267-bdd9-c087d72c8df9/v2.0'
))
$content | Set-Content -LiteralPath $configPath -Encoding ascii

& icacls $configPath /inheritance:r /grant:r 'BUILTIN\Administrators:(F)' 'NT AUTHORITY\SYSTEM:(F)' 'NT AUTHORITY\LOCAL SERVICE:(R)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to apply tn-entra.env ACL.' }

[pscustomobject]@{
  entraConfigured = Test-Path -LiteralPath $configPath -PathType Leaf
  tenantConfigured = $true
  apiAudienceConfigured = $true
  requiredScope = 'TN.Sidecar.Write'
  aclIncludesRuntimeRead = $true
} | ConvertTo-Json -Compress
