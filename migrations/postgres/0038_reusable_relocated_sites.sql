-- Relocation history survives, but no longer owns land. Ruins stay reserved.
DROP INDEX site_markers_v1_slot_uidx;
CREATE UNIQUE INDEX site_markers_v1_slot_uidx ON site_markers_v1(block_id,slot_key) WHERE kind='RUINED';
CREATE OR REPLACE FUNCTION enforce_block_v1_slot_exclusivity() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.block_id || ':' || NEW.slot_key));
  IF TG_TABLE_NAME = 'task_placements_v1' THEN
    IF EXISTS (SELECT 1 FROM site_markers_v1 WHERE block_id=NEW.block_id AND slot_key=NEW.slot_key AND kind='RUINED') THEN
      RAISE EXCEPTION 'Block-v1 slot % is occupied by a permanent ruin', NEW.slot_key;
    END IF;
  ELSIF NEW.kind='RUINED' AND EXISTS (SELECT 1 FROM task_placements_v1 WHERE block_id=NEW.block_id AND slot_key=NEW.slot_key) THEN
    RAISE EXCEPTION 'Block-v1 slot % is occupied by an active task placement', NEW.slot_key;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Immutable history guard, foreign keys and business records remain intact.
DELETE FROM world_chunk_payloads_v1;
DELETE FROM country_overview_snapshots_v1;
UPDATE countries SET world_version=world_version+1;

-- Released parcels must not retain a former landmark/service reservation.
WITH released AS (
  SELECT m.block_id,array_agg(DISTINCT m.slot_key) AS keys FROM site_markers_v1 m
  WHERE m.kind='RELOCATED' AND m.block_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM task_placements_v1 p WHERE p.block_id=m.block_id AND p.slot_key=m.slot_key)
    AND NOT EXISTS (SELECT 1 FROM site_markers_v1 r WHERE r.block_id=m.block_id AND r.slot_key=m.slot_key AND r.kind='RUINED')
  GROUP BY m.block_id
)
UPDATE city_blocks_v1 b SET parameters_json=b.parameters_json || jsonb_build_object(
  'slotFamilies',COALESCE(b.parameters_json->'slotFamilies','{}'::jsonb)-released.keys,
  'slotRoles',COALESCE(b.parameters_json->'slotRoles','{}'::jsonb)-released.keys,
  'slotRoleTriggers',COALESCE(b.parameters_json->'slotRoleTriggers','{}'::jsonb)-released.keys,
  'slotPortPlans',COALESCE(b.parameters_json->'slotPortPlans','{}'::jsonb)-released.keys)
FROM released WHERE released.block_id=b.id;
