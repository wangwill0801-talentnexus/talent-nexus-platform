$ErrorActionPreference = 'Stop'

$login = 'tn_pinpin_blob_ro'
$envPath = 'E:\TalentNexus\config\pinpin-blob.env'
$connection = New-Object System.Data.SqlClient.SqlConnection
$connection.ConnectionString = "Data Source=lpc:$env:COMPUTERNAME;Initial Catalog=master;Integrated Security=True;Encrypt=False;"
$connection.Open()

try {
  $check = $connection.CreateCommand()
  $check.CommandText = "SELECT COUNT(*) FROM sys.server_principals WHERE name = N'$login';"
  if ([int]$check.ExecuteScalar() -ne 0) { throw 'BLOB_LOGIN_ALREADY_EXISTS' }

  $password = 'TN!' + [Guid]::NewGuid().ToString('N') + 'aA9#' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
  $escapedPassword = $password.Replace("'", "''")
  $create = $connection.CreateCommand()
  $create.CommandText = "CREATE LOGIN [$login] WITH PASSWORD = N'$escapedPassword', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF;"
  [void]$create.ExecuteNonQuery()

  $grant = $connection.CreateCommand()
  $grant.CommandText = @"
USE [HiBole-2];
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$login')
  CREATE USER [$login] FOR LOGIN [$login];
GRANT CONNECT TO [$login];
GRANT SELECT (ID, ZPResumeInfo_ID, FileName, FileType, Filesize, CreDate, Annex)
  ON OBJECT::dbo.ZPResumeInfo_Annex_Other TO [$login];
"@
  [void]$grant.ExecuteNonQuery()

  New-Item -ItemType Directory -Path (Split-Path -Parent $envPath) -Force | Out-Null
  Set-Content -LiteralPath $envPath -Value "PINPIN_SQL_BLOB_CONNECTION_STRING=Driver={SQL Server Native Client 10.0};Server=lpc:$env:COMPUTERNAME;Database=HiBole-2;Uid=$login;Pwd=$password;`nPINPIN_BLOB_MAX_BYTES=20971520" -Encoding utf8 -NoNewline
  & icacls $envPath /inheritance:r /grant:r 'Administrators:F' 'SYSTEM:F' 'LOCAL SERVICE:R' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'BLOB_ENV_ACL_FAILED' }
  Write-Output 'BLOB_CREDENTIAL_CREATED'
}
finally {
  $connection.Dispose()
  Remove-Variable password,escapedPassword -ErrorAction SilentlyContinue
}

