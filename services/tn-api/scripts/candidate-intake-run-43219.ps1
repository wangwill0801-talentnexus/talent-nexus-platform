$ErrorActionPreference='Stop'
$env:TN_ENV='production'
Set-Location 'E:\TalentNexus\tn-api'
& 'C:\Program Files\nodejs\node.exe' '--env-file=E:\TalentNexus\config\tn-api.env' 'dist\services\candidate-intake-production-verify.js' '43219'
if ($LASTEXITCODE -ne 0) { throw 'Controlled candidate verification failed.' }
