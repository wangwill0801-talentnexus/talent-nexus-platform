CREATE TABLE candidate_enrichment_snapshots (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  schema_version text NOT NULL,
  source_kind text NOT NULL,
  source_system text,
  source_reference text,
  source_url text,
  source_captured_at timestamptz,
  plugin_version text,
  ai_provider text,
  ai_model text,
  payload jsonb NOT NULL,
  payload_fingerprint text NOT NULL,
  idempotency_key text NOT NULL,
  correlation_id text,
  supersedes_id uuid REFERENCES candidate_enrichment_snapshots (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_enrichment_schema_nonblank CHECK (length(trim(schema_version)) > 0),
  CONSTRAINT candidate_enrichment_source_kind_nonblank CHECK (length(trim(source_kind)) > 0),
  CONSTRAINT candidate_enrichment_payload_fingerprint_nonblank CHECK (length(trim(payload_fingerprint)) = 64),
  CONSTRAINT candidate_enrichment_idempotency_key_nonblank CHECK (length(trim(idempotency_key)) = 64),
  CONSTRAINT candidate_enrichment_idempotent UNIQUE (candidate_id, schema_version, idempotency_key)
);

CREATE INDEX candidate_enrichment_latest_idx
  ON candidate_enrichment_snapshots (candidate_id, created_at DESC, id DESC);
CREATE INDEX candidate_enrichment_payload_fingerprint_idx
  ON candidate_enrichment_snapshots (candidate_id, payload_fingerprint);
