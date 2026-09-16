-- Opt-in geography for newly created countries. Existing countries stay NULL.
ALTER TABLE countries ADD COLUMN terrain_profile_json jsonb;
ALTER TABLE countries ADD CONSTRAINT countries_terrain_profile_check CHECK (
  terrain_profile_json IS NULL OR (
    jsonb_typeof(terrain_profile_json) = 'object'
    AND terrain_profile_json @> '{"version":1,"kind":"EAST_COAST"}'::jsonb
    AND terrain_profile_json ? 'coastX'
    AND CASE WHEN jsonb_typeof(terrain_profile_json->'coastX') = 'number'
      THEN (terrain_profile_json->>'coastX')::numeric BETWEEN -1000000 AND 1000000
        AND trunc((terrain_profile_json->>'coastX')::numeric) = (terrain_profile_json->>'coastX')::numeric
      ELSE false END
  )
);

CREATE FUNCTION keep_country_terrain_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.terrain_profile_json IS DISTINCT FROM NEW.terrain_profile_json THEN
    RAISE EXCEPTION 'Country terrain profile is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER countries_keep_terrain_profile
  BEFORE UPDATE OF terrain_profile_json ON countries
  FOR EACH ROW EXECUTE FUNCTION keep_country_terrain_profile();
