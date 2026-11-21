-- The parcel belongs to district_id; work may continue in another sprint.
ALTER TABLE tasks_v3 ADD COLUMN work_district_id text REFERENCES districts_v3(id) ON DELETE CASCADE;
UPDATE tasks_v3 SET work_district_id=district_id;
ALTER TABLE tasks_v3 ALTER COLUMN work_district_id SET NOT NULL;
CREATE INDEX tasks_v3_work_district_idx ON tasks_v3(work_district_id,updated_at DESC,id DESC);

CREATE TABLE task_sprint_phases_v1 (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks_v3(id) ON DELETE CASCADE,
  district_id text NOT NULL REFERENCES districts_v3(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK(sequence>0),
  outcome text NOT NULL CHECK(outcome IN ('OPEN','CARRIED','COMPLETED')),
  entry_status text NOT NULL,
  entry_progress integer NOT NULL CHECK(entry_progress BETWEEN 0 AND 100),
  entry_estimate integer NOT NULL,
  exit_status text,
  exit_progress integer CHECK(exit_progress BETWEEN 0 AND 100),
  exit_estimate integer,
  entered_at timestamptz NOT NULL,
  exited_at timestamptz,
  comment text NOT NULL DEFAULT '',
  UNIQUE(task_id,sequence), UNIQUE(task_id,district_id),
  CHECK((outcome='OPEN' AND exited_at IS NULL AND exit_status IS NULL AND exit_progress IS NULL AND exit_estimate IS NULL)
    OR (outcome<>'OPEN' AND exited_at IS NOT NULL AND exit_status IS NOT NULL AND exit_progress IS NOT NULL AND exit_estimate IS NOT NULL))
);
CREATE UNIQUE INDEX task_sprint_phases_v1_open_idx ON task_sprint_phases_v1(task_id) WHERE outcome='OPEN';
CREATE INDEX task_sprint_phases_v1_district_idx ON task_sprint_phases_v1(district_id,task_id);
CREATE FUNCTION enforce_task_work_district() RETURNS trigger AS $$
BEGIN
  IF TG_OP='INSERT' AND NEW.work_district_id IS NULL THEN NEW.work_district_id=NEW.district_id; END IF;
  IF TG_OP='UPDATE' AND NEW.district_id IS DISTINCT FROM OLD.district_id THEN
    IF EXISTS(SELECT 1 FROM task_sprint_phases_v1 WHERE task_id=OLD.id)
      THEN RAISE EXCEPTION 'Continuation home district is immutable'; END IF;
    IF OLD.work_district_id=OLD.district_id AND NEW.work_district_id=OLD.work_district_id
      THEN NEW.work_district_id=NEW.district_id; END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM districts_v3 WHERE id=NEW.work_district_id AND city_id=NEW.city_id)
    THEN RAISE EXCEPTION 'Task work district must belong to its city'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tasks_v3_work_district_guard BEFORE INSERT OR UPDATE OF city_id,district_id,work_district_id
  ON tasks_v3 FOR EACH ROW EXECUTE FUNCTION enforce_task_work_district();

-- Old district.delete writers pre-delete tasks before their district. Fence
-- both paths; only a current explicit task/city command grants local intent.
CREATE FUNCTION preserve_continuation_task_deletion() RETURNS trigger AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM task_sprint_phases_v1 WHERE task_id=OLD.id)
    AND EXISTS(SELECT 1 FROM cities_v3 WHERE id=OLD.city_id)
    AND current_setting('tasktopia.continuation_delete',true) IS DISTINCT FROM 'task:'||OLD.id
    AND current_setting('tasktopia.continuation_delete',true) IS DISTINCT FROM 'city:'||OLD.city_id
    THEN RAISE EXCEPTION 'Continuation deletion requires an explicit current task or city command'; END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tasks_v3_continuation_delete_guard BEFORE DELETE ON tasks_v3
  FOR EACH ROW EXECUTE FUNCTION preserve_continuation_task_deletion();
CREATE FUNCTION preserve_continuation_district() RETURNS trigger AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM cities_v3 WHERE id=OLD.city_id)
    AND EXISTS(SELECT 1 FROM task_sprint_phases_v1 WHERE district_id=OLD.id)
    THEN RAISE EXCEPTION 'District participates in a task continuation'; END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER districts_v3_continuation_guard BEFORE DELETE ON districts_v3
  FOR EACH ROW EXECUTE FUNCTION preserve_continuation_district();

CREATE FUNCTION enforce_task_sprint_phase() RETURNS trigger AS $$
BEGIN
  IF TG_OP='UPDATE' AND (OLD.outcome<>'OPEN' OR
    ROW(NEW.id,NEW.task_id,NEW.district_id,NEW.sequence,NEW.entry_status,NEW.entry_progress,NEW.entry_estimate,NEW.entered_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.task_id,OLD.district_id,OLD.sequence,OLD.entry_status,OLD.entry_progress,OLD.entry_estimate,OLD.entered_at))
    THEN RAISE EXCEPTION 'Closed sprint participation is immutable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM tasks_v3 t JOIN districts_v3 d ON d.city_id=t.city_id
    WHERE t.id=NEW.task_id AND d.id=NEW.district_id AND (NEW.outcome<>'OPEN' OR t.work_district_id=d.id))
    THEN RAISE EXCEPTION 'Sprint participation must belong to the task city and current sprint'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER task_sprint_phases_v1_guard BEFORE INSERT OR UPDATE ON task_sprint_phases_v1
  FOR EACH ROW EXECUTE FUNCTION enforce_task_sprint_phase();

