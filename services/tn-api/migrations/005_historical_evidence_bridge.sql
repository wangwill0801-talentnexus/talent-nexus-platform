ALTER TABLE candidate_resume_evidence
  ALTER COLUMN enrichment_snapshot_id DROP NOT NULL,
  ADD COLUMN evidence_identity_key text,
  ADD COLUMN hash_algorithm text,
  ADD COLUMN normalization_version text,
  ADD COLUMN capture_method text,
  ADD COLUMN connector_version text,
  ADD CONSTRAINT candidate_resume_evidence_identity_key
    CHECK (evidence_identity_key IS NULL OR evidence_identity_key ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT candidate_resume_evidence_hash_algorithm
    CHECK (hash_algorithm IS NULL OR hash_algorithm = 'sha256');

CREATE UNIQUE INDEX candidate_resume_evidence_identity_unique_idx
  ON candidate_resume_evidence (candidate_id, evidence_identity_key)
  WHERE evidence_identity_key IS NOT NULL;

ALTER TABLE candidate_evidence_extractions
  ADD COLUMN normalization_version text,
  ADD COLUMN normalized_text text,
  ADD CONSTRAINT candidate_evidence_extractions_text_size
    CHECK (normalized_text IS NULL OR length(normalized_text) <= 500000);

CREATE INDEX candidate_resume_evidence_source_idx
  ON candidate_resume_evidence (candidate_id, source_type, source_reference)
  WHERE source_reference IS NOT NULL;
