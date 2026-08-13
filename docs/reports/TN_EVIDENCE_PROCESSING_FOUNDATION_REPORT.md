# TN Release Baseline + Candidate Evidence & AI Processing Foundation

Date: 2026-08-13 (Asia/Taipei)

## Result

`PASS` for the foundation, migration, bounded production worker, controlled E2E and read-only historical assessment. Historical production backfill remains behind an explicit pilot gate.

## Release baseline

- Root repository owns `services/tn-api`, migrations and `docs`; baseline commit `57ed540`.
- Connector source remains the dirty nested `working` repository; unpacked/ZIP/CRX files are artifacts and were not modified or committed in this phase.
- Netlify deploy source remains `_backend_publish_worktree`; no Netlify change or parser cutover occurred.
- Application release was built from branch `codex/tn-evidence-processing-foundation`, source commit `161d624`, SHA-256 `59F86A1EDEAC9D743C4D3DB643F922CE08FE387BE1ED0079AD62101EE5DB994B`.
- Pre-migration PostgreSQL native backup was validated: `talentnexus_candidate_intake_pre_20260813_170553.backup`.
- Application rollback directory: `processing-rollback-20260813_170620`.

## Architecture

Connector/approved evidence -> TN intake -> evidence/extraction metadata -> durable PostgreSQL queue -> low-concurrency worker -> immutable snapshot -> rebuildable projections -> protected Data Browser.

The released Connector -> Netlify Gemini -> `standard_resume_v1` flow is preserved. Its existing result is registered as a completed legacy processing job and is not sent to Gemini again.

## Database

Migration `004_candidate_evidence_processing.sql` was applied exactly once to `talentnexus`.

- Extended `candidate_resume_evidence` with extractor/fingerprint/representation/eligibility fields.
- Added `candidate_evidence_extractions`.
- Added `candidate_processing_jobs` with operation/status checks, attempt bounds, safe error-code checks, foreign keys and `(candidate_id,idempotency_key)` uniqueness.
- Added candidate and partial claim indexes.
- Extended `candidate_processing_state` with latest job, stale reason and processor version.
- Existing immutable snapshots were represented as completed legacy jobs without AI replay.

## Evidence and provenance

SHA-256 is accepted only from an approved deterministic capture/extraction path. `metadata_only` evidence is not processable. Versions retained by job/snapshot include extractor, parser, schema, provider and model, with plugin provenance retained on the snapshot/evidence path. No Pinpin BLOB was accessed.

## Processing and reprocessing

- Operations: process new evidence, reprocess profile, rebuild projection.
- States: queued, processing, retry scheduled, completed, failed, needs review and dead letter.
- Worker: one job at a time, PostgreSQL transaction, claim token and `FOR UPDATE SKIP LOCKED`.
- Retry: bounded exponential delay and explicit retry for failed/review/dead-letter jobs.
- Idempotency includes candidate, evidence fingerprint and all relevant processing versions.
- Projection rebuild replaces only projections, preserves the snapshot and makes zero Gemini calls.
- Missing/ambiguous evidence fails closed.

## Data Browser

The protected internal page now separates Evidence/Extraction and Processing Jobs/State and exposes sanitized error details. Authenticated internal actions support Reprocess, Rebuild Projection and Retry. These actions never submit or save ATS data.

## Historical backfill

Production dry-run observed 194 scoped candidates and performed zero writes:

- already current: 2
- no evidence: 12
- no snapshot: 172
- inactive: 8
- eligible for automatic projection rebuild: 0

Six diverse local Golden payloads cover 104/LinkedIn/file-style, sparse, multilingual and multi-record representations. A production historical 5-10 candidate write pilot was not forced because no eligible cohort exists under the verified evidence contract. The next step requires explicit candidate selection/evidence approval; full 194 processing is not authorized.

## Controlled production E2E

Candidate 43198 was resolved by exact scoped Pinpin reference and used only for TN projection rebuild:

- one job created, claimed once and completed;
- snapshot ID/count unchanged;
- profile/work/education counts preserved;
- replay returned `unchanged` and the same job;
- duplicate scoped refs = 0;
- profile/work/education/job orphans = 0;
- Gemini calls = 0.

Fresh-lifecycle Golden 43219 remains one exact scoped ref with one snapshot. No candidate content is included in this report.

## Runtime and regressions

- Local tests: 61/61 PASS.
- TypeScript/typecheck/build: PASS.
- Lint: not configured in this package; `git diff --check` PASS.
- PostgreSQL service: Running; listener `127.0.0.1:5432` only.
- TN API: local `/health` 200; public HTTPS `/health` 200; listener `127.0.0.1:3333` only.
- Processing worker task: Running as `LOCAL SERVICE`, Limited, startup-triggered.
- Pinpin Chinese `/webapp/`: 200.
- Pinpin English `/webapp/`: 200.
- IIS and SQL Server: Running.
- Public/local listener check found no 1433 listener.
- Legacy ATS writes by TN: 0.
- Pinpin BLOB reads: 0.

## Production changes

1. Created a validated native PostgreSQL backup.
2. Applied additive migration 004 to `talentnexus` only.
3. Replaced TN API `dist/src/package.json` through a hashed staging and rollback deployment.
4. Registered `TalentNexusProcessingWorker` as a limited `LOCAL SERVICE` startup task.
5. Ran a read-only 194-candidate backfill assessment.
6. Ran one controlled TN-only projection rebuild and idempotent replay for 43198.

No Connector, Netlify, DNS, IIS, Entra, firewall, Pinpin, SQL Server or Gemini configuration was changed.

## Known issues and deferred work

- Most historical candidates do not yet have approved processable evidence in TN; metadata is not promoted to raw evidence.
- Production reprocessing through Gemini is intentionally not enabled until deterministic evidence representation and a controlled provider pilot are approved.
- A 5-10 historical production pilot, then a separately approved 20-50 batch, remains gated.
- Search, Candidate 360, embeddings, reranking, JD Match, Job/Company persistence, ATS replacement and Netlify shutdown are deferred.

## Next phase

Select and approve a 5-10 candidate historical evidence pilot. After a stable second-run no-op and reviewed AI/provider behavior, expand historical backfill in controlled batches. Talent Search/Candidate 360 follows after that gate.
