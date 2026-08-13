# Phase 6B.2A-1 approved component installation only. No IIS site/binding changes.
$ErrorActionPreference = 'Stop'
$downloadRoot = Join-Path $env:TEMP 'TalentNexusEdgeInstall'
$winAcmeRoot = 'E:\TalentNexus\win-acme'
New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null

function Get-MicrosoftMsi([string]$Name, [string]$Uri) {
  $path = Join-Path $downloadRoot $Name
  Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $path
  $signature = Get-AuthenticodeSignature -FilePath $path
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft') {
    throw "Microsoft installer signature validation failed for $Name"
  }
  [pscustomobject]@{ name = $Name; path = $path; sha256 = (Get-FileHash -Algorithm SHA256 $path).Hash; signer = $signature.SignerCertificate.Subject }
}

function Install-Msi([string]$Path) {
  $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', $Path, '/qn', '/norestart') -Wait -PassThru
  if ($process.ExitCode -notin 0, 3010) { throw "MSI installation failed with exit code $($process.ExitCode)" }
  return $process.ExitCode
}

$rewrite = Get-MicrosoftMsi 'rewrite_amd64_en-US.msi' 'https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi'
$rewriteExit = Install-Msi $rewrite.path
$arr = Get-MicrosoftMsi 'requestRouter_amd64.msi' 'https://download.microsoft.com/download/E/9/8/E9849D6A-020E-47E4-9FD0-A023E99B54EB/requestRouter_amd64.msi'
$arrExit = Install-Msi $arr.path

$release = Invoke-RestMethod -Headers @{ 'User-Agent' = 'TalentNexus-Phase6B2A1' } -Uri 'https://api.github.com/repos/win-acme/win-acme/releases/latest'
$asset = @($release.assets | Where-Object { $_.name -match '^win-acme\.v.*\.x64\.pluggable\.zip$' }) | Select-Object -First 1
if ($null -eq $asset -or [string]::IsNullOrWhiteSpace($asset.digest) -or $asset.digest -notmatch '^sha256:') { throw 'Official win-acme release asset or SHA-256 digest is unavailable' }
$winAcmeZip = Join-Path $downloadRoot $asset.name
Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = 'TalentNexus-Phase6B2A1' } -Uri $asset.browser_download_url -OutFile $winAcmeZip
$expectedHash = $asset.digest.Substring('sha256:'.Length).ToUpperInvariant()
$actualHash = (Get-FileHash -Algorithm SHA256 $winAcmeZip).Hash.ToUpperInvariant()
if ($actualHash -ne $expectedHash) { throw 'Official win-acme SHA-256 digest mismatch' }
New-Item -ItemType Directory -Force -Path $winAcmeRoot | Out-Null
Expand-Archive -Path $winAcmeZip -DestinationPath $winAcmeRoot -Force
$wacs = Join-Path $winAcmeRoot 'wacs.exe'
if (-not (Test-Path $wacs)) { throw 'win-acme executable missing after verified extraction' }

[pscustomobject]@{
  urlRewrite = @{ sha256 = $rewrite.sha256; signer = $rewrite.signer; exitCode = $rewriteExit }
  arr = @{ sha256 = $arr.sha256; signer = $arr.signer; exitCode = $arrExit }
  winAcme = @{ release = $release.tag_name; asset = $asset.name; sha256 = $actualHash; installed = (Test-Path $wacs) }
} | ConvertTo-Json -Depth 4 -Compress
