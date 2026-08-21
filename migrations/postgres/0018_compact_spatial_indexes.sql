-- Hot trigger deletes identify membership by kind/id, not by country/chunk.
CREATE INDEX world_chunk_entities_v11_entity_refresh_idx
  ON world_chunk_entities_v11(entity_kind, entity_id);

-- Rectangle reads can choose either leading axis instead of filtering every
-- road with the same x range by y afterwards.
CREATE INDEX roads_v3_country_y_x_idx ON roads_v3(country_id, y, x);

CREATE INDEX cities_v3_country_bounds_idx ON cities_v3(
  country_id,
  ((bounds_json->>'minX')::integer),
  ((bounds_json->>'maxX')::integer),
  ((bounds_json->>'minY')::integer),
  ((bounds_json->>'maxY')::integer)
);

-- Add the compact district representation without removing the v11 membership
-- projection. The legacy trigger remains a deliberate rollback/read-compatibility
-- path until production parity has been observed through a separate cleanup
-- migration.
ALTER TABLE world_chunk_district_cells_v1
  ADD COLUMN IF NOT EXISTS cell_runs_json jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(cell_runs_json) = 'array');

CREATE OR REPLACE FUNCTION compact_district_cell_runs_v1(source jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH raw AS (
    SELECT (cell->>'x')::integer AS x, (cell->>'y')::integer AS y
    FROM jsonb_array_elements(source) AS cell
  ), numbered AS (
    SELECT x, y, x - row_number() OVER (PARTITION BY y ORDER BY x) AS run_key
    FROM raw
  ), runs AS (
    SELECT min(x) AS start_x, max(x) AS end_x, y
    FROM numbered GROUP BY y, run_key
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'start', jsonb_build_object('x', start_x, 'y', y),
    'end', jsonb_build_object('x', end_x, 'y', y)
  ) ORDER BY y, start_x), '[]'::jsonb) FROM runs
$$;

UPDATE world_chunk_district_cells_v1
SET cell_runs_json = compact_district_cell_runs_v1(cells_json);

CREATE OR REPLACE FUNCTION refresh_world_chunk_district_cells_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id text := COALESCE(NEW.id, OLD.id);
BEGIN
  DELETE FROM world_chunk_district_cells_v1 WHERE district_id = target_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  INSERT INTO world_chunk_district_cells_v1(
    country_id, chunk_x, chunk_y, district_id, cells_json, cell_runs_json
  )
  SELECT c.country_id,
         floor(((cell->>'x')::integer)::numeric / 64)::integer AS chunk_x,
         floor(((cell->>'y')::integer)::numeric / 64)::integer AS chunk_y,
         NEW.id,
         jsonb_agg(cell ORDER BY (cell->>'y')::integer, (cell->>'x')::integer),
         compact_district_cell_runs_v1(jsonb_agg(cell ORDER BY (cell->>'y')::integer, (cell->>'x')::integer))
    FROM cities_v3 c
    CROSS JOIN LATERAL jsonb_array_elements(NEW.cells_json) AS cell
   WHERE c.id = NEW.city_id
   GROUP BY c.country_id,
            floor(((cell->>'x')::integer)::numeric / 64)::integer,
            floor(((cell->>'y')::integer)::numeric / 64)::integer;
  RETURN NEW;
END $$;
