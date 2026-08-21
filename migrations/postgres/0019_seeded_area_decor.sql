-- Park interiors are a disposable seed projection. Keep only the parent AREA
-- row so chunk payloads and PostgreSQL never carry individual decor points.
DELETE FROM world_features_v6 WHERE kind = 'PARK_DECOR';

ALTER TABLE world_features_v6
  ADD CONSTRAINT world_features_v6_no_derived_park_decor
  CHECK (kind <> 'PARK_DECOR') NOT VALID;

ALTER TABLE world_features_v6
  VALIDATE CONSTRAINT world_features_v6_no_derived_park_decor;
