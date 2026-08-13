# Candidate Processing Runbook

## Preconditions

1. PostgreSQL and TN API are healthy and localhost-only.
2. Migration 004 is present in `schema_migrations`.
3. A current native PostgreSQL backup exists before a production migration.
4. Pinpin read-only and BLOB-read boundaries remain unchanged.

## Operator flow

Use the protected Data Browser with ATS ID, TN code or UUID. Review Evidence/Extraction and Processing Jobs/State before acting.

- **Rebuild Projection**: safe first choice when a valid immutable snapshot exists; no Gemini call.
- **Reprocess**: requires eligible deterministic evidence. Metadata-only evidence fails closed.
- **Retry**: only a failed, needs-review or dead-letter job can be explicitly requeued.

The worker runs one job at a time by default. Stop it if failure volume, latency or provider errors rise unexpectedly. Do not bulk retry.

## Recovery

Expired claims are returned to retry/dead-letter by `recoverStaleClaims`. Idempotent enqueue prevents duplicate work. Inspect safe error codes, repair the cause, then retry one controlled job. Projection rebuild can repair projections without changing the snapshot.

## Safety checks

Confirm duplicate external refs = 0; profile/work/education orphans = 0; Pinpin writes = 0; BLOB reads = 0. Never paste tokens or resume content into logs or reports.
