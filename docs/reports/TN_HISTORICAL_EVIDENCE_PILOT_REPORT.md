# TN Historical Evidence Pilot + Release Baseline

Date: 2026-08-13 (Asia/Taipei)

## Result

`PARTIAL`

The pipeline, identity safeguards, queue/worker, snapshot preservation, replay and integrity checks passed. Only 2 of the 10 selected candidates had a verifiable source reference plus an evidence row; neither had an approved source-content SHA-256. Eight correctly remained `needs_review`. No candidate was guessed, and no full backfill was started.

## Release baseline

- Branch: `codex/tn-evidence-processing-foundation`
- Starting verified report commit after approved history cleanup: `e6ee1fa`
- Root remote: `https://github.com/wangwill0801-talentnexus/talent-nexus-platform.git`
- GitHub authentication: available for `wangwill0801-talentnexus`
- Dedicated root-source repository: verified
- Push: active branch published without force
- Status: `REMOTE_BACKUP_PASS`

The separate `talent-nexus-ai-api` repository was not reused for TN API/docs history. Before the first push, the approved security cleanup removed `dist/talent-nexus-104-poc.pem` from every historical commit and quarantined the local file under an ACL-restricted backup path. The rewritten history scan returned no private-key, common token-pattern or suspicious credential-file findings. Connector, Netlify and dist dirty/untracked work remains untouched. No blanket `git add .` was used.

## Pilot selection

| ATS ID | Source | Selection reason | Final result |
| --- | --- | --- | --- |
| 43198 | LinkedIn Public | Golden, evidence row and deterministic source reference | Completed projection replay; hash warning |
| 43219 | LinkedIn Public | Fresh-lifecycle Golden, evidence row and deterministic source reference | Completed projection replay; hash warning |
| 43220 | LinkedIn Recruiter | Source diversity and existing snapshot/evidence row | Needs review: evidence identity metadata missing |
| 43209 | LinkedIn Recruiter | Source diversity and existing snapshot | Needs review: no evidence |
| 43210 | LinkedIn Public | Public-source coverage and existing snapshot | Needs review: no evidence |
| 43214 | 104 | 104 coverage and existing snapshot | Needs review: no evidence |
| 43215 | 104 | 104 coverage and existing snapshot | Needs review: no evidence |
| 43216 | 104 | 104 coverage and existing snapshot | Needs review: no evidence |
| 43217 | 104 | 104 coverage and existing snapshot | Needs review: no evidence |
| 43218 | 104 | 104 coverage and existing snapshot | Needs review: no evidence |

All ten identities resolved to exactly one `pinpin / pinpin-prod / ATS ID` candidate. Names, contact details, source URLs and resume contents are not included.

## Pipeline result

Historical ATS candidate -> exact scoped TN identity -> evidence gate -> queue/worker for eligible projection rebuild -> immutable snapshot -> projections -> Data Browser.

- Selected: 10
- Completed projection replay: 2
- Needs review: 8
- New Gemini calls: 0
- Reused snapshots: 2
- Avoided Gemini calls: 10
- Wrong identity binding: 0

Candidate 43220 was initially projection-rebuilt during the safe audit because an evidence row existed. Subsequent validation found both source reference and source URL absent, so it is explicitly classified `needs_review`. Its snapshot remained unchanged, Gemini calls were zero and no ATS data was touched.

## Result by candidate

| ATS ID | Evidence | Snapshot | Gemini | Processing/profile validation | Warning |
| --- | --- | --- | --- | --- | --- |
| 43198 | reference + URL, no content hash | reused | 0 | 6 work / 2 education / 31 terms; summary, recruiter summary and target roles present | `EVIDENCE_HASH_MISSING` |
| 43219 | reference + URL, no content hash | reused | 0 | 5 work / 2 education / 21 terms; summary, recruiter summary and target roles present | `EVIDENCE_HASH_MISSING` |
| 43220 | evidence row, no reference/URL/hash | unchanged | 0 | existing 2 work / 1 education / 32 terms retained | `EVIDENCE_IDENTITY_METADATA_MISSING` |
| 43209 | none | unchanged | 0 | raw snapshot structurally present; no projection created | `NO_EVIDENCE` |
| 43210 | none | unchanged | 0 | raw snapshot structurally present; no projection created | `NO_EVIDENCE` |
| 43214 | none | unchanged | 0 | raw snapshot structurally present; no projection created | `NO_EVIDENCE` |
| 43215 | none | unchanged | 0 | raw snapshot structurally present; no projection created | `NO_EVIDENCE` |
| 43216 | none | unchanged | 0 | raw snapshot structurally present; no projection created | `NO_EVIDENCE` |
| 43217 | none | unchanged | 0 | raw snapshot structurally present; no projection created | `NO_EVIDENCE` |
| 43218 | none | unchanged | 0 | raw snapshot structurally present; no projection created | `NO_EVIDENCE` |

