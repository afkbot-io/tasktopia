CREATE TABLE world_generation_jobs_v1 (
  id uuid PRIMARY KEY,
  country_id text NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN ('city.create', 'district.create', 'task.create', 'country.regenerate')),
  idempotency_key text NOT NULL,
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  locked_at timestamptz,
  locked_by text,
  result_json jsonb,
  error_json jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  finished_at timestamptz,
  UNIQUE (country_id, operation, idempotency_key)
);

CREATE INDEX world_generation_jobs_v1_claim_idx
  ON world_generation_jobs_v1 (status, created_at, id)
  WHERE status IN ('PENDING', 'RUNNING');

CREATE INDEX world_generation_jobs_v1_country_idx
  ON world_generation_jobs_v1 (country_id, created_at DESC);
