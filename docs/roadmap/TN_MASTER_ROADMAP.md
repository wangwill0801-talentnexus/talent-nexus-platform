# Talent Nexus Master Roadmap

## Completed

- Candidate Intake Foundation: identity, scoped Pinpin reference, ATS baseline, immutable Connector enrichment snapshot, projections and production E2E.
- Candidate Evidence & AI Processing Foundation: evidence/extraction contract, PostgreSQL job queue, low-concurrency worker, retries, idempotency, projection rebuild and internal diagnostics.
- Historical Evidence Acquisition Backend Bridge: exact scoped ATS identity, canonical source references, deterministic `tn-text-nfkc-v1` normalization, server-side SHA-256, content-backed evidence/extraction persistence, existing-AI reuse and queue/worker Gemini processing. Production migration 005 and backend runtime are deployed.

## Next gate

Historical Evidence Acquisition Bridge is `PARTIAL` at the product boundary: the backend is deployed, but the existing-candidate no-save Connector capture trigger is blocked by substantial unrelated uncommitted Connector release work and was not overwritten.

Historical Evidence Pilot remains `CURRENT / PARTIAL`: the latest production dry-run observed 196 candidates, with 4 already current, 12 no evidence, 172 no snapshot and 8 inactive. There are still zero content-hashed historical candidates eligible for a new 5-10 evidence-first pilot. No uncontrolled full-population run occurred.

Next, consolidate the current Connector source/release baseline, add the small existing-candidate evidence-refresh trigger against the deployed route, then capture deterministic evidence for a controlled 5-10 cohort and repeat the pilot. A 20-50 batch remains gated by data quality.

After coverage and evidence validation, build recruiter-facing Talent Search and Candidate 360 on the verified foundation.

## Deferred

- Embedding/vector/reranking rollout
- JD matching
- Job and Company TN persistence
- Native ATS replacement
- Original resume binary archive
- Client portal, compensation and outcome intelligence
- Netlify parser shutdown or production AI-provider cutover
