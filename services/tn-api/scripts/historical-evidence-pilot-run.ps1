$ErrorActionPreference='Stop'
$processable=@('43198','43219')
$reviewOnly=@('43220','43209','43210','43214','43215','43216','43217','43218')
$all=@($processable+$reviewOnly)
$envPath='E:\TalentNexus\config\tn-api.env';$psql='C:\Program Files\PostgreSQL\17\bin\psql.exe';$settings=@{}
foreach($line in Get-Content -LiteralPath $envPath){if($line-match'^([A-Z0-9_]+)=(.*)$'){$settings[$matches[1]]=$matches[2]}}
if(-not$settings.DATABASE_URL-or-not$settings.TN_API_TOKEN){throw 'TN runtime configuration unavailable.'}
$uri=[Uri]$settings.DATABASE_URL;$parts=$uri.UserInfo.Split(':',2);$user=[Uri]::UnescapeDataString($parts[0]);$password=[Uri]::UnescapeDataString($parts[1]);$database=$uri.AbsolutePath.TrimStart('/')
if($database-ne'talentnexus'-or$uri.Host-notin@('127.0.0.1','localhost')){throw 'Unexpected TN database target.'}
$pgpass=Join-Path $env:TEMP ('tn-historical-pilot-'+[guid]::NewGuid().ToString('N')+'.pgpass')
function Query([string]$sql){$output=&$psql -h $uri.Host -p $uri.Port -U $user -d $database -X -A -t -v ON_ERROR_STOP=1 -c $sql;if($LASTEXITCODE-ne 0){throw 'Historical pilot query failed.'};return($output|Where-Object{$_}|Select-Object -Last 1)}
function SnapshotAudit([string]$atsId){
  $sql=@"
WITH target AS (SELECT DISTINCT r.candidate_id FROM candidate_external_refs r JOIN source_instances si ON si.id=r.source_instance_id WHERE si.source_system='pinpin' AND si.instance_key='pinpin-prod' AND r.external_candidate_id='$atsId'), latest AS (SELECT e.* FROM candidate_enrichment_snapshots e WHERE e.candidate_id IN(SELECT candidate_id FROM target) ORDER BY e.created_at DESC,e.id DESC LIMIT 1)
SELECT json_build_object('ats_id','$atsId','candidate_count',(SELECT count(*) FROM target),'snapshot_id',(SELECT id FROM latest),'source_kind',(SELECT source_kind FROM latest),'source_reference_present',COALESCE((SELECT nullif(trim(source_reference),'') IS NOT NULL FROM latest),false),'source_url_present',COALESCE((SELECT nullif(trim(source_url),'') IS NOT NULL FROM latest),false),'snapshot_fingerprint_valid',COALESCE((SELECT payload_fingerprint ~ '^[0-9a-f]{64}$' FROM latest),false),'evidence_count',(SELECT count(*) FROM candidate_resume_evidence WHERE candidate_id IN(SELECT candidate_id FROM target)),'evidence_hash_valid',(SELECT count(*)>0 FROM candidate_resume_evidence WHERE candidate_id IN(SELECT candidate_id FROM target) AND evidence_fingerprint ~ '^[0-9a-f]{64}$'),'processing_eligible',(SELECT count(*)>0 FROM candidate_resume_evidence WHERE candidate_id IN(SELECT candidate_id FROM target) AND processing_eligible=true),'profile_count',(SELECT count(*) FROM candidate_ai_profiles WHERE candidate_id IN(SELECT candidate_id FROM target)),'work_projection_count',(SELECT count(*) FROM candidate_ai_work_experiences WHERE candidate_id IN(SELECT candidate_id FROM target)),'education_projection_count',(SELECT count(*) FROM candidate_ai_educations WHERE candidate_id IN(SELECT candidate_id FROM target)),'term_projection_count',(SELECT count(*) FROM candidate_ai_terms WHERE candidate_id IN(SELECT candidate_id FROM target)),'snapshot_work_count',COALESCE((SELECT jsonb_array_length(CASE WHEN jsonb_typeof(payload->'experience')='array' THEN payload->'experience' ELSE '[]'::jsonb END) FROM latest),0),'snapshot_education_count',COALESCE((SELECT jsonb_array_length(CASE WHEN jsonb_typeof(payload->'education')='array' THEN payload->'education' ELSE '[]'::jsonb END) FROM latest),0),'summary_present',COALESCE((SELECT nullif(trim(payload->>'summary'),'') IS NOT NULL FROM latest),false),'recruiter_summary_present',COALESCE((SELECT nullif(trim(payload->>'recruiterSummary'),'') IS NOT NULL FROM latest),false),'target_roles_count',COALESCE((SELECT jsonb_array_length(CASE WHEN jsonb_typeof(payload->'targetRoles')='array' THEN payload->'targetRoles' ELSE '[]'::jsonb END) FROM latest),0));
"@
  return Query $sql|ConvertFrom-Json
}
try{
  Set-Content -LiteralPath $pgpass -Value "$($uri.Host):$($uri.Port):$database`:$user`:$password" -NoNewline -Encoding ascii
  &icacls $pgpass /inheritance:r /grant:r 'Administrators:F' 'SYSTEM:F'|Out-Null;$env:PGPASSFILE=$pgpass
  $headers=@{Authorization='Bearer '+$settings.TN_API_TOKEN};$body=@{operation='rebuild_projection'}|ConvertTo-Json -Compress
  $results=@()
  foreach($atsId in $all){
    $before=SnapshotAudit $atsId
    if($before.candidate_count-ne 1-or-not$before.snapshot_id){throw "Pilot identity/snapshot gate failed for ATS $atsId."}
    if($atsId-in$reviewOnly){$reason=if($before.evidence_count-lt 1){'NO_EVIDENCE'}elseif(-not$before.source_reference_present-and-not$before.source_url_present){'EVIDENCE_IDENTITY_METADATA_MISSING'}else{'EVIDENCE_NOT_PROCESSABLE'};$results+=[pscustomobject]@{atsId=$atsId;source=$before.source_kind;result='needs_review';reason=$reason;geminiCalls=0;before=$before;after=$before;replay='not_run'};continue}
    if($before.evidence_count-lt 1-or(-not$before.source_reference_present-and-not$before.source_url_present)){throw "Pilot evidence gate failed for ATS $atsId."}
    $first=Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3333/internal/data-browser/candidates/$atsId/processing" -Headers $headers -ContentType 'application/json' -Body $body
    $deadline=(Get-Date).AddSeconds(30);do{Start-Sleep -Milliseconds 750;$job=Query "SELECT json_build_object('status',status,'attempts',attempt_count,'output_snapshot_id',output_snapshot_id,'error_code',last_error_code) FROM candidate_processing_jobs WHERE id='$($first.data.jobId)'::uuid;"|ConvertFrom-Json}while($job.status-in@('queued','processing','retry_scheduled')-and(Get-Date)-lt$deadline)
    if($job.status-ne'completed'-or$job.output_snapshot_id-ne$before.snapshot_id){throw "Pilot processing gate failed for ATS $atsId."}
    $after=SnapshotAudit $atsId
    if($after.snapshot_id-ne$before.snapshot_id-or$after.snapshot_work_count-ne$after.work_projection_count-or$after.snapshot_education_count-ne$after.education_projection_count){throw "Pilot snapshot/projection gate failed for ATS $atsId."}
    $replay=Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3333/internal/data-browser/candidates/$atsId/processing" -Headers $headers -ContentType 'application/json' -Body $body
    if($replay.data.status-ne'unchanged'-or$replay.data.jobId-ne$first.data.jobId){throw "Pilot replay gate failed for ATS $atsId."}
    $results+=[pscustomobject]@{atsId=$atsId;source=$before.source_kind;result='completed';reason=if($before.evidence_hash_valid){'EVIDENCE_HASHED'}else{'EVIDENCE_REFERENCE_ONLY'};geminiCalls=0;enqueue=$first.data.status;jobStatus=$job.status;attempts=$job.attempts;snapshotPreserved=$after.snapshot_id-eq$before.snapshot_id;replay=$replay.data.status;before=$before;after=$after}
  }
  $integrity=Query @"
SELECT json_build_object('duplicate_external_refs',(SELECT count(*) FROM(SELECT source_instance_id,external_candidate_id FROM candidate_external_refs GROUP BY 1,2 HAVING count(*)>1)d),'orphan_profiles',(SELECT count(*) FROM candidate_ai_profiles p LEFT JOIN candidates c ON c.id=p.candidate_id WHERE c.id IS NULL),'orphan_work',(SELECT count(*) FROM candidate_ai_work_experiences p LEFT JOIN candidates c ON c.id=p.candidate_id WHERE c.id IS NULL),'orphan_education',(SELECT count(*) FROM candidate_ai_educations p LEFT JOIN candidates c ON c.id=p.candidate_id WHERE c.id IS NULL),'orphan_evidence',(SELECT count(*) FROM candidate_resume_evidence e LEFT JOIN candidates c ON c.id=e.candidate_id WHERE c.id IS NULL),'orphan_jobs',(SELECT count(*) FROM candidate_processing_jobs j LEFT JOIN candidates c ON c.id=j.candidate_id WHERE c.id IS NULL));
"@|ConvertFrom-Json
  [pscustomobject]@{selected=$all.Count;completed=@($results|Where-Object{$_.result-eq'completed'}).Count;needsReview=@($results|Where-Object{$_.result-eq'needs_review'}).Count;geminiCalls=0;results=$results;integrity=$integrity;legacyAtsWrites=0;pinpinBlobReads=0}|ConvertTo-Json -Depth 8 -Compress
}finally{Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue;Remove-Item -LiteralPath $pgpass -Force -ErrorAction SilentlyContinue}
