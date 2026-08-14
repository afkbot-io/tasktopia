CREATE TABLE world_chunk_payloads_v1 (
  country_id text NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  chunk_x integer NOT NULL,
  chunk_y integer NOT NULL,
  lod text NOT NULL CHECK (lod IN ('DETAIL', 'OVERVIEW')),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  payload_json jsonb NOT NULL,
  published_at timestamptz NOT NULL,
  PRIMARY KEY (country_id, chunk_x, chunk_y, lod)
);

CREATE INDEX world_chunk_payloads_v1_hash_idx
  ON world_chunk_payloads_v1(country_id, content_hash);
