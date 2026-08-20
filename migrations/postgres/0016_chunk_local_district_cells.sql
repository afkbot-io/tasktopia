-- Canonical district geometry remains in districts_v3 during the transition,
-- but chunk reads use this bounded projection and never deserialize an entire
-- country-sized cells_json value.
CREATE TABLE world_chunk_district_cells_v1 (
  country_id text NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  chunk_x integer NOT NULL,
  chunk_y integer NOT NULL,
  district_id text NOT NULL REFERENCES districts_v3(id) ON DELETE CASCADE,
  cells_json jsonb NOT NULL CHECK (jsonb_typeof(cells_json) = 'array'),
  PRIMARY KEY (country_id, chunk_x, chunk_y, district_id),
  CHECK (jsonb_array_length(cells_json) <= 4096)
);

CREATE INDEX world_chunk_district_cells_v1_district_idx
  ON world_chunk_district_cells_v1(district_id);

CREATE OR REPLACE FUNCTION refresh_world_chunk_district_cells_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id text := COALESCE(NEW.id, OLD.id);
BEGIN
  DELETE FROM world_chunk_district_cells_v1 WHERE district_id = target_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  INSERT INTO world_chunk_district_cells_v1(country_id, chunk_x, chunk_y, district_id, cells_json)
  SELECT c.country_id,
         floor(((cell->>'x')::integer)::numeric / 64)::integer,
         floor(((cell->>'y')::integer)::numeric / 64)::integer,
         NEW.id,
         jsonb_agg(cell ORDER BY (cell->>'y')::integer, (cell->>'x')::integer)
    FROM cities_v3 c
    CROSS JOIN LATERAL jsonb_array_elements(NEW.cells_json) AS cell
   WHERE c.id = NEW.city_id
   GROUP BY c.country_id,
            floor(((cell->>'x')::integer)::numeric / 64)::integer,
            floor(((cell->>'y')::integer)::numeric / 64)::integer;
  RETURN NEW;
END $$;

CREATE TRIGGER districts_v3_chunk_cells_v1
AFTER INSERT OR UPDATE OF city_id, cells_json OR DELETE ON districts_v3
FOR EACH ROW EXECUTE FUNCTION refresh_world_chunk_district_cells_v1();

INSERT INTO world_chunk_district_cells_v1(country_id, chunk_x, chunk_y, district_id, cells_json)
SELECT c.country_id,
       floor(((cell->>'x')::integer)::numeric / 64)::integer,
       floor(((cell->>'y')::integer)::numeric / 64)::integer,
       d.id,
       jsonb_agg(cell ORDER BY (cell->>'y')::integer, (cell->>'x')::integer)
  FROM districts_v3 d
  JOIN cities_v3 c ON c.id = d.city_id
  CROSS JOIN LATERAL jsonb_array_elements(d.cells_json) AS cell
 GROUP BY c.country_id, d.id,
          floor(((cell->>'x')::integer)::numeric / 64)::integer,
          floor(((cell->>'y')::integer)::numeric / 64)::integer
ON CONFLICT (country_id, chunk_x, chunk_y, district_id)
DO UPDATE SET cells_json = EXCLUDED.cells_json;
