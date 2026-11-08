-- Disposable read model. Canonical work and geometry remain in their owners.
-- One current compressed scene per city; no unbounded revision history.
CREATE TABLE city_scene_snapshots_v1 (
  city_id text PRIMARY KEY REFERENCES cities_v3(id) ON DELETE CASCADE,
  country_id text NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  world_version bigint NOT NULL CHECK (world_version >= 0),
  build_key text NOT NULL CHECK (build_key ~ '^[a-f0-9]{64}$'),
  format_version integer NOT NULL DEFAULT 1 CHECK (format_version = 1),
  source_hash text NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  raw_bytes integer NOT NULL CHECK (raw_bytes BETWEEN 1 AND 134217728),
  payload bytea NOT NULL CHECK (octet_length(payload) BETWEEN 1 AND 67108864),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- The application already supplies a compressed blob. Avoid double compression.
ALTER TABLE city_scene_snapshots_v1 ALTER COLUMN payload SET STORAGE EXTERNAL;
