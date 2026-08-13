CREATE SEQUENCE candidate_code_sequence AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE TABLE source_instances (
  id uuid PRIMARY KEY,
  source_system text NOT NULL,
  instance_key text NOT NULL,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  operational_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_instances_system_key_unique UNIQUE (source_system, instance_key)
);

CREATE TABLE candidates (
  id uuid PRIMARY KEY,
  candidate_code text NOT NULL UNIQUE,
  display_name text,
  primary_email text,
  primary_phone text,
  location_text text,
  current_company text,
  current_title text,
  canonical_status text NOT NULL DEFAULT 'active',
  raw_source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  primary_resume_document_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidates_code_format CHECK (candidate_code ~ '^TN[0-9]{8,}$'),
  CONSTRAINT candidates_status CHECK (canonical_status IN ('active', 'inactive', 'archived', 'unknown'))
);

CREATE INDEX candidates_display_name_idx ON candidates (display_name);
CREATE INDEX candidates_primary_email_idx ON candidates (primary_email);
CREATE INDEX candidates_primary_phone_idx ON candidates (primary_phone);
CREATE INDEX candidates_current_company_idx ON candidates (current_company);
CREATE INDEX candidates_current_title_idx ON candidates (current_title);

CREATE TABLE candidate_external_refs (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  source_instance_id uuid NOT NULL REFERENCES source_instances (id) ON DELETE RESTRICT,
  external_candidate_id text NOT NULL,
  external_url text,
  source_active boolean NOT NULL DEFAULT true,
  source_deleted_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_external_refs_source_external_unique UNIQUE (source_instance_id, external_candidate_id)
);
CREATE INDEX candidate_external_refs_candidate_idx ON candidate_external_refs (candidate_id);

