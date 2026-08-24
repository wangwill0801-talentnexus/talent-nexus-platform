import { createHash } from 'node:crypto';
import { loadConfig } from '../dist/config/env.js';
import { createPool } from '../dist/db/pool.js';
import { PinpinSourceAdapter } from '../dist/pinpin/source-adapter.js';

const atsCandidateId = Number(process.argv[2]);
if (!Number.isSafeInteger(atsCandidateId) || atsCandidateId < 1) throw new Error('A numeric ATS Candidate ID is required.');
const fingerprint = (values) => createHash('sha256').update(JSON.stringify(values)).digest('hex');
const pool = createPool(loadConfig().databaseUrl);
const source = await PinpinSourceAdapter.connect();
try {
  const snapshot = await source.readCandidate(atsCandidateId);
  if (!snapshot) throw new Error('Source candidate not found.');
  const identity = await pool.query(`SELECT r.candidate_id,s.id AS source_instance_id FROM candidate_external_refs r JOIN source_instances s ON s.id=r.source_instance_id WHERE s.source_system='pinpin' AND s.instance_key='pinpin-prod' AND r.external_candidate_id=$1`, [String(atsCandidateId)]);
  if (identity.rows.length !== 1) throw new Error('TN scoped identity is not unique.');
  const { candidate_id: candidateId, source_instance_id: sourceInstanceId } = identity.rows[0];
  const work = await pool.query('SELECT source_record_id,source_fingerprint,display_order FROM candidate_work_experiences WHERE candidate_id=$1 AND source_instance_id=$2 ORDER BY display_order,id', [candidateId, sourceInstanceId]);
  const education = await pool.query('SELECT source_record_id,source_fingerprint,display_order FROM candidate_educations WHERE candidate_id=$1 AND source_instance_id=$2 ORDER BY display_order,id', [candidateId, sourceInstanceId]);
  const summarize = (sourceRows, targetRows, makeFingerprint) => sourceRows.map((row, index) => {
    const value = makeFingerprint(row);
    return {
      sourceRecordId: row.sourceRecordId,
      sourceIdMatches: targetRows.filter((target) => target.source_record_id === row.sourceRecordId).length,
      fingerprintMatches: targetRows.filter((target) => target.source_fingerprint === value).length,
      sameOrderFingerprint: targetRows.some((target) => Number(target.display_order) === index && target.source_fingerprint === value),
    };
  });
  process.stdout.write(`${JSON.stringify({
    atsCandidateId: String(atsCandidateId),
    work: { sourceCount: snapshot.workExperiences.length, targetCount: work.rows.length, rows: summarize(snapshot.workExperiences, work.rows, (row) => fingerprint([row.companyName,row.jobTitle,row.department,row.industryRaw,row.startDate,row.endDate,row.isCurrent])) },
    education: { sourceCount: snapshot.educations.length, targetCount: education.rows.length, rows: summarize(snapshot.educations, education.rows, (row) => fingerprint([row.schoolName,row.degreeRaw,row.majorRaw,row.descriptionRaw,row.startDate,row.endDate,row.isCurrent])) },
  })}\n`);
} finally {
  await source.close();
  await pool.end();
}
