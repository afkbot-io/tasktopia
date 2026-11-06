CREATE TABLE city_transit_stop_plans_v1 (
  layout_id text PRIMARY KEY REFERENCES city_layouts_v1(id) ON DELETE CASCADE,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version=1),
  source_block_count integer NOT NULL CHECK (source_block_count BETWEEN 0 AND 65536),
  plan_json jsonb NOT NULL CHECK (
    jsonb_typeof(plan_json)='object' AND plan_json ?& ARRAY['schemaVersion','layoutId','processedBlockIds','stops']
    AND plan_json->>'layoutId'=layout_id AND plan_json->'schemaVersion'='1'::jsonb
    AND plan_json->'layoutId'<>'null'::jsonb AND plan_json->'processedBlockIds'<>'null'::jsonb AND plan_json->'stops'<>'null'::jsonb
    AND jsonb_typeof(plan_json->'processedBlockIds')='array'
    AND jsonb_array_length(plan_json->'processedBlockIds')=source_block_count
    AND jsonb_typeof(plan_json->'stops')='array'
    AND jsonb_array_length(plan_json->'stops')<=32768
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Geometry already published to clients is append-only, including empty
-- processed blocks. Guard future writers as well as the current application.
CREATE FUNCTION preserve_city_transit_stop_prefix_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.layout_id<>OLD.layout_id OR NEW.schema_version<>OLD.schema_version
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(OLD.plan_json->'stops') WITH ORDINALITY old_stop(value,ordinal)
      WHERE (NEW.plan_json->'stops'->(old_stop.ordinal::integer-1)) IS DISTINCT FROM old_stop.value)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(OLD.plan_json->'processedBlockIds') WITH ORDINALITY old_block(value,ordinal)
      WHERE (NEW.plan_json->'processedBlockIds'->(old_block.ordinal::integer-1)) IS DISTINCT FROM old_block.value)
  THEN RAISE EXCEPTION 'Published transit stop geometry is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER city_transit_stop_prefix_v1 BEFORE UPDATE ON city_transit_stop_plans_v1
FOR EACH ROW EXECUTE FUNCTION preserve_city_transit_stop_prefix_v1();
