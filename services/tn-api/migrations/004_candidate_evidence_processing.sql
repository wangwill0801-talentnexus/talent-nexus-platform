ALTER TABLE candidate_resume_evidence
  ADD COLUMN extractor_version text,
  ADD COLUMN evidence_fingerprint text,
  ADD COLUMN representation_kind text NOT NULL DEFAULT 'metadata_only',
  ADD COLUMN processing_eligible boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT candidate_resume_evidence_fingerprint
    CHECK (evidence_fingerprint IS NULL OR evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT candidate_resume_evidence_representation
    CHECK (representation_kind IN ('metadata_only', 'connector_text', 'connector_html', 'local_file_text'));

UPDATE candidate_resume_evidence
SET evidence_fingerprint = content_sha256
WHERE content_sha256 IS NOT NULL AND evidence_fingerprint IS NULL;

CREATE INDEX candidate_resume_evidence_fingerprint_idx
  ON candidate_resume_evidence (candidate_id, evidence_fingerprint)
  WHERE evidence_fingerprint IS NOT NULL;

CREATE TABLE candidate_evidence_extractions (
  id uuid PRIMARY KEY,
  evidence_id uuid NOT NULL REFERENCES candidate_resume_evidence (id) ON DELETE RESTRICT,
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  extractor_version text NOT NULL,
  content_sha256 text NOT NULL,
  representation_kind text NOT NULL,
  content_reference text,
  character_count integer,
  status text NOT NULL DEFAULT 'available',
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_evidence_extractions_hash CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT candidate_evidence_extractions_characters CHECK (character_count IS NULL OR character_count >= 0),
  CONSTRAINT candidate_evidence_extractions_status CHECK (status IN ('available', 'invalid', 'unsupported')),
  CONSTRAINT candidate_evidence_extractions_unique UNIQUE (evidence_id, extractor_version, content_sha256)
);
CREATE INDEX candidate_evidence_extractions_candidate_idx
  ON candidate_evidence_extractions (candidate_id, created_at DESC);

CREATE TABLE candidate_processing_jobs (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  evidence_id uuid REFERENCES candidate_resume_evidence (id) ON DELETE RESTRICT,
  extraction_id uuid REFERENCES candidate_evidence_extractions (id) ON DELETE RESTRICT,
  operation text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claim_token uuid,
  started_at timestamptz,
  finished_at timestamptz,
  evidence_fingerprint text,
  extractor_version text,
  parser_version text NOT NULL,
  schema_version text NOT NULL,
  ai_provider text,
  ai_model text,
  idempotency_key text NOT NULL,
  requested_by text NOT NULL DEFAULT 'system',
  last_error_code text,
  last_error_summary text,
  output_snapshot_id uuid REFERENCES candidate_enrichment_snapshots (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_processing_jobs_operation CHECK (operation IN ('process_new_evidence', 'reprocess_profile', 'rebuild_projection')),
  CONSTRAINT candidate_processing_jobs_status CHECK (status IN ('queued', 'processing', 'retry_scheduled', 'completed', 'failed', 'needs_review', 'dead_letter')),
  CONSTRAINT candidate_processing_jobs_attempt CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 10 AND attempt_count <= max_attempts),
  CONSTRAINT candidate_processing_jobs_evidence_hash CHECK (evidence_fingerprint IS NULL OR evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT candidate_processing_jobs_error_code CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{1,64}$'),
  CONSTRAINT candidate_processing_jobs_idempotency UNIQUE (candidate_id, idempotency_key)
);
CREATE INDEX candidate_processing_jobs_claim_idx
  ON candidate_processing_jobs (available_at, created_at, id)
  WHERE status IN ('queued', 'retry_scheduled');
CREATE INDEX candidate_processing_jobs_candidate_idx
  ON candidate_processing_jobs (candidate_id, created_at DESC);

ALTER TABLE candidate_processing_state
  ADD COLUMN latest_job_id uuid REFERENCES candidate_processing_jobs (id) ON DELETE SET NULL,
  ADD COLUMN stale_reason text,
  ADD COLUMN processor_version text;

ALTER TABLE candidate_processing_state
  DROP CONSTRAINT candidate_processing_status;
ALTER TABLE candidate_processing_state
  ADD CONSTRAINT candidate_processing_status
    CHECK (status IN ('not_processed', 'queued', 'processing', 'retry_scheduled', 'completed', 'failed', 'stale', 'needs_review', 'dead_letter'));

INSERT INTO candidate_processing_jobs (
  id, candidate_id, evidence_id, operation, status, attempt_count, max_attempts,
  available_at, started_at, finished_at, evidence_fingerprint, parser_version,
  schema_version, ai_provider, ai_model, idempotency_key, requested_by,
  output_snapshot_id, created_at, updated_at
)
SELECT
  snapshot.id, snapshot.candidate_id, evidence.id, 'process_new_evidence',
  'completed', 1, 1, snapshot.created_at, snapshot.created_at,
  COALESCE(snapshot.processed_at, snapshot.created_at), evidence.content_sha256,
  COALESCE(snapshot.parser_version, 'legacy_netlify_parser_unknown'),
  snapshot.schema_version, snapshot.ai_provider, snapshot.ai_model,
  'legacy-snapshot:' || snapshot.id::text, 'connector_legacy_intake', snapshot.id,
  snapshot.created_at, COALESCE(snapshot.processed_at, snapshot.created_at)
FROM candidate_enrichment_snapshots snapshot
LEFT JOIN candidate_resume_evidence evidence
  ON evidence.enrichment_snapshot_id = snapshot.id
ON CONFLICT (candidate_id, idempotency_key) DO NOTHING;

UPDATE candidate_processing_state
SET processor_version = COALESCE(parser_version, 'legacy_netlify_parser_unknown')
WHERE processor_version IS NULL;
