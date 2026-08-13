# TN Candidate Intake Production Deployment & Real E2E Report

## Phase

TN BUILD — Candidate Intake Production Deployment & Real E2E

## Result

`PASS`

All repository, backup, migration, deployment, production regression, existing-candidate and fresh Chrome Connector → ATS Save → TN intake gates passed.

## Previous state

The Candidate Intake Foundation was locally complete with migration, transactional persistence, Data Browser and automated coverage, but migration 003 and the matching TN API build had not yet been production-validated.

## Git ownership

`services/tn-api` is a source directory under the root `TalentNexus-104-Golden` workspace. It is not a nested repository, submodule, ignored path or generated artifact, but it has never been added to the root repository and therefore currently appears untracked. The root and `working` repositories already contain unrelated user changes. No blanket staging, commit or push was performed. This is a release-governance gap, not a runtime blocker; a dedicated clean ownership/commit decision is still required.

## Production backup

- Native PostgreSQL custom-format backup created before migration: `talentnexus_candidate_intake_pre_20260813_160156.backup`.
- Created: 2026-08-13 16:01:56 Asia/Taipei.
- Size: 396,003 bytes; archive list validation passed with 111 TOC entries.
- Target database was verified as `talentnexus`.
- Recovery method remains the documented `pg_restore` procedure. No backup job or external copy was changed.

## Migration

- `003_candidate_intake_foundation.sql` reviewed as forward-only and non-destructive.
- Production ledger contains migrations 001, 002 and 003 exactly once.
- Six target tables exist.
- Production catalog: 12 foreign keys, 11 primary/unique constraints, 7 checks and 17 indexes across the six tables.
- All projection/evidence/processing orphan counts are zero.
- Before/after baseline counts remained: 193 candidates, 193 external references, 536 work rows, 137 education rows, 244 document metadata rows and 16 enrichment snapshots.
- Duplicate scoped external identities remain zero.

## Deployment

- Reviewed Node.js build deployed to `E:\TalentNexus\tn-api` using the existing scheduled-task model.
- Runtime: Node.js 24.18.0, matching the validated build runtime.
- `TalentNexusApi` is running; TN API listens only on `127.0.0.1:3333`.
- A packaging defect initially omitted the prebuilt `msnodesqlv8` native binary. It was recovered from the immediately previous validated runtime backup without installing software or changing SQL Server. The real read-only LPC adapter verification then passed.
- Local and public `/health` return 200. No recurring runtime error was observed.

## Architecture

```text
Connector
  -> recruiter confirms and saves ATS
  -> verified ATS Candidate ID
  -> Entra-protected TN intake
  -> scoped TN identity
  -> read-only ATS baseline
  -> immutable raw snapshot
  -> AI profile / evidence / processing
  -> protected Candidate Data Browser
```

The long-term boundary is Light Connector + VPS Deep AI Processing. Capture and ATS workflow remain in the Connector; deep parsing, normalization, enrichment and replay belong in TN backend workers.

## Identity — ATS 43198

- Exactly one `pinpin / pinpin-prod / 43198` external reference resolves to exactly one TN candidate.
- Candidate UUID, TN code and external reference remained stable across both controlled replays.
- Snapshot count remained 1 before and after replay.
- No duplicate scoped reference, baseline child orphan or projection orphan exists.

## Golden candidate verification

- Read-only Pinpin baseline and TN baseline counts match: work 3, education 0, document metadata 1.
- AI projection: work 6, education 2, skills 9, languages 2, certification 1, target roles 6 and search keywords 13.
- Raw snapshot exists with `standard_resume_v1`; Connector version is present. Parser version is absent because this historical intake did not supply one.
- Evidence count is 1; processing state is `completed`.
- Data-quality warnings are expected and non-critical: AI work/education is richer than the ATS baseline, and this historical source has no stored SHA-256.
- No candidate PII or resume content is included in this report.

## Data Browser

