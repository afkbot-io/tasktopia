-- Extend task-backed public-space variants. No geometry/task reset and no
-- per-tile storage. Keep the BUILDING identity constraint equally strict.
ALTER TABLE tasks_v3 DROP CONSTRAINT tasks_v3_park_asset_check;
ALTER TABLE tasks_v3 ADD CONSTRAINT tasks_v3_park_asset_check CHECK (
  visual_asset_key IS NOT NULL AND (
    (visual_kind = 'BUILDING' AND visual_asset_key = building_type)
    OR (visual_kind = 'PARK' AND visual_asset_key IN (
      'urban-formal', 'urban-community', 'urban-central', 'urban-botanical',
      'urban-amusement', 'urban-park', 'urban-lake', 'urban-parking',
      'urban-pocket', 'urban-large', 'urban-fountain', 'urban-monument',
      'urban-memorial', 'urban-orchard', 'urban-promenade'
    ))
  )
) NOT VALID;
ALTER TABLE tasks_v3 VALIDATE CONSTRAINT tasks_v3_park_asset_check;
