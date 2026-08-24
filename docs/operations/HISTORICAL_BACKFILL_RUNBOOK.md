# Historical Candidate Processing Backfill Runbook

## Current gate

Foundation and dry-run only. A full 194-candidate processing run is not authorized.

Run `npm run processing:backfill-dry-run` with protected production configuration. The command reports sanitized aggregate reason counts and performs zero writes.

For the evidence-first gate, run `npm run processing:evidence-pilot-dry-run`.
This is also read-only and selects at most ten exact `pinpin / pinpin-prod`
identities by numeric ATS ID. It requires a single content-backed evidence
row with a valid SHA-256/evidence identity, deterministic source reference,
matching available extraction and a non-failed processing state. It reports
only sanitized IDs, counts, status/reason metadata and duplicate-group counts;
it never returns candidate PII, payloads, normalized text or attachment bytes.
The command reports `secondRunNoOp: not_run`; it does not authorize or perform
processing, Gemini calls, replay, or a 20-50/full-population backfill.

Reasons: `eligible_projection_rebuild`, `already_current`, `no_snapshot`, `no_evidence`, `ambiguous_evidence`, `soft_deleted`.

## Pilot gate

Before any write pilot, select 5-10 explicitly controlled candidates covering 104, LinkedIn and file sources plus sparse/multilingual cases. Record candidate IDs privately, expected snapshot IDs and existing projection counts. Prefer projection rebuild because it does not call Gemini.

Pass requires exact identity, stable immutable snapshot, one idempotent job, no duplicates/orphans, visible processing state and a second-run no-op. Ambiguous evidence is skipped. Any identity mismatch, unexplained Gemini call, candidate loss or uncontrolled population scope stops the run.

Only after a reviewed pilot may a separately approved 20-50 batch be prepared. Do not automatically expand to the full population.

## 2026-08-13 pilot checkpoint

Ten active candidates were selected by exact scoped ATS identity and existing snapshot metadata across LinkedIn Public, LinkedIn Recruiter and 104. Two source-referenced LinkedIn Public candidates completed snapshot-preserving projection replay with zero Gemini calls. Eight candidates remained fail-closed: seven had no evidence row and one had an evidence row without a verifiable source reference/URL. None had an approved source-content hash.

This is a `PARTIAL` pilot, not approval for a 20-50 batch. The next pilot must capture deterministic evidence plus SHA-256 at intake, or explicitly provide controlled source files/pages for the selected ATS IDs.

## 2026-08-22 authorized seven-person evidence pilot review

The separately authorized seven-person Evidence Pilot completed on the fixed
cohort `43083, 43222, 43223, 43245, 43258, 43262, 43264`: first run 7/7
completed with no newly created jobs because the cohort was already current;
second run 7/7 unchanged; duplicate and orphan integrity zero; Pinpin writes
and Pinpin BLOB reads zero.

Two minimal TN scheduling defects were fixed and deployed during the pilot:
legacy jobs missing `extraction_id` can be recovered only when one exact
available extraction matches, and `process_new_evidence` no longer lets a
newer snapshot without evidence hide an older usable evidence row. Focused and
full TN tests passed (101/101).

This is a **PASS for the bounded pilot only**. It is not authorization for a
20-50 or full-population processing run. The current production planner still
finds 7 content-backed eligible candidates out of 268 observed. Evidence
coverage must be expanded and reviewed before any larger write batch; do not
register scheduled bulk processing automatically.
