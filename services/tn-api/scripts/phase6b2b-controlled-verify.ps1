param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidatePattern('^\d+$')]
  [string[]]$CandidateId
)

$ErrorActionPreference = 'Stop'

# Runs the read-only, no-PII verifier with the protected TN runtime settings.
# The environment file is passed directly to Node and is never printed.
& 'C:\Program Files\nodejs\node.exe' `
  '--env-file=E:\TalentNexus\config\tn-api.env' `
  'E:\TalentNexus\tn-api\dist\services\phase6b2b-controlled-verify.js' `
  @CandidateId
exit $LASTEXITCODE
