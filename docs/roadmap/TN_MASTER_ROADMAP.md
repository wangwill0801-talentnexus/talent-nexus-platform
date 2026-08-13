# Talent Nexus Master Roadmap

## Completed

- Candidate Intake Foundation: identity, scoped Pinpin reference, ATS baseline, immutable Connector enrichment snapshot, projections and production E2E.
- Candidate Evidence & AI Processing Foundation: evidence/extraction contract, PostgreSQL job queue, low-concurrency worker, retries, idempotency, projection rebuild and internal diagnostics.

## Next gate

Historical Evidence Pilot is `CURRENT / PARTIAL`: 10 candidates were safely classified, 2 source-referenced profiles completed projection replay, and 8 remained fail-closed because evidence was absent or untraceable. No uncontrolled full-population run.

Next, capture deterministic evidence fingerprints for a controlled 5-10 cohort and repeat the pilot. A 20-50 batch remains unapproved.

After coverage and evidence validation, build recruiter-facing Talent Search and Candidate 360 on the verified foundation.

## Deferred

- Embedding/vector/reranking rollout
- JD matching
- Job and Company TN persistence
- Native ATS replacement
- Original resume binary archive
- Client portal, compensation and outcome intelligence
- Netlify parser shutdown or production AI-provider cutover
