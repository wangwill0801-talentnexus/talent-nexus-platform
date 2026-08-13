# TN Candidate Intake Development Runbook

## Local verification

From `services/tn-api`:

```powershell
npm test
npm run build
```

The tests run migrations in an isolated in-memory PostgreSQL-compatible database. Application startup never runs migrations.

## Real PostgreSQL migration gate

Before production, take and verify a native PostgreSQL backup, then run `npm run migrate` with the protected production environment. Confirm migration ledger entry `003_candidate_intake_foundation.sql`, constraints and indexes. Migration 003 was applied on 2026-08-13; reruns must converge through the migration ledger and must never target another database.

## Internal browser

After a deployed migration/API build, open:

```text
https://tn-api.talentnexus.com.tw/internal/data-browser
```

Enter the ATS Candidate ID and the existing internal TN bearer credential. Never paste candidate payloads or credentials into logs or tickets.

## Golden acceptance

1. Verify controlled ATS candidate 43198 exists and resolves to one external reference.
2. Submit or replay its already-approved Connector `standard_resume_v1` through the normal post-Save path. An unchanged pre-003 snapshot replay must keep the existing snapshot ID and may only repair missing projection/evidence/processing rows.
3. Confirm one candidate UUID, one processing current state, one idempotent snapshot for an identical replay, complete normalized counts, evidence provenance and raw JSON.
4. Repeat with the controlled diverse fixture set. Do not capture new real resumes for testing.
5. Existing candidate refresh must preserve UUID/external ref and add a snapshot only when payload/provenance materially changes.

## Safety

No test may write Pinpin, read Annex/Annex1 BLOBs, auto-save ATS, expose tokens, or modify IIS/DNS/Entra.

## Production deployment notes

- TN API remains a scheduled task bound to `127.0.0.1:3333`; public access stays behind the existing IIS HTTPS edge.
- PostgreSQL remains bound to `127.0.0.1:5432`.
- Production packaging must retain the already-validated `msnodesqlv8` native build used by the Pinpin Shared Memory/LPC adapter. `npm install --ignore-scripts` alone does not produce that native binary.
- Release verification requires local health, public health, protected-route 401 checks, authenticated Candidate Data Browser resolution and a read-only Pinpin adapter read. Never log the bearer or database credentials.
