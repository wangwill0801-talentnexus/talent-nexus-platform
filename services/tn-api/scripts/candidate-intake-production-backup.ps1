$ErrorActionPreference = 'Stop'
$envPath = 'E:\TalentNexus\config\tn-api.env'
$backupRoot = 'E:\TalentNexusBackups\PostgreSQL'
$pgDump = 'C:\Program Files\PostgreSQL\17\bin\pg_dump.exe'
$pgRestore = 'C:\Program Files\PostgreSQL\17\bin\pg_restore.exe'
$settings = @{}
foreach ($line in Get-Content -LiteralPath $envPath) { if ($line -match '^([A-Z0-9_]+)=(.*)$') { $settings[$matches[1]] = $matches[2] } }
if (-not $settings.DATABASE_URL) { throw 'TN database configuration unavailable.' }
$uri = [Uri]$settings.DATABASE_URL; $userInfo = $uri.UserInfo.Split(':',2)
$user=[Uri]::UnescapeDataString($userInfo[0]); $password=[Uri]::UnescapeDataString($userInfo[1]); $database=$uri.AbsolutePath.TrimStart('/')
if ($database -ne 'talentnexus' -or $uri.Host -notin @('127.0.0.1','localhost')) { throw 'Unexpected TN database target.' }
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
& icacls $backupRoot /inheritance:r /grant:r 'Administrators:(OI)(CI)F' 'SYSTEM:(OI)(CI)F' | Out-Null
$archive = Join-Path $backupRoot ("talentnexus_candidate_intake_pre_{0}.backup" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
$pgpass = Join-Path $env:TEMP ('tn-backup-' + [guid]::NewGuid().ToString('N') + '.pgpass')
try {
  Set-Content -LiteralPath $pgpass -Value "$($uri.Host):$($uri.Port):$database`:$user`:$password" -NoNewline -Encoding ascii
  & icacls $pgpass /inheritance:r /grant:r 'Administrators:F' 'SYSTEM:F' | Out-Null
  $env:PGPASSFILE=$pgpass
  & $pgDump -h $uri.Host -p $uri.Port -U $user -d $database -Fc --no-owner --no-privileges -f $archive
  if ($LASTEXITCODE -ne 0) { throw 'TN PostgreSQL backup failed.' }
  $list = & $pgRestore --list $archive
  if ($LASTEXITCODE -ne 0 -or -not $list) { throw 'TN PostgreSQL archive validation failed.' }
  $item=Get-Item -LiteralPath $archive
  [pscustomobject]@{status='validated';createdAt=$item.CreationTimeUtc.ToString('o');bytes=$item.Length;archiveName=$item.Name;tocEntries=@($list).Count;database=$database} | ConvertTo-Json -Compress
} finally {
  Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pgpass -Force -ErrorAction SilentlyContinue
}