-- One authoritative read model for live and historical sprint accounting.
CREATE VIEW task_sprint_participation_v1 AS
  SELECT t.id AS task_id,t.work_district_id AS district_id,t.estimate AS planned_sp,
    CASE WHEN t.status<>'COMPLETED' THEN t.estimate ELSE 0 END AS open_sp,
    CASE WHEN t.status='COMPLETED' THEN t.estimate ELSE 0 END AS completed_sp,
    CASE WHEN t.status='COMPLETED' THEN 'COMPLETED' ELSE 'OPEN' END AS outcome,
    t.status,t.progress
  FROM tasks_v3 t WHERE NOT EXISTS(SELECT 1 FROM task_sprint_phases_v1 p WHERE p.task_id=t.id)
  UNION ALL
  SELECT p.task_id,p.district_id,p.entry_estimate,
    CASE WHEN p.outcome='OPEN' AND t.status<>'COMPLETED' THEN t.estimate ELSE 0 END,
    CASE WHEN p.outcome='COMPLETED' THEN p.exit_estimate ELSE 0 END,p.outcome,
    CASE WHEN p.outcome='OPEN' THEN t.status ELSE p.exit_status END,
    CASE WHEN p.outcome='OPEN' THEN t.progress ELSE p.exit_progress END
  FROM task_sprint_phases_v1 p JOIN tasks_v3 t ON t.id=p.task_id;

-- Continuations reserve a real parcel but never create another task or service.
ALTER TABLE site_markers_v1 DROP CONSTRAINT site_markers_v1_kind_check;
ALTER TABLE site_markers_v1 ADD CONSTRAINT site_markers_v1_kind_check CHECK(kind IN ('RUINED','RELOCATED','CONTINUATION'));
ALTER TABLE site_markers_v1 DROP CONSTRAINT site_markers_v1_check;
ALTER TABLE site_markers_v1 ADD CONSTRAINT site_markers_v1_check
  CHECK(kind IN ('RELOCATED','CONTINUATION') OR (kind='RUINED' AND target_task_id IS NULL));
DROP INDEX site_markers_v1_slot_uidx;
CREATE UNIQUE INDEX site_markers_v1_slot_uidx ON site_markers_v1(block_id,slot_key) WHERE kind IN ('RUINED','CONTINUATION');
CREATE OR REPLACE FUNCTION enforce_block_v1_slot_exclusivity() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.block_id || ':' || NEW.slot_key));
  IF TG_TABLE_NAME='task_placements_v1' THEN
    IF EXISTS(SELECT 1 FROM site_markers_v1 WHERE block_id=NEW.block_id AND slot_key=NEW.slot_key AND kind IN ('RUINED','CONTINUATION'))
      THEN RAISE EXCEPTION 'Block-v1 slot % is occupied by a permanent site',NEW.slot_key; END IF;
  ELSIF NEW.kind IN ('RUINED','CONTINUATION') AND EXISTS(SELECT 1 FROM task_placements_v1 WHERE block_id=NEW.block_id AND slot_key=NEW.slot_key)
    THEN RAISE EXCEPTION 'Block-v1 slot % is occupied by a task',NEW.slot_key;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE world_generation_jobs_v1 DROP CONSTRAINT world_generation_jobs_v1_operation_check;
ALTER TABLE world_generation_jobs_v1 ADD CONSTRAINT world_generation_jobs_v1_operation_check CHECK(operation IN (
  'city.create','district.create','task.create','country.regenerate','task.set_status','task.transfer','task.continue',
  'task.delete','city.delete','district.delete','district.complete'));
-- Pre-continuation workers must never claim a command they cannot execute.
ALTER TABLE world_generation_jobs_v1 DROP CONSTRAINT world_generation_jobs_v1_status_check;
ALTER TABLE world_generation_jobs_v1 ADD CONSTRAINT world_generation_jobs_v1_status_check CHECK(status IN (
  'PENDING','RUNNING','QUEUED','EXECUTING','CONTINUE_QUEUED','CONTINUE_EXECUTING','COMPLETED','FAILED'));
DROP INDEX world_generation_jobs_v1_claim_idx;
CREATE INDEX world_generation_jobs_v1_claim_idx ON world_generation_jobs_v1(status,created_at,id)
  WHERE status IN ('PENDING','RUNNING','QUEUED','EXECUTING','CONTINUE_QUEUED','CONTINUE_EXECUTING');
DROP INDEX world_generation_jobs_v1_country_fifo_idx;
CREATE INDEX world_generation_jobs_v1_country_fifo_idx ON world_generation_jobs_v1(country_id,created_at,id)
  WHERE status IN ('PENDING','RUNNING','QUEUED','EXECUTING','CONTINUE_QUEUED','CONTINUE_EXECUTING');

-- Every domain mutation/replay commits through world_version. An old worker
-- may already own a legacy job when the first continuation commits: reject
-- its entire transaction, including status, sprint and layout changes. Marker
-- ownership outlives task deletion, so a pre-delete cannot evade this fence.
CREATE INDEX site_markers_v1_continuation_country_idx ON site_markers_v1(country_id) WHERE kind='CONTINUATION';
CREATE FUNCTION require_continuation_writer() RETURNS trigger AS $$
BEGIN
  IF NEW.world_version IS DISTINCT FROM OLD.world_version
    AND current_setting('tasktopia.sprint_continuations',true) IS DISTINCT FROM '1'
    AND EXISTS(SELECT 1 FROM site_markers_v1 WHERE country_id=OLD.id AND kind='CONTINUATION')
    THEN RAISE EXCEPTION 'Continuation country requires a compatible writer'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER countries_continuation_writer_guard BEFORE UPDATE OF world_version ON countries
  FOR EACH ROW EXECUTE FUNCTION require_continuation_writer();