## Data quality

For the two completed candidates, raw snapshot work and education counts exactly matched projections after rebuild. Summary, recruiter summary and target roles were present. No silent work/education loss was observed. The other seven no-evidence candidates have structurally populated legacy snapshots, but TN did not promote them into trusted projections because their source evidence relationship cannot be verified. Unknown/missing data remained missing; no values were inferred.

This pilot validates structural consistency, not the factual truth of every private resume statement. Human source-to-profile content review requires the controlled original evidence, which is the current missing input.

## Idempotency and integrity

- Repeating projection requests for 43198 and 43219 returned `unchanged` and reused the same job.
- Snapshot IDs and counts remained unchanged.
- Duplicate scoped external references: 0
- Orphan profiles: 0
- Orphan work: 0
- Orphan education: 0
- Orphan evidence: 0
- Orphan processing jobs: 0
- Legacy ATS writes: 0
- Pinpin BLOB reads: 0

## Historical dry-run after pilot

Population changed naturally from 194 to 195 during the phase. The read-only post-pilot classification is:

- already current: 3
- no evidence: 12
- no snapshot: 172
- inactive: 8
- safely auto-processable: 0

No full 195-candidate run was performed.

## Engineering and runtime

- TN API automated tests: 61/61 PASS
- TypeScript/typecheck/build: PASS
- Lint: no lint command configured; `git diff --check` used as the repository formatting gate
- TN API localhost/public health: PASS
- Processing worker: Running
- PostgreSQL: Running, localhost-only
- Pinpin Chinese/English web: regression PASS
- Public 3333/5432/1433: closed

## Production changes

- Added no schema migration and changed no service configuration in this pilot.
- Ran bounded projection rebuild/replay for 43198 and 43219.
- A safe projection rebuild was also performed for 43220 before its missing evidence identity metadata was detected; it is not counted as pilot-complete.
- Ran read-only candidate inventory, structural validation, integrity checks and post-pilot dry-run.
- No Gemini, Connector, Netlify, DNS, IIS, Entra, firewall, Pinpin or SQL Server change.

## Search readiness

`NOT READY`

Only 3 of 195 candidates currently have projected AI profiles, and none of the pilot evidence rows has an approved source-content hash. The projections are queryable, but coverage and source-level factual review are insufficient for recruiter-facing Talent Search/Candidate 360.

## Next gate — do not execute yet

Do not start a 20-50 backfill. First select 5-10 candidates for which the Connector or controlled PDF/DOCX/HTML capture can persist:

1. exact ATS ID and candidate UUID;
2. source type plus deterministic URL/reference;
3. deterministic extracted representation;
4. SHA-256 of that representation;
5. extractor/parser/schema/provider/model versions.

Repeat the pilot, require a second-run no-op, and perform human source-to-profile review. Only then prepare a separate 20-50 batch approval and the Talent Search/Candidate 360 foundation.

## 2026-08-13 Historical Evidence Bridge production update

The content-backed backend bridge is now deployed with additive migration `005_historical_evidence_bridge.sql`. It adds nullable pre-snapshot evidence, deterministic evidence identity, SHA-256/normalization/capture provenance and controlled normalized extraction text. The API accepts exact scoped Pinpin identity only, canonicalizes 104/LinkedIn URLs, rejects hash mismatch and never returns evidence text. Existing valid Standard Resume results are reused with zero additional Gemini calls; raw evidence uses the existing bounded worker and server-side Gemini provider.

Production release SHA-256: `8682AC06F172F661AEA21024786E44EEBF9FD7BAD3A2A5FA14A892C54F319C4C`. A native PostgreSQL custom-format backup was created and validated before migration. Migration 005 is present exactly once; API and worker tasks are running; local/public TN health and both ATS webapps return 200. Duplicate scoped refs and profile/work/education/evidence/extraction/job orphans are all zero. PostgreSQL and TN API remain localhost-only; Pinpin writes and BLOB reads are zero.

Automated tests are now 69/69 and TypeScript build passes. The latest read-only production dry-run observed 196 candidates: 4 already current, 12 no evidence, 172 no snapshot and 8 inactive; eligible content-backed historical evidence remains zero.

Gate B did not begin. Production has four projected profiles, but their legacy evidence remains metadata-only without the controlled normalized representation and SHA-256 required for factual source review. Creating the required 5-10 real evidence-first cohort needs a current Connector no-save capture trigger. The Connector source is a separate nested repository with substantial pre-existing uncommitted work; modifying/releasing it here would violate the master build's unrelated-work preservation stop condition. No identity was guessed and no legacy evidence was promoted.
