CREATE TABLE IF NOT EXISTS job_search_strategies (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs (id) ON DELETE RESTRICT,
  version integer NOT NULL,
  defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective jsonb NOT NULL DEFAULT '{}'::jsonb,
  strategy_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_search_strategy_version_check CHECK (version > 0),
  CONSTRAINT job_search_strategy_fingerprint_check CHECK (strategy_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT job_search_strategy_unique_version UNIQUE (job_id, version),
  CONSTRAINT job_search_strategy_unique_fingerprint UNIQUE (job_id, strategy_fingerprint)
);
CREATE INDEX IF NOT EXISTS job_search_strategies_latest_idx ON job_search_strategies (job_id, version DESC);

CREATE TABLE IF NOT EXISTS job_candidate_shortlists (
  job_id uuid NOT NULL REFERENCES jobs (id) ON DELETE RESTRICT,
  candidate_id uuid NOT NULL REFERENCES candidates (id) ON DELETE RESTRICT,
  decision text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_candidate_shortlist_decision_check CHECK (decision IN ('SHORTLISTED','REVIEW','DISMISSED')),
  CONSTRAINT job_candidate_shortlist_unique UNIQUE (job_id, candidate_id)
);
CREATE INDEX IF NOT EXISTS job_candidate_shortlists_job_idx ON job_candidate_shortlists (job_id, updated_at DESC);