- URL: `https://tn-api.talentnexus.com.tw/internal/data-browser`
- Public shell returns 200.
- Protected candidate endpoint resolves ATS 43198 with the existing internal bearer boundary.
- Verified sections: Header, Identity, ATS Baseline, AI Profile, Evidence, Processing, Warnings and Raw AI Snapshot.
- Candidate and side-car APIs return 401 without authentication; no token is embedded in the page or report.

## Existing candidate E2E and retry

`PASS`

The already-existing real Connector snapshot for ATS 43198 was resolved to its existing TN identity. A production-safe replay repaired the new projection/evidence/processing rows from the immutable stored snapshot without a Gemini call, without a second snapshot and without baseline changes. The immediate second run was a complete no-op. Projection result: profile 1, AI work 6, AI education 2, terms 31, evidence 1, completed processing 1.

## Real new candidate E2E

`PASS — ATS 43219`

- The fresh Connector flow produced one new TN candidate, one scoped `pinpin / pinpin-prod / 43219` external reference, one document metadata row and one immutable snapshot.
- Candidate, external reference, TN code and snapshot identity remained stable across two controlled identical replays.
- The intake was complete before replay: profile 1, AI work 5, AI education 2, terms 21, evidence 1 and completed processing 1.
- Both replays returned `unchanged`; no row count changed and the second run was a complete no-op.
- Data Browser resolved all eight expected sections. Its read-only ATS baseline contains work 0, education 0 and document metadata 1, while the AI evidence profile contains work 5 and education 2. This is an expected richness warning, not baseline corruption.
- Overall production totals moved exactly as expected: candidates 193 → 194, external references 193 → 194, documents 244 → 245 and snapshots 16 → 17. Scoped external-reference duplicates remain zero.

Name, email and phone were not used as the final binding; the verified ATS Candidate ID is the operational identity anchor.

## Idempotency

- Candidate UUID and scoped external reference: stable.
- Identical snapshot: unchanged; no duplicate snapshot.
- Missing legacy projections: repaired with conflict-safe inserts.
- AI work/education/terms/evidence: no duplicates.
- Second production replay: unchanged and complete no-op.
- Parser/attachment metadata does not alter the historical semantic snapshot key.

## Tests

- Focused Candidate Intake/Data Browser/side-car tests: 8/8 PASS.
- Full automated tests: 55/55 PASS.
- Migration tests: PASS.
- TypeScript/typecheck and production build: PASS.
- Lint: N/A — repository has no lint script/configuration for this service.

## Production regression

- TN public health: 200.
- Candidate and public side-car unauthenticated boundaries: 401.
- Chinese ATS `/webapp/`: 200.
- English ATS `/webapp/`: 200.
- PostgreSQL, IIS and SQL Server services: running.
- Public ports 3333, 5432 and 1433: closed.
- PostgreSQL and TN API listeners remain localhost-only.

## Legacy ATS

- WRITE: NO.
- Resume BLOB READ: NO.
- Access was limited to existing approved candidate/work/education/lifecycle and attachment metadata projections through the least-privilege read-only Shared Memory/LPC adapter.

## Connector and infrastructure

- Connector protocol/source change: NONE.
- Connector release change: NONE.
- DNS: NONE.
- IIS: NONE.
- Entra: NONE.
- Firewall: NONE.

## Files changed

- Candidate intake migration, domain/service, Data Browser, UI, tests and fixtures under `services/tn-api`.
- Production-safe preflight, backup, deployment, runtime and controlled verification scripts.
- Permanent architecture, roadmap, runbook and this production report.

## Known issues

- `services/tn-api` Git ownership is unresolved/untracked in the root repository.
- Deployment packaging must explicitly retain the validated `msnodesqlv8` native runtime.
- Parser version and evidence SHA-256 are absent on the historical 43198 snapshot; both are optional and are not fabricated.

## Deferred

- Broad historical projection backfill.
- Original binary evidence archive/object storage.
- VPS processing queue and deep AI worker.
- Candidate 360, Talent Search, JD matching and recruiter agent.

## Candidate Intake Foundation

```text
PASS
```

## Next recommended phase

**TN BUILD — Candidate Evidence & AI Processing Foundation**.
