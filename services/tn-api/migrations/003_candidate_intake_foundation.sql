ALTER TABLE candidate_enrichment_snapshots
  ADD COLUMN parser_version text,
  ADD COLUMN ats_saved_at timestamptz,
  ADD COLUMN processed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN source_created_at timestamptz,
  ADD COLUMN source_updated_at timestamptz,
  ADD COLUMN evidence_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE candidate_ai_profiles (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  enrichment_snapshot_id uuid NOT NULL REFERENCES candidate_enrichment_snapshots (id) ON DELETE RESTRICT,
  professional_summary text,
  recruiter_summary text,
  job_preferences text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_ai_profiles_snapshot_unique UNIQUE (enrichment_snapshot_id)
);
CREATE INDEX candidate_ai_profiles_candidate_latest_idx
  ON candidate_ai_profiles (candidate_id, created_at DESC, id DESC);

CREATE TABLE candidate_ai_work_experiences (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  enrichment_snapshot_id uuid NOT NULL REFERENCES candidate_enrichment_snapshots (id) ON DELETE RESTRICT,
  display_order integer NOT NULL,
  company_name text,
  job_title text,
  department text,
  location_text text,
  start_date_raw text,
  end_date_raw text,
  is_current boolean,
  description text,
  provenance text NOT NULL DEFAULT 'ai_normalized',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_ai_work_snapshot_order_unique UNIQUE (enrichment_snapshot_id, display_order),
  CONSTRAINT candidate_ai_work_provenance CHECK (provenance IN ('source_explicit', 'ai_normalized', 'ai_derived'))
);
CREATE INDEX candidate_ai_work_candidate_idx ON candidate_ai_work_experiences (candidate_id);

CREATE TABLE candidate_ai_educations (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  enrichment_snapshot_id uuid NOT NULL REFERENCES candidate_enrichment_snapshots (id) ON DELETE RESTRICT,
  display_order integer NOT NULL,
  school_name text,
  degree_raw text,
  major_raw text,
  start_date_raw text,
  end_date_raw text,
  provenance text NOT NULL DEFAULT 'ai_normalized',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_ai_education_snapshot_order_unique UNIQUE (enrichment_snapshot_id, display_order),
  CONSTRAINT candidate_ai_education_provenance CHECK (provenance IN ('source_explicit', 'ai_normalized', 'ai_derived'))
);
CREATE INDEX candidate_ai_education_candidate_idx ON candidate_ai_educations (candidate_id);

CREATE TABLE candidate_ai_terms (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  enrichment_snapshot_id uuid NOT NULL REFERENCES candidate_enrichment_snapshots (id) ON DELETE RESTRICT,
  term_type text NOT NULL,
  display_order integer NOT NULL,
  value text NOT NULL,
  provenance text NOT NULL DEFAULT 'ai_normalized',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_ai_terms_snapshot_type_order_unique UNIQUE (enrichment_snapshot_id, term_type, display_order),
  CONSTRAINT candidate_ai_terms_type CHECK (term_type IN ('skill', 'language', 'certification', 'project', 'target_role', 'search_keyword')),
  CONSTRAINT candidate_ai_terms_value_nonblank CHECK (length(trim(value)) > 0),
  CONSTRAINT candidate_ai_terms_provenance CHECK (provenance IN ('source_explicit', 'ai_normalized', 'ai_derived'))
);
CREATE INDEX candidate_ai_terms_candidate_type_idx ON candidate_ai_terms (candidate_id, term_type, value);

CREATE TABLE candidate_resume_evidence (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  enrichment_snapshot_id uuid NOT NULL REFERENCES candidate_enrichment_snapshots (id) ON DELETE RESTRICT,
  source_type text NOT NULL,
  source_system text,
  source_reference text,
  source_url text,
  attachment_name text,
  attachment_type text,
  attachment_reference text,
  content_sha256 text,
  captured_at timestamptz,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_resume_evidence_snapshot_unique UNIQUE (enrichment_snapshot_id),
  CONSTRAINT candidate_resume_evidence_hash CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX candidate_resume_evidence_candidate_idx ON candidate_resume_evidence (candidate_id, created_at DESC);

CREATE TABLE candidate_processing_state (
  candidate_id uuid PRIMARY KEY REFERENCES candidates (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'not_processed',
  latest_snapshot_id uuid REFERENCES candidate_enrichment_snapshots (id) ON DELETE SET NULL,
  schema_version text,
  parser_version text,
  plugin_version text,
  source_created_at timestamptz,
  source_updated_at timestamptz,
  resume_updated_at timestamptz,
  tn_first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz,
  ai_first_processed_at timestamptz,
  ai_last_processed_at timestamptz,
  profile_created_at timestamptz,
  last_error_code text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_processing_status CHECK (status IN ('not_processed', 'processing', 'completed', 'failed', 'stale', 'needs_review'))
);
CREATE INDEX candidate_processing_status_idx ON candidate_processing_state (status, updated_at DESC);
