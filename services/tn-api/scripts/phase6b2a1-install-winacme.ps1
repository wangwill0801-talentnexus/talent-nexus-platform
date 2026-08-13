# Installs only the approved win-acme release from the official project release API.
$ErrorActionPreference = 'Stop'
$downloadRoot = Join-Path $env:TEMP 'TalentNexusEdgeInstall'
$winAcmeRoot = 'E:\TalentNexus\win-acme'
New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null
$release = Invoke-RestMethod -Headers @{ 'User-Agent' = 'TalentNexus-Phase6B2A1'; 'X-GitHub-Api-Version' = '2022-11-28' } -Uri 'https://api.github.com/repos/win-acme/win-acme/releases/latest'
$asset = @($release.assets | Where-Object { $_.name -match '^win-acme\.v.*\.x64\.pluggable\.zip$' }) | Select-Object -First 1
if ($null -eq $asset) { throw 'Official win-acme x64 pluggable release asset is unavailable' }
$zip = Join-Path $downloadRoot $asset.name
Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'TalentNexus-Phase6B2A1' } -Uri $asset.browser_download_url -OutFile $zip
$archiveHash = (Get-FileHash -Algorithm SHA256 $zip).Hash
if (-not [string]::IsNullOrWhiteSpace($asset.digest)) {
  if ($asset.digest -notmatch '^sha256:' -or $archiveHash.ToUpperInvariant() -ne $asset.digest.Substring('sha256:'.Length).ToUpperInvariant()) { throw 'Official win-acme SHA-256 digest mismatch' }
}
New-Item -ItemType Directory -Force -Path $winAcmeRoot | Out-Null
Expand-Archive -Path $zip -DestinationPath $winAcmeRoot -Force
$wacs = Join-Path $winAcmeRoot 'wacs.exe'
if (-not (Test-Path $wacs)) { throw 'win-acme executable missing after extraction' }
$signature = Get-AuthenticodeSignature -FilePath $wacs
$version = (& $wacs --version 2>&1 | Select-Object -First 1 | Out-String).Trim()
[pscustomobject]@{ release = $release.tag_name; source = $asset.browser_download_url; archiveSha256 = $archiveHash; publisherDigestAvailable = -not [string]::IsNullOrWhiteSpace($asset.digest); wacsSignature = $signature.Status.ToString(); wacsVersion = $version; installed = (Test-Path $wacs) } | ConvertTo-Json -Compress
