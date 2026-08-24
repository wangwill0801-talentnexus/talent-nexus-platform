CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  source_system text NOT NULL,
  source_instance_key text NOT NULL,
  external_job_id text NOT NULL,
  title text,
  client_name text,
  description text,
  requirements text,
  location_text text,
  salary_text text,
  source_url text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jobs_source_external_unique UNIQUE (source_system, source_instance_key, external_job_id),
  CONSTRAINT jobs_fingerprint_format CHECK (content_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT jobs_status_check CHECK (status IN ('active','inactive','needs_review'))
);
CREATE INDEX IF NOT EXISTS jobs_status_updated_idx ON jobs (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS jobs_title_idx ON jobs (title);

CREATE TABLE IF NOT EXISTS job_intelligence (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs (id) ON DELETE RESTRICT,
  content_fingerprint text NOT NULL,
  role_family text,
  seniority text,
  must_have jsonb NOT NULL DEFAULT '[]'::jsonb,
  nice_to_have jsonb NOT NULL DEFAULT '[]'::jsonb,
  search_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
  model_tier text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_intelligence_fingerprint_unique UNIQUE (job_id, content_fingerprint)
);
CREATE INDEX IF NOT EXISTS job_intelligence_job_idx ON job_intelligence (job_id, created_at DESC);
