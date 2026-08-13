# Talent Nexus Architecture Decisions

## Candidate identity

- Internal identity: existing immutable UUID.
- Operational identity: `pinpin / pinpin-prod / <ATS Candidate ID>`; UI labels it Talent Nexus ATS / ATS ID.
- Existing `TN########` code remains a legacy/debug alias.
- Name, email, phone, Connector run and source URL are never final candidate identity.

## Candidate intake

- Reuse `POST /api/v1/plugin-sidecar/candidate-enrichment` and its internal equivalent instead of creating a parallel route.
- New and existing candidates converge through the same `PluginSidecarIntakeService` after exact ATS identity resolution.
- Connector-produced `standard_resume_v1` is persisted directly; TN does not call Gemini again.
- Raw snapshots are immutable/versioned. Normalized profile rows are snapshot-scoped and transactionally created.

## Data lines

- ATS baseline: `candidates`, baseline work/education/documents and external references.
- AI interpretation: enrichment snapshot plus snapshot-scoped profile/work/education/terms.
- Evidence: metadata only; no original BLOB copy.
- Processing: one current state pointer plus immutable snapshot history.

## Safety

- Legacy ATS remains read-only. No BLOB reads.
- Production infrastructure and Connector protocol remain unchanged in this build.

## Long-term processing boundary

- Connector responsibilities stop at deterministic capture, evidence packaging, recruiter review, ATS Save/ID resolution and TN intake submission.
- Deep parsing, normalization, enrichment, replay, reprocessing and historical backfill belong to TN backend workers on the VPS.
- PostgreSQL stores identity, metadata, references, processing state and structured results. Future original binaries belong in controlled file/object storage, not giant PostgreSQL JSON/BLOB fields.
- Original evidence is ground truth; LLM output is versioned interpretation and never the candidate identity.
