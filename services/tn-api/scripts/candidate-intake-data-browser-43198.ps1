param([ValidateSet('43198','43219')][string]$CandidateId='43198')
$ErrorActionPreference='Stop'
$tokenLine=Get-Content -LiteralPath 'E:\TalentNexus\config\tn-api.env' |
  Where-Object { $_ -match '^TN_API_TOKEN=' } |
  Select-Object -First 1
if (-not $tokenLine) { throw 'TN API bearer configuration is unavailable.' }
$token=($tokenLine -replace '^TN_API_TOKEN=','').Trim().Trim('"').Trim("'")
if (-not $token) { throw 'TN API bearer configuration is invalid.' }
$headers=@{Authorization="Bearer $token"}
$response=Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:3333/internal/data-browser/candidates/$CandidateId" -Headers $headers -TimeoutSec 15
$data=($response.Content | ConvertFrom-Json).data
$termCounts=[ordered]@{
  skills=@($data.aiProfile.skill).Count
  languages=@($data.aiProfile.language).Count
  certifications=@($data.aiProfile.certification).Count
  projects=@($data.aiProfile.project).Count
  targetRoles=@($data.aiProfile.target_role).Count
  searchKeywords=@($data.aiProfile.search_keyword).Count
}
[pscustomobject]@{
  status=$response.StatusCode
  sections=[ordered]@{
    header=($null -ne $data.header)
    identity=($null -ne $data.identity)
    atsBaseline=($null -ne $data.atsBaseline)
    aiProfile=($null -ne $data.aiProfile)
    evidence=($null -ne $data.evidence)
    processing=($null -ne $data.processing)
    warnings=($null -ne $data.warnings)
    rawAiSnapshot=($null -ne $data.rawAiSnapshot)
  }
  identity=[ordered]@{
    atsCandidateIdMatches=([string]$data.identity.atsCandidateId -eq $CandidateId)
    candidateUuidPresent=(-not [string]::IsNullOrWhiteSpace([string]$data.identity.candidateUuid))
    externalRefCount=@($data.identity.externalRefs).Count
  }
  baseline=[ordered]@{
    workCount=[int]$data.atsBaseline.workCount
    educationCount=[int]$data.atsBaseline.educationCount
    documentCount=@($data.atsBaseline.documents).Count
  }
  ai=[ordered]@{
    workCount=@($data.aiProfile.work).Count
    educationCount=@($data.aiProfile.education).Count
    terms=$termCounts
  }
  evidenceCount=@($data.evidence).Count
  processingStatus=[string]$data.processing.status
  schemaVersion=[string]$data.rawAiSnapshot.metadata.schema_version
  pluginVersionPresent=(-not [string]::IsNullOrWhiteSpace([string]$data.rawAiSnapshot.metadata.plugin_version))
  parserVersionPresent=(-not [string]::IsNullOrWhiteSpace([string]$data.rawAiSnapshot.metadata.parser_version))
  warnings=@($data.warnings)
} | ConvertTo-Json -Depth 6 -Compress
