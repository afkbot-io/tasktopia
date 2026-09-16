CREATE TABLE city_railway_corridors_v1 (
  layout_id text PRIMARY KEY REFERENCES city_layouts_v1(id) ON DELETE CASCADE,
  geometry_json jsonb NOT NULL CHECK (jsonb_typeof(geometry_json) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
