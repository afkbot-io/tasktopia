ALTER TABLE world_features_v6
  ADD COLUMN district_id text REFERENCES districts_v3(id) ON DELETE CASCADE,
  ADD COLUMN parent_feature_id text REFERENCES world_features_v6(id) ON DELETE CASCADE;

-- Older green features predate explicit district ownership. The origin is
-- guaranteed to be inside the district that published the area.
WITH ownership AS (
  SELECT DISTINCT ON (feature.id) feature.id AS feature_id, district.id AS district_id
  FROM world_features_v6 feature
  JOIN districts_v3 district ON district.city_id = feature.city_id
  CROSS JOIN LATERAL jsonb_array_elements(district.cells_json) AS cell
  WHERE feature.kind IN ('PARK', 'GROVE', 'PARK_DECOR')
    AND feature.district_id IS NULL
    AND (cell->>'x')::integer = feature.origin_x
    AND (cell->>'y')::integer = feature.origin_y
  ORDER BY feature.id, district.created_at
)
UPDATE world_features_v6 feature
SET district_id = ownership.district_id
FROM ownership
WHERE feature.id = ownership.feature_id;

-- Decorations inside an existing park/grove belong to that area. This makes
-- a parent deletion atomic as well as a district deletion.
UPDATE world_features_v6 decoration
SET parent_feature_id = area.id
FROM world_features_v6 area
WHERE decoration.kind = 'PARK_DECOR'
  AND area.kind IN ('PARK', 'GROVE')
  AND decoration.city_id = area.city_id
  AND decoration.district_id = area.district_id
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(area.footprint_json) AS cell
    WHERE (cell->>'x')::integer = decoration.origin_x
      AND (cell->>'y')::integer = decoration.origin_y
  );

CREATE INDEX world_features_v6_district_idx ON world_features_v6(district_id);
CREATE INDEX world_features_v6_parent_idx ON world_features_v6(parent_feature_id);