CREATE TABLE candidate_work_experiences (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  source_instance_id uuid REFERENCES source_instances (id) ON DELETE RESTRICT,
  source_record_id text,
  company_name text,
  job_title text,
  department text,
  industry_raw text,
  start_date date,
  end_date date,
  is_current boolean NOT NULL DEFAULT false,
  description text,
  display_order integer,
  raw_source_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_fingerprint text,
  source_observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_work_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX candidate_work_experiences_candidate_idx ON candidate_work_experiences (candidate_id);

CREATE TABLE candidate_educations (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  source_instance_id uuid REFERENCES source_instances (id) ON DELETE RESTRICT,
  source_record_id text,
  school_name text,
  degree_raw text,
  major_raw text,
  start_date date,
  end_date date,
  is_current boolean,
  display_order integer,
  raw_source_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_fingerprint text,
  source_observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_education_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX candidate_educations_candidate_idx ON candidate_educations (candidate_id);

CREATE TABLE candidate_documents (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  source_instance_id uuid REFERENCES source_instances (id) ON DELETE RESTRICT,
  external_document_id text,
  storage_provider text NOT NULL,
  storage_reference jsonb,
  original_filename text,
  mime_type text,
  file_extension text,
  file_size_bytes bigint,
  document_role text,
  document_status text NOT NULL DEFAULT 'available',
  source_created_at timestamptz,
  source_updated_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_documents_status CHECK (document_status IN ('available', 'unavailable', 'deleted', 'unknown')),
  CONSTRAINT candidate_documents_size CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0)
);
CREATE INDEX candidate_documents_candidate_idx ON candidate_documents (candidate_id);
CREATE UNIQUE INDEX candidate_documents_source_external_unique
  ON candidate_documents (source_instance_id, external_document_id)
  WHERE source_instance_id IS NOT NULL AND external_document_id IS NOT NULL;

ALTER TABLE candidates
  ADD CONSTRAINT candidates_primary_resume_document_fk
  FOREIGN KEY (primary_resume_document_id) REFERENCES candidate_documents (id) ON DELETE SET NULL;

CREATE TABLE candidate_tags (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  tag text NOT NULL,
  tag_type text,
  origin text NOT NULL DEFAULT 'source',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_tags_nonblank CHECK (length(trim(tag)) > 0),
  CONSTRAINT candidate_tags_candidate_tag_unique UNIQUE (candidate_id, tag, tag_type)
);
CREATE INDEX candidate_tags_candidate_idx ON candidate_tags (candidate_id);

CREATE TABLE candidate_owner_mappings (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  source_instance_id uuid REFERENCES source_instances (id) ON DELETE RESTRICT,
  source_owner_id text,
  source_owner_raw text,
  tn_owner_user_id uuid,
  mapping_status text NOT NULL DEFAULT 'unmapped',
  observed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_owner_mappings_status CHECK (mapping_status IN ('unmapped', 'proposed', 'verified', 'retired'))
);
CREATE INDEX candidate_owner_mappings_candidate_idx ON candidate_owner_mappings (candidate_id);

CREATE TABLE sync_runs (
  id uuid PRIMARY KEY,
  source_instance_id uuid REFERENCES source_instances (id) ON DELETE RESTRICT,
  run_type text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  records_seen bigint NOT NULL DEFAULT 0,
  records_created bigint NOT NULL DEFAULT 0,
  records_updated bigint NOT NULL DEFAULT 0,
  records_failed bigint NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_runs_type CHECK (run_type IN ('initial_import', 'fast_sync', 'reconciliation', 'plugin_observation')),
  CONSTRAINT sync_runs_status CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT sync_runs_counts CHECK (records_seen >= 0 AND records_created >= 0 AND records_updated >= 0 AND records_failed >= 0)
);
CREATE INDEX sync_runs_source_status_idx ON sync_runs (source_instance_id, status, started_at DESC);

CREATE TABLE sync_cursors (
  id uuid PRIMARY KEY,
  source_instance_id uuid NOT NULL REFERENCES source_instances (id) ON DELETE RESTRICT,
  cursor_type text NOT NULL,
  cursor_key text NOT NULL,
  cursor_value text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sync_cursors_source_key_unique UNIQUE (source_instance_id, cursor_type, cursor_key)
);

CREATE TABLE sync_errors (
  id uuid PRIMARY KEY,
  sync_run_id uuid REFERENCES sync_runs (id) ON DELETE SET NULL,
  source_instance_id uuid REFERENCES source_instances (id) ON DELETE SET NULL,
  candidate_id uuid REFERENCES candidates (id) ON DELETE SET NULL,
  external_candidate_id text,
  entity_type text NOT NULL,
  error_category text NOT NULL,
  retryable boolean NOT NULL DEFAULT false,
  sanitized_message text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT sync_errors_message_nonblank CHECK (length(trim(sanitized_message)) > 0)
);
CREATE INDEX sync_errors_retry_idx ON sync_errors (retryable, occurred_at DESC);

CREATE TABLE candidate_sync_state (
  id uuid PRIMARY KEY,
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  source_instance_id uuid NOT NULL REFERENCES source_instances (id) ON DELETE RESTRICT,
  core_fingerprint text,
  work_fingerprint text,
  education_fingerprint text,
  document_fingerprint text,
  last_observed_at timestamptz,
  last_reconciled_at timestamptz,
  last_successful_sync_at timestamptz,
  sync_status text NOT NULL DEFAULT 'unknown',
  last_error_id uuid REFERENCES sync_errors (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_sync_state_unique UNIQUE (candidate_id, source_instance_id),
  CONSTRAINT candidate_sync_state_status CHECK (sync_status IN ('unknown', 'pending', 'succeeded', 'failed', 'partial'))
);
CREATE INDEX candidate_sync_state_source_status_idx ON candidate_sync_state (source_instance_id, sync_status);

CREATE TABLE source_lifecycle_events (
  id uuid PRIMARY KEY,
  candidate_id uuid REFERENCES candidates (id) ON DELETE SET NULL,
  source_instance_id uuid NOT NULL REFERENCES source_instances (id) ON DELETE RESTRICT,
  external_candidate_id text,
  event_type text NOT NULL,
  source_event_at timestamptz,
  observed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_lifecycle_events_type CHECK (event_type IN ('observed', 'activated', 'deactivated', 'deleted', 'restored', 'archived', 'unknown'))
);
CREATE INDEX source_lifecycle_events_source_external_idx ON source_lifecycle_events (source_instance_id, external_candidate_id, observed_at DESC);
