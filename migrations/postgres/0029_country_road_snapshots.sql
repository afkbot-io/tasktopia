-- Derived compressed country roads. No business rows or old geometry are erased.
-- The release regeneration command populates this snapshot before reopening reads.
CREATE TABLE country_road_snapshots_v1 (
  country_id text PRIMARY KEY REFERENCES countries(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  topology_hash text NOT NULL,
  plan_json jsonb NOT NULL CHECK (jsonb_typeof(plan_json) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
