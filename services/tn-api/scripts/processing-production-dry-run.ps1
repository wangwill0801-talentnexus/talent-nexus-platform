$ErrorActionPreference='Stop'
Push-Location 'E:\TalentNexus\tn-api'
try{
  & 'C:\Program Files\nodejs\node.exe' '--env-file=E:\TalentNexus\config\tn-api.env' 'dist\services\historical-backfill-dry-run.js'
  if($LASTEXITCODE-ne 0){throw 'Historical processing dry-run failed.'}
}finally{Pop-Location}
