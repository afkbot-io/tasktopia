ALTER TABLE cities_v3 ADD CONSTRAINT cities_v3_id_country_v1_uid UNIQUE (id, country_id);

CREATE TABLE city_layouts_v1 (
  id text PRIMARY KEY,
  country_id text NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  city_id text NOT NULL,
  generator_version text NOT NULL CHECK (generator_version = 'block-v1'),
  seed integer NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL DEFAULT 'GENERATING'
    CHECK (status IN ('GENERATING', 'VALIDATING', 'READY', 'ACTIVE', 'SUPERSEDED', 'FAILED')),
  bounds_json jsonb NOT NULL CHECK (jsonb_typeof(bounds_json) = 'object'),
  checksum text CHECK (checksum IS NULL OR checksum ~ '^[a-f0-9]{64}$'),
  failure_json jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  activated_at timestamptz,
  UNIQUE (city_id, revision),
  UNIQUE (id, city_id),
  FOREIGN KEY (city_id, country_id) REFERENCES cities_v3(id, country_id) ON DELETE CASCADE,
  CHECK (status NOT IN ('READY', 'ACTIVE', 'SUPERSEDED') OR checksum IS NOT NULL),
  CHECK (status <> 'ACTIVE' OR activated_at IS NOT NULL)
);

CREATE UNIQUE INDEX city_layouts_v1_one_active_city_uidx
  ON city_layouts_v1(city_id) WHERE status = 'ACTIVE';
CREATE INDEX city_layouts_v1_country_idx ON city_layouts_v1(country_id, city_id, revision DESC);

CREATE FUNCTION enforce_city_layout_v1_transition() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'GENERATING' THEN
      RAISE EXCEPTION 'A block-v1 layout must start in GENERATING status';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status = 'GENERATING' AND NEW.status IN ('VALIDATING', 'FAILED')) OR
    (OLD.status = 'VALIDATING' AND NEW.status IN ('READY', 'FAILED')) OR
    (OLD.status = 'READY' AND NEW.status IN ('ACTIVE', 'FAILED')) OR
    (OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED')
  ) THEN
    RAISE EXCEPTION 'Invalid block-v1 layout transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER city_layouts_v1_transition_guard
  BEFORE INSERT OR UPDATE OF status ON city_layouts_v1
  FOR EACH ROW EXECUTE FUNCTION enforce_city_layout_v1_transition();

CREATE TABLE district_layouts_v1 (
  id text PRIMARY KEY,
  layout_id text NOT NULL REFERENCES city_layouts_v1(id) ON DELETE CASCADE,
  district_id text NOT NULL REFERENCES districts_v3(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence >= 0),
  archetype text NOT NULL,
  bounds_json jsonb NOT NULL CHECK (jsonb_typeof(bounds_json) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (layout_id, district_id),
  UNIQUE (layout_id, sequence),
  UNIQUE (id, layout_id)
);

CREATE FUNCTION enforce_district_layout_v1_city() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM city_layouts_v1 layout
    JOIN districts_v3 district ON district.id = NEW.district_id
    WHERE layout.id = NEW.layout_id AND district.city_id = layout.city_id
  ) THEN
    RAISE EXCEPTION 'Block-v1 district does not belong to the layout city';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER district_layouts_v1_city_guard
  BEFORE INSERT OR UPDATE OF layout_id, district_id ON district_layouts_v1
  FOR EACH ROW EXECUTE FUNCTION enforce_district_layout_v1_city();

CREATE TABLE city_blocks_v1 (
  id text PRIMARY KEY,
  layout_id text NOT NULL REFERENCES city_layouts_v1(id) ON DELETE CASCADE,
  district_layout_id text NOT NULL,
  sequence integer NOT NULL CHECK (sequence >= 0),
  kind text NOT NULL CHECK (kind IN ('RESIDENTIAL', 'CIVIC', 'PARK', 'WATER', 'INDUSTRIAL', 'TRANSPORT')),
  template_key text NOT NULL,
  template_version integer NOT NULL CHECK (template_version > 0),
  variant text NOT NULL,
  seed integer NOT NULL,
  origin_x integer NOT NULL,
  origin_y integer NOT NULL,
  width integer NOT NULL CHECK (width > 0 AND width % 4 = 0),
  height integer NOT NULL CHECK (height > 0 AND height % 4 = 0),
  parameters_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parameters_json) = 'object'),
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary_json) = 'object'),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (district_layout_id, layout_id)
    REFERENCES district_layouts_v1(id, layout_id) ON DELETE CASCADE,
  UNIQUE (layout_id, district_layout_id, sequence),
  UNIQUE (id, layout_id)
);
CREATE INDEX city_blocks_v1_layout_position_idx ON city_blocks_v1(layout_id, origin_y, origin_x);

