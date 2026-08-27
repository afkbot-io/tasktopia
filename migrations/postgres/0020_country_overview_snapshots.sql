-- COUNTRY is a disposable semantic LOD projection, not a copy of CITY
-- entities. Persist the compact projection so restarts and additional web
-- workers do not repeatedly aggregate district geometry.
CREATE TABLE country_overview_snapshots_v1 (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country_id text NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  planet_revision text NOT NULL CHECK (planet_revision ~ '^[a-f0-9]{16,64}$'),
  payload_json jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, country_id)
);

CREATE INDEX country_overview_snapshots_v1_revision_idx
  ON country_overview_snapshots_v1(country_id, schema_version, planet_revision);
