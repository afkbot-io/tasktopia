ALTER TABLE tasks_v3
  ADD COLUMN visual_kind text NOT NULL DEFAULT 'BUILDING'
  CHECK (visual_kind IN ('BUILDING', 'PARK')),
  ADD COLUMN visual_asset_key text;

UPDATE tasks_v3
SET visual_asset_key = building_type
WHERE visual_asset_key IS NULL;

ALTER TABLE tasks_v3
  ADD CONSTRAINT tasks_v3_park_asset_check CHECK (
    (visual_kind = 'BUILDING' AND visual_asset_key = building_type)
    OR (
      visual_kind = 'PARK'
      AND visual_asset_key IN (
        'urban-formal', 'urban-community', 'urban-central',
        'urban-botanical', 'urban-amusement', 'urban-park'
      )
    )
  );

CREATE INDEX tasks_v3_visual_kind_idx ON tasks_v3(visual_kind, visual_asset_key);

-- Historical unnumbered parks remain environmental greenery. Numbered parks
-- are task visuals from this migration onward.
UPDATE world_features_v6
SET kind = 'GROVE', asset_key = 'urban-grove'
WHERE asset_kind = 'AREA' AND kind = 'PARK';
