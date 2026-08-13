# Talent Nexus Master Roadmap

## Completed

- Candidate Intake Foundation: identity, scoped Pinpin reference, ATS baseline, immutable Connector enrichment snapshot, projections and production E2E.
- Candidate Evidence & AI Processing Foundation: evidence/extraction contract, PostgreSQL job queue, low-concurrency worker, retries, idempotency, projection rebuild and internal diagnostics.

## Next gate

Historical processing backfill begins with read-only eligibility and a separately approved 5-10 candidate pilot. No uncontrolled full-population run.

After backfill validation, build recruiter-facing Talent Search and Candidate 360 on the verified foundation.

## Deferred

- Embedding/vector/reranking rollout
- JD matching
- Job and Company TN persistence
- Native ATS replacement
- Original resume binary archive
- Client portal, compensation and outcome intelligence
- Netlify parser shutdown or production AI-provider cutover
