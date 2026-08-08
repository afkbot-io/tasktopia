-- Country-level State Archive. It replaces the experimental TEMPLATE city
-- without changing the country -> city -> district -> task work hierarchy.

CREATE TABLE country_archives_v1 (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  country_id text NOT NULL UNIQUE REFERENCES countries(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, country_id)
);

CREATE TABLE country_archive_records_v1 (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  archive_id text NOT NULL,
  country_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('PROJECT', 'REPOSITORY', 'ARCHITECTURE', 'CONVENTION', 'ENVIRONMENT', 'TEMPLATE')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 160),
  body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 32000),
  source_url text CHECK (source_url IS NULL OR char_length(source_url) <= 2000),
  tags_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags_json) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (archive_id, country_id) REFERENCES country_archives_v1(id, country_id) ON DELETE CASCADE
);
CREATE INDEX country_archive_records_archive_idx ON country_archive_records_v1(archive_id, kind, created_at, id);
CREATE INDEX country_archive_records_country_idx ON country_archive_records_v1(country_id, created_at, id);

INSERT INTO country_archives_v1(country_id, created_at, updated_at)
SELECT id, created_at, created_at FROM countries
ON CONFLICT(country_id) DO NOTHING;

CREATE FUNCTION create_country_archive_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO country_archives_v1(country_id, created_at, updated_at)
  VALUES (NEW.id, NEW.created_at, NEW.created_at)
  ON CONFLICT(country_id) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER countries_archive_insert_v1 AFTER INSERT ON countries
  FOR EACH ROW EXECUTE FUNCTION create_country_archive_v1();

-- Preserve useful Starter City cards while mapping their deliberately small
-- taxonomy to the archive taxonomy. The old TEXT JSON column is explicitly
-- converted, avoiding the PostgreSQL driver array/string ambiguity.
INSERT INTO country_archive_records_v1
  (id, archive_id, country_id, kind, title, body, source_url, tags_json, created_at, updated_at)
SELECT card.id, archive.id, card.country_id,
  CASE card.kind WHEN 'CONVENTION' THEN 'CONVENTION' WHEN 'TEMPLATE' THEN 'TEMPLATE' ELSE 'PROJECT' END,
  card.title, card.body, NULL,
  CASE WHEN card.tags_json ~ '^\s*\[' THEN card.tags_json::jsonb ELSE '[]'::jsonb END,
  card.created_at::timestamptz, card.updated_at::timestamptz
FROM city_reference_cards_v1 card
JOIN country_archives_v1 archive ON archive.country_id = card.country_id
ON CONFLICT(id) DO NOTHING;

-- TEMPLATE cities were a short-lived non-work container. Remove their private
-- geometry after records have been preserved; regular WORK cities are intact.
DELETE FROM roads_v3 road USING cities_v3 city
WHERE city.kind = 'TEMPLATE' AND road.country_id = city.country_id
  AND road.x BETWEEN (city.bounds_json->>'minX')::integer AND (city.bounds_json->>'maxX')::integer
  AND road.y BETWEEN (city.bounds_json->>'minY')::integer AND (city.bounds_json->>'maxY')::integer;
DELETE FROM cities_v3 WHERE kind = 'TEMPLATE';

DROP TABLE city_reference_cards_v1;
DROP INDEX idx_cities_template_per_country;
ALTER TABLE cities_v3 DROP COLUMN kind;
DROP TYPE city_kind;
