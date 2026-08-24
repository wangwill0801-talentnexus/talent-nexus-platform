$ErrorActionPreference = 'Stop'
$envPath = 'E:\TalentNexus\config\pinpin-blob.env'
$settings = @{}
foreach ($line in Get-Content -LiteralPath $envPath) {
  if ($line -match '^([A-Z0-9_]+)=(.*)$') { $settings[$matches[1]] = $matches[2] }
}
$raw = $settings.PINPIN_SQL_BLOB_CONNECTION_STRING
if (-not $raw) { throw 'BLOB_ENV_MISSING' }
$user = [regex]::Match($raw, '(?i)(?:^|;)uid=([^;]*)').Groups[1].Value.Trim()
$password = [regex]::Match($raw, '(?i)(?:^|;)pwd=([^;]*)').Groups[1].Value.Trim()
if (-not $user -or -not $password) { throw 'BLOB_ENV_INVALID' }
$connection = New-Object System.Data.SqlClient.SqlConnection("Data Source=lpc:$env:COMPUTERNAME;Initial Catalog=HiBole-2;User ID=$user;Password=$password;Encrypt=False;")
$connection.Open()
try {
  function QueryScalar([string]$sql) {
    $command = $connection.CreateCommand(); $command.CommandText = $sql; return $command.ExecuteScalar()
  }
  function QueryRows([string]$sql) {
    $command = $connection.CreateCommand(); $command.CommandText = $sql; $reader = $command.ExecuteReader(); try { $rows = @(); while ($reader.Read()) { $row = @{}; for ($i = 0; $i -lt $reader.FieldCount; $i++) { $row[$reader.GetName($i)] = if ($reader.IsDBNull($i)) { $null } else { $reader.GetValue($i) } }; $rows += $row }; return ,$rows } finally { $reader.Dispose() }
  }
  $metadata = QueryRows "SELECT ID,ZPResumeInfo_ID,FileName,FileType,Filesize,CreDate,DATALENGTH(Annex) AS BlobBytes FROM dbo.ZPResumeInfo_Annex_Other WHERE ID=1106 AND ZPResumeInfo_ID=43213;"
  if ($metadata.Count -ne 1) { throw 'BLOB_TARGET_NOT_FOUND' }
  $annex1Readable = $true
  try { [void](QueryScalar 'SELECT TOP 0 Annex1 FROM dbo.ZPResumeInfo_Annex_Other;') } catch { $annex1Readable = $false }
  $writeChecks = @{}
  foreach ($name in @('insert','update','delete')) {
    $writeChecks[$name] = $false
    $command = $connection.CreateCommand(); $command.CommandText = 'BEGIN TRANSACTION;'
    try {
      [void]$command.ExecuteNonQuery()
      $command.CommandText = if ($name -eq 'insert') { 'INSERT INTO dbo.ZPResumeInfo_Annex_Other (ID) SELECT 0 WHERE 1=0;' } elseif ($name -eq 'update') { 'UPDATE dbo.ZPResumeInfo_Annex_Other SET FileName=FileName WHERE 1=0;' } else { 'DELETE FROM dbo.ZPResumeInfo_Annex_Other WHERE 1=0;' }
      [void]$command.ExecuteNonQuery(); $writeChecks[$name] = $true
    } catch { $writeChecks[$name] = $false }
    finally { $command.CommandText = 'IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;'; try { [void]$command.ExecuteNonQuery() } catch {} }
  }
  $perms = @{
    selectAnnex = [bool](QueryScalar "SELECT HAS_PERMS_BY_NAME(N'dbo.ZPResumeInfo_Annex_Other',N'OBJECT',N'SELECT');")
    execute = [bool](QueryScalar "SELECT HAS_PERMS_BY_NAME(N'dbo.ZPResumeInfo_Annex_Other',N'OBJECT',N'EXECUTE');")
    alter = [bool](QueryScalar "SELECT HAS_PERMS_BY_NAME(N'dbo.ZPResumeInfo_Annex_Other',N'OBJECT',N'ALTER');")
    dbDataReader = [bool](QueryScalar "SELECT IS_ROLEMEMBER(N'db_datareader');")
    sysadmin = [bool](QueryScalar "SELECT IS_SRVROLEMEMBER(N'sysadmin');")
  }
  [pscustomobject]@{ connection = 'PASS'; targetRows = $metadata.Count; targetBlobBytes = $metadata[0].BlobBytes; declaredBytes = $metadata[0].Filesize; candidateId = $metadata[0].ZPResumeInfo_ID; annex1Readable = $annex1Readable; writeChecks = $writeChecks; permissions = $perms } | ConvertTo-Json -Compress
}
finally { $connection.Dispose(); Remove-Variable raw,password -ErrorAction SilentlyContinue }
