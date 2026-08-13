# Candidate Intake Foundation

## Final flow

```text
Connector capture / existing StandardResumeV1
  -> consultant reviews and performs original ATS Save
  -> Connector resolves exact ATS Candidate ID
  -> Entra-protected TN side-car intake
  -> targeted read-only ATS baseline reconciliation
  -> scoped external identity resolution
  -> transactional raw snapshot + AI profile + evidence + processing
  -> internal Candidate Data Browser
```

New and existing candidates use the same intake. A new candidate is not formally bound before successful ATS Save and exact ATS ID resolution. An existing candidate already has that anchor.

## Contract

The existing `plugin_sidecar_intake_v1` contract is retained. Optional additive metadata now includes parser version, ATS Save time, source timestamps, attachment name/type/reference and SHA-256. Old Connector clients remain valid.

Idempotency is derived from candidate UUID, schema, payload fingerprint, stable source identity, Connector version and AI provider/model metadata. Parser and attachment metadata are persisted but intentionally excluded from the semantic snapshot key to preserve compatibility with pre-migration snapshots. The same event returns the existing snapshot. A changed payload creates a new snapshot linked by `supersedes_id`.

## Persistence

- `candidate_enrichment_snapshots`: immutable raw `standard_resume_v1` JSONB and provenance.
- `candidate_ai_profiles`: summary/recruiter summary/job preferences per snapshot.
- `candidate_ai_work_experiences`, `candidate_ai_educations`: AI interpretation, separate from ATS baseline.
- `candidate_ai_terms`: skills, languages, certifications, projects, target roles and search keywords.
- `candidate_resume_evidence`: source and attachment metadata only.
- `candidate_processing_state`: current status/version/timestamps and latest snapshot pointer.

All projection rows for a new snapshot are committed in one PostgreSQL transaction. A failed projection rolls back the raw snapshot as well; a retry converges once.

## Baseline audit

The existing adapter maps the verified Pinpin fields: candidate name/email/phone/location, `ZPResumeWork` company/title/department/dates/current flag, `ZPResumeEdu` school/degree/major/detail/dates, and attachment metadata only. Child source IDs are provenance hints; TN child UUID stability is handled by logical matching. No confirmed new mapping defect was found in this build, so baseline semantics were not changed.

## Data quality

Warnings are non-fatal: AI work/education richer than ATS, optional evidence not hashed, or missing AI profile. Identity ambiguity, orphan profile and duplicate scoped ATS identity remain hard failures enforced by transaction/foreign-key/unique constraints.

## Internal Data Browser

Open `/internal/data-browser`, enter an ATS Candidate ID, TN code or UUID and the existing internal TN bearer token. The token is held only in page memory. Candidate data API access remains bearer-protected.

The view displays identity, ATS baseline, AI profile, evidence, processing, warnings and raw JSON. It is an internal diagnostic surface, not a recruiter product UI.

## Deployment and recovery

Migration `003_candidate_intake_foundation.sql` is forward-only and non-destructive. It was applied to production on 2026-08-13 after a validated native PostgreSQL backup. Existing snapshot rows remain valid. An identical replay may safely repair missing snapshot projections without creating a new snapshot or invoking Gemini. Broad historical projection backfill remains deferred until a controlled, reviewed process is approved. Restore uses the existing PostgreSQL native backup procedure.

Production release evidence is recorded in `docs/reports/TN_CANDIDATE_INTAKE_PRODUCTION_E2E_REPORT.md`.
