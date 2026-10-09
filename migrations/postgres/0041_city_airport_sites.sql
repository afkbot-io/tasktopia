CREATE TABLE city_airport_sites_v1 (
  layout_id text NOT NULL REFERENCES city_layouts_v1(id) ON DELETE CASCADE,
  task_id text NOT NULL,
  geometry_json jsonb CHECK (geometry_json IS NULL OR jsonb_typeof(geometry_json)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(layout_id,task_id)
);
