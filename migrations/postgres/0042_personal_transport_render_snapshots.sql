-- Derived map snapshots, scoped to the authorized viewer and sector. These
-- preserve existing corridors and avoid rerunning BFS for task progress reads.
CREATE TABLE personal_transport_render_snapshots_v1 (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sector integer NOT NULL CHECK (sector >= 0),
  source_hash text NOT NULL,
  payload_json jsonb NOT NULL CHECK (jsonb_typeof(payload_json)='object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,sector)
);
