# Talent Nexus Master Roadmap

## Completed

- Candidate Intake Foundation: identity, scoped Pinpin reference, ATS baseline, immutable Connector enrichment snapshot, projections and production E2E.
- Candidate Evidence & AI Processing Foundation: evidence/extraction contract, PostgreSQL job queue, low-concurrency worker, retries, idempotency, projection rebuild and internal diagnostics.
- Historical Evidence Acquisition Backend Bridge: exact scoped ATS identity, canonical source references, deterministic `tn-text-nfkc-v1` normalization, server-side SHA-256, content-backed evidence/extraction persistence, existing-AI reuse and queue/worker Gemini processing. Production migration 005 and backend runtime are deployed.

## Next gate

Historical Evidence Acquisition Bridge is `PARTIAL` at the product boundary: the
backend is deployed and the current Connector working source contains the
existing-candidate no-save Evidence Refresh trigger, exact ATS-ID resolver,
frozen source-session return flow and protected side-car request/submit path.
The formal Connector release remains separate from this backend gate; the
remaining coverage step requires a real authenticated ATS session to capture
new content-backed evidence.

Historical Evidence Pilot remains `CURRENT / PARTIAL`: the latest production dry-run observed 196 candidates, with 4 already current, 12 no evidence, 172 no snapshot and 8 inactive. There are still zero content-hashed historical candidates eligible for a new 5-10 evidence-first pilot. No uncontrolled full-population run occurred.

An offline, metadata-only pilot planner is now available in `services/tn-api`: it deterministically selects up to 10 exact Pinpin identities, verifies evidence SHA/reference/extraction/processing metadata and duplicate groups, and fails closed without reading resume content. It does not claim a production pilot or second-run no-op; those remain gated on a real content-backed cohort.

On 2026-08-21 the planner was deployed through the reviewed TN API release
procedure and executed once in read-only mode. The deployed aggregate observed
268 candidates, found 7 eligible content-backed candidates, and reported zero
duplicate groups. No candidate processing, Gemini call, TN write, Pinpin write,
BLOB read, or second-run replay was performed. The next gate is a separately
approved bounded 5–7 candidate Evidence processing pilot followed by a true
second-run no-op verification.

Next, use the current Connector source path to capture deterministic evidence
for a controlled 5-10 cohort, then rerun the metadata planner and obtain a
separate batch-write approval. A 20-50 batch remains gated by data quality and
must not be started from metadata-only records.

After coverage and evidence validation, build recruiter-facing Talent Search and Candidate 360 on the verified foundation.

## Post-pilot review (2026-08-22)

The authorized seven-person Evidence Pilot completed successfully. The fixed
cohort (43083, 43222, 43223, 43245, 43258, 43262, 43264) completed with a
second-run no-op, zero duplicate/orphan groups, zero Pinpin writes and zero
Pinpin BLOB reads. The deployed pilot report is the current operational source
for these numbers; the older dry-run counts above are retained as history.

The next safe gate is **evidence coverage expansion**, not a blind 20-50
processing run. The current production planner remains stable at observed 268,
content-backed eligible 7, duplicate groups 0, and processing
pending/failed/needs-review 0. The full baseline dry-run reports 194 candidates
without a snapshot, 11 with no evidence, 47 with non-content-backed evidence,
and 8 inactive. Therefore a 20-50 Evidence processing batch is not yet
data-ready. Expand evidence only through the approved Connector Browser
Evidence Bridge or an explicitly approved safe resolver, then rerun the
metadata planner and obtain a separate batch-write approval. Do not create a
scheduled bulk worker or start full Historical Backfill from this state.

### Latest coverage checkpoint (2026-08-22)

The read-only planner was rerun after the Job Context search-quality release:
`297` candidates observed, `17` content-backed eligible, `10` deterministically
selected, duplicate groups `0`, and processing pending/failed/needs-review `0`.
This is sufficient to prepare a controlled 10-candidate Evidence processing
pilot, but it is not permission to execute it. The next gate is explicit
approval for that bounded pilot and its second-run no-op review; no
queue/worker/Gemini or full backfill should start before approval.

The authorized 10-candidate pilot subsequently completed with `created=9`,
`unchanged=1`, `completed=10`, and a second run of `10 unchanged`. Duplicate
and orphan integrity groups remained zero, with zero Pinpin writes and zero
Pinpin BLOB reads. The next gate is review and separate approval for a bounded
20–50 Evidence batch; full Historical Backfill and scheduled bulk processing
remain disabled.

### 20-person batch readiness check (2026-08-22)

The authorized next-step check was limited to a read-only planner run. It found
`297` observed candidates and `17` content-backed eligible candidates, with
`10` deterministic selections and zero duplicate groups or processing failures.
Because the safe minimum batch is 20, no queue/worker/Gemini work was started.
At least three additional content-backed Evidence records must be acquired via
the existing Browser Evidence Bridge (or an explicitly approved safe resolver)
before rerunning the planner. Full backfill and scheduled bulk processing remain
disabled.

The authorized 20-person Evidence Pilot then passed after the bounded planner
cap was extended to 20 and deployed through the reviewed backend release path:
`created=5`, `unchanged=15`, `completed=20`; the second run returned `20
unchanged`. Duplicate and orphan integrity remained zero, with Pinpin writes and
Pinpin BLOB reads both zero. Full Historical Backfill and scheduled bulk
processing remain disabled pending a separate gate.

## Deferred

- Embedding/vector/reranking rollout
- JD matching
- Job and Company TN persistence
- Native ATS replacement
- Original resume binary archive
- Client portal, compensation and outcome intelligence
- Netlify parser shutdown or production AI-provider cutover
