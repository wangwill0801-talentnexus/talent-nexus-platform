# Read-only IIS edge capability check. No installation or IIS changes.
$ErrorActionPreference = 'Stop'
Import-Module WebAdministration
$commands = @('wacs.exe', 'certbot.exe', 'appcmd.exe') | ForEach-Object {
  $found = Get-Command $_ -ErrorAction SilentlyContinue
  [pscustomobject]@{ command = $_; available = $null -ne $found; path = if ($found) { $found.Source } else { $null } }
}
$paths = @(
  'C:\Program Files\win-acme\wacs.exe',
  'C:\ProgramData\win-acme\wacs.exe',
  'C:\Program Files (x86)\IIS\Application Request Routing\requestRouter.dll',
  'C:\Program Files\IIS\Application Request Routing\requestRouter.dll',
  'C:\Program Files (x86)\IIS\URL Rewrite\rewrite.dll',
  'C:\Program Files\IIS\URL Rewrite\rewrite.dll'
) | ForEach-Object { [pscustomobject]@{ path = $_; exists = Test-Path $_ } }
$features = Get-WindowsFeature | Where-Object { $_.Name -match '^Web-' -and $_.Installed } | Select-Object Name,DisplayName
$modules = Get-WebGlobalModule | Select-Object Name,Image
[pscustomobject]@{ commands=@($commands); paths=@($paths); features=@($features); modules=@($modules) } | ConvertTo-Json -Depth 4 -Compress