CREATE TABLE road_networks_v1 (
  id text PRIMARY KEY,
  layout_id text NOT NULL UNIQUE REFERENCES city_layouts_v1(id) ON DELETE CASCADE,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  nodes_json jsonb NOT NULL CHECK (jsonb_typeof(nodes_json) = 'array'),
  segments_json jsonb NOT NULL CHECK (jsonb_typeof(segments_json) = 'array'),
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL
);

CREATE TABLE task_placements_v1 (
  task_id text NOT NULL REFERENCES tasks_v3(id) ON DELETE CASCADE,
  layout_id text NOT NULL REFERENCES city_layouts_v1(id) ON DELETE CASCADE,
  block_id text NOT NULL,
  slot_key text NOT NULL,
  building_family text NOT NULL,
  facade_variant text NOT NULL,
  construction_stage integer NOT NULL CHECK (construction_stage BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (block_id, layout_id) REFERENCES city_blocks_v1(id, layout_id) ON DELETE CASCADE,
  PRIMARY KEY (layout_id, task_id),
  UNIQUE (block_id, slot_key)
);
CREATE INDEX task_placements_v1_layout_idx ON task_placements_v1(layout_id, block_id);
CREATE INDEX task_placements_v1_task_idx ON task_placements_v1(task_id, layout_id);

CREATE TABLE site_markers_v1 (
  id text PRIMARY KEY,
  layout_id text NOT NULL REFERENCES city_layouts_v1(id) ON DELETE CASCADE,
  block_id text NOT NULL,
  slot_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('RUINED', 'RELOCATED')),
  target_task_id text REFERENCES tasks_v3(id) ON DELETE SET NULL,
  snapshot_json jsonb NOT NULL CHECK (jsonb_typeof(snapshot_json) = 'object'),
  asset_variant text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  cleared_at timestamptz,
  FOREIGN KEY (block_id, layout_id) REFERENCES city_blocks_v1(id, layout_id) ON DELETE CASCADE,
  CHECK (kind = 'RELOCATED' OR (kind = 'RUINED' AND target_task_id IS NULL))
);
CREATE UNIQUE INDEX site_markers_v1_active_slot_uidx
  ON site_markers_v1(block_id, slot_key) WHERE cleared_at IS NULL;
CREATE INDEX site_markers_v1_target_idx ON site_markers_v1(target_task_id) WHERE target_task_id IS NOT NULL;

CREATE FUNCTION enforce_task_placement_v1_ownership() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM city_blocks_v1 block
    JOIN district_layouts_v1 district_layout ON district_layout.id = block.district_layout_id
    JOIN city_layouts_v1 layout ON layout.id = block.layout_id
    JOIN tasks_v3 task ON task.id = NEW.task_id
    WHERE block.id = NEW.block_id AND block.layout_id = NEW.layout_id
      AND task.city_id = layout.city_id AND task.district_id = district_layout.district_id
  ) THEN
    RAISE EXCEPTION 'Block-v1 task placement does not belong to the block district';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_placements_v1_ownership_guard
  BEFORE INSERT OR UPDATE OF task_id, layout_id, block_id ON task_placements_v1
  FOR EACH ROW EXECUTE FUNCTION enforce_task_placement_v1_ownership();

CREATE FUNCTION enforce_block_v1_slot_exclusivity() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.block_id || ':' || NEW.slot_key));
  IF TG_TABLE_NAME = 'task_placements_v1' THEN
    IF EXISTS (SELECT 1 FROM site_markers_v1
      WHERE block_id = NEW.block_id AND slot_key = NEW.slot_key AND cleared_at IS NULL) THEN
      RAISE EXCEPTION 'Block-v1 slot % is occupied by an active site marker', NEW.slot_key;
    END IF;
  ELSIF NEW.cleared_at IS NULL AND EXISTS (
    SELECT 1 FROM task_placements_v1 WHERE block_id = NEW.block_id AND slot_key = NEW.slot_key
  ) THEN
    RAISE EXCEPTION 'Block-v1 slot % is occupied by an active task placement', NEW.slot_key;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER task_placements_v1_slot_guard
  BEFORE INSERT OR UPDATE OF block_id, slot_key ON task_placements_v1
  FOR EACH ROW EXECUTE FUNCTION enforce_block_v1_slot_exclusivity();
CREATE TRIGGER site_markers_v1_slot_guard
  BEFORE INSERT OR UPDATE OF block_id, slot_key, cleared_at ON site_markers_v1
  FOR EACH ROW EXECUTE FUNCTION enforce_block_v1_slot_exclusivity();
