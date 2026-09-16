CREATE TABLE personal_planet_geography_v1 (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  geography_json jsonb NOT NULL CHECK (jsonb_typeof(geography_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
