# Read-only win-acme release metadata inspection. No download or installation.
$ErrorActionPreference = 'Stop'
$release = Invoke-RestMethod -Headers @{ 'User-Agent' = 'TalentNexus-Phase6B2A1'; 'X-GitHub-Api-Version' = '2022-11-28' } -Uri 'https://api.github.com/repos/win-acme/win-acme/releases/latest'
$assets = @($release.assets | Where-Object { $_.name -match '^win-acme\.v.*\.x64\.pluggable\.zip$' } | Select-Object name,browser_download_url,digest,size)
$locations = @('E:\TalentNexus\win-acme\wacs.exe', (Join-Path $env:TEMP 'TalentNexusEdgeInstall')) | ForEach-Object { [pscustomobject]@{ path = $_; exists = Test-Path $_ } }
[pscustomobject]@{ tag = $release.tag_name; assets = $assets; locations = $locations } | ConvertTo-Json -Depth 4 -Compress
