# Candidate Processing Model

## Flow

Evidence -> deterministic extraction -> durable job -> bounded worker -> immutable AI snapshot -> rebuildable projections -> internal review.

The current Golden Connector flow remains active. TN processing is an additive strangler capability, not a parser cutover.

## Operations and states

Operations are `process_new_evidence`, `reprocess_profile`, and `rebuild_projection`. States are `queued`, `processing`, `retry_scheduled`, `completed`, `failed`, `needs_review`, and `dead_letter`; candidate state may additionally be `not_processed` or `stale`.

The PostgreSQL queue uses a claim token, transaction, `FOR UPDATE SKIP LOCKED`, a partial claim index, low worker concurrency, bounded exponential retry and a maximum attempt count. The idempotency key covers candidate, operation, evidence fingerprint, extractor, parser, schema, provider and model versions.

Projection rebuild reads the latest immutable snapshot, replaces only projection rows and makes no Gemini request. Unsupported or unverifiable evidence becomes `needs_review`; it is never marked completed.

## Staleness

Confirmed evidence fingerprint changes, extractor/parser/schema/model upgrades, or an explicit operator request can mark a profile stale and create a new versioned operation. Same inputs replay to the existing job. Raw snapshots are never overwritten.

## Logging

Allowed: job/candidate/evidence IDs, status, attempt, duration, versions and safe error code/summary. Forbidden: full resume, full AI response, tokens, credentials and secrets.
