# Historical Candidate Processing Backfill Runbook

## Current gate

Foundation and dry-run only. A full 194-candidate processing run is not authorized.

Run `npm run processing:backfill-dry-run` with protected production configuration. The command reports sanitized aggregate reason counts and performs zero writes.

Reasons: `eligible_projection_rebuild`, `already_current`, `no_snapshot`, `no_evidence`, `ambiguous_evidence`, `soft_deleted`.

## Pilot gate

Before any write pilot, select 5-10 explicitly controlled candidates covering 104, LinkedIn and file sources plus sparse/multilingual cases. Record candidate IDs privately, expected snapshot IDs and existing projection counts. Prefer projection rebuild because it does not call Gemini.

Pass requires exact identity, stable immutable snapshot, one idempotent job, no duplicates/orphans, visible processing state and a second-run no-op. Ambiguous evidence is skipped. Any identity mismatch, unexplained Gemini call, candidate loss or uncontrolled population scope stops the run.

Only after a reviewed pilot may a separately approved 20-50 batch be prepared. Do not automatically expand to the full population.

## 2026-08-13 pilot checkpoint

Ten active candidates were selected by exact scoped ATS identity and existing snapshot metadata across LinkedIn Public, LinkedIn Recruiter and 104. Two source-referenced LinkedIn Public candidates completed snapshot-preserving projection replay with zero Gemini calls. Eight candidates remained fail-closed: seven had no evidence row and one had an evidence row without a verifiable source reference/URL. None had an approved source-content hash.

This is a `PARTIAL` pilot, not approval for a 20-50 batch. The next pilot must capture deterministic evidence plus SHA-256 at intake, or explicitly provide controlled source files/pages for the selected ATS IDs.
