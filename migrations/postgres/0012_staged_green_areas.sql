ALTER TABLE world_features_v6
  ADD COLUMN development_stage integer NOT NULL DEFAULT 5
  CHECK(development_stage BETWEEN 1 AND 5);
