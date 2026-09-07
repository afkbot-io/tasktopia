-- Business-owned site history must outlive disposable city/block projections.
ALTER TABLE tasks_v3 ADD COLUMN service_role text
  CHECK (service_role IN ('EDUCATION','MEDICAL','FIRE','POLICE','SHOP','RAILWAY','AIRPORT'));
ALTER TABLE tasks_v3 ADD COLUMN service_trigger text;
ALTER TABLE tasks_v3 ADD COLUMN service_role_assigned boolean NOT NULL DEFAULT false;
UPDATE tasks_v3 t SET service_role=b.parameters_json->'slotRoles'->>p.slot_key,
  service_trigger=b.parameters_json->'slotRoleTriggers'->>p.slot_key,service_role_assigned=true
FROM task_placements_v1 p JOIN city_blocks_v1 b ON b.id=p.block_id
JOIN city_layouts_v1 l ON l.id=p.layout_id AND l.status='ACTIVE'
WHERE t.id=p.task_id;

ALTER TABLE site_markers_v1 ADD COLUMN country_id text REFERENCES countries(id) ON DELETE CASCADE;
ALTER TABLE site_markers_v1 ADD COLUMN city_id text;
ALTER TABLE site_markers_v1 ADD COLUMN district_id text;
ALTER TABLE site_markers_v1 ADD COLUMN block_snapshot_json jsonb;
ALTER TABLE site_markers_v1 ADD COLUMN geometry_json jsonb;
UPDATE site_markers_v1 m SET country_id=l.country_id,city_id=l.city_id,district_id=d.district_id,
  block_snapshot_json=to_jsonb(b)
FROM city_blocks_v1 b JOIN city_layouts_v1 l ON l.id=b.layout_id
JOIN district_layouts_v1 d ON d.id=b.district_layout_id WHERE m.block_id=b.id;
ALTER TABLE site_markers_v1 ALTER COLUMN country_id SET NOT NULL;
ALTER TABLE site_markers_v1 ALTER COLUMN city_id SET NOT NULL;
ALTER TABLE site_markers_v1 ALTER COLUMN district_id SET NOT NULL;
ALTER TABLE site_markers_v1 ALTER COLUMN block_snapshot_json SET NOT NULL;
ALTER TABLE site_markers_v1 DROP CONSTRAINT site_markers_v1_layout_id_fkey;
ALTER TABLE site_markers_v1 DROP CONSTRAINT site_markers_v1_block_id_layout_id_fkey;
ALTER TABLE site_markers_v1 ALTER COLUMN layout_id DROP NOT NULL;
ALTER TABLE site_markers_v1 ALTER COLUMN block_id DROP NOT NULL;
ALTER TABLE site_markers_v1 ADD FOREIGN KEY (block_id,layout_id)
  REFERENCES city_blocks_v1(id,layout_id) ON DELETE SET NULL;
CREATE INDEX site_markers_v1_country_idx ON site_markers_v1(country_id,city_id);
CREATE INDEX site_markers_v1_unfrozen_idx ON site_markers_v1(country_id) WHERE geometry_json IS NULL;
CREATE INDEX site_markers_v1_orphan_idx ON site_markers_v1(country_id) WHERE layout_id IS NULL;

-- No application writer ever cleared a marker. Refuse an ambiguous upgrade
-- rather than revive a manually-cleared parcel already assigned to another task.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM site_markers_v1 WHERE cleared_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Permanent site migration requires review of manually cleared markers';
  END IF;
END $$;
DROP TRIGGER site_markers_v1_slot_guard ON site_markers_v1;
DROP INDEX site_markers_v1_active_slot_uidx;
ALTER TABLE site_markers_v1 DROP COLUMN cleared_at;
CREATE UNIQUE INDEX site_markers_v1_slot_uidx ON site_markers_v1(block_id,slot_key);
CREATE OR REPLACE FUNCTION enforce_block_v1_slot_exclusivity() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.block_id || ':' || NEW.slot_key));
  IF TG_TABLE_NAME = 'task_placements_v1' THEN
    IF EXISTS (SELECT 1 FROM site_markers_v1 WHERE block_id=NEW.block_id AND slot_key=NEW.slot_key) THEN
      RAISE EXCEPTION 'Block-v1 slot % is occupied by a permanent site marker', NEW.slot_key;
    END IF;
  ELSIF EXISTS (SELECT 1 FROM task_placements_v1 WHERE block_id=NEW.block_id AND slot_key=NEW.slot_key) THEN
    RAISE EXCEPTION 'Block-v1 slot % is occupied by an active task placement', NEW.slot_key;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER site_markers_v1_slot_guard BEFORE INSERT OR UPDATE OF block_id,slot_key
  ON site_markers_v1 FOR EACH ROW EXECUTE FUNCTION enforce_block_v1_slot_exclusivity();

CREATE FUNCTION preserve_permanent_task_site() RETURNS trigger AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT l.country_id,l.city_id,d.district_id,to_jsonb(b)
      INTO NEW.country_id,NEW.city_id,NEW.district_id,NEW.block_snapshot_json
      FROM city_blocks_v1 b JOIN city_layouts_v1 l ON l.id=b.layout_id
      JOIN district_layouts_v1 d ON d.id=b.district_layout_id WHERE b.id=NEW.block_id;
    IF NEW.target_task_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM tasks_v3 t JOIN cities_v3 c ON c.id=t.city_id
      WHERE t.id=NEW.target_task_id AND c.country_id=NEW.country_id
    ) THEN RAISE EXCEPTION 'Permanent site target must belong to its country'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM countries WHERE id=OLD.country_id) THEN
      RAISE EXCEPTION 'Permanent task sites can only be removed with their country';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.country_id IS DISTINCT FROM OLD.country_id OR NEW.city_id IS DISTINCT FROM OLD.city_id
    OR NEW.district_id IS DISTINCT FROM OLD.district_id OR NEW.slot_key IS DISTINCT FROM OLD.slot_key
    OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.snapshot_json IS DISTINCT FROM OLD.snapshot_json
    OR NEW.block_snapshot_json IS DISTINCT FROM OLD.block_snapshot_json
    OR NEW.asset_variant IS DISTINCT FROM OLD.asset_variant OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.geometry_json IS NOT NULL AND NEW.geometry_json IS DISTINCT FROM OLD.geometry_json)
    OR (NEW.target_task_id IS DISTINCT FROM OLD.target_task_id AND NEW.target_task_id IS NOT NULL)
    OR (NEW.block_id IS DISTINCT FROM OLD.block_id AND NEW.block_id IS NOT NULL)
    OR (NEW.layout_id IS DISTINCT FROM OLD.layout_id AND NEW.layout_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Permanent task site history is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER site_markers_v1_history_guard BEFORE INSERT OR UPDATE OR DELETE ON site_markers_v1
  FOR EACH ROW EXECUTE FUNCTION preserve_permanent_task_site();

-- Existing published projections lack historical marker metadata. Invalidate
-- only affected countries; no product rows, layouts or history are discarded.
DELETE FROM world_chunk_payloads_v1 WHERE country_id IN (SELECT country_id FROM site_markers_v1);
DELETE FROM country_overview_snapshots_v1 WHERE country_id IN (SELECT country_id FROM site_markers_v1);
UPDATE countries SET world_version=world_version+1 WHERE id IN (SELECT country_id FROM site_markers_v1);
