-- Additive: old images keep their columns and command receipts. Their MAX+1
-- inserts also pass the allocator, so an image rollback cannot reuse a number.
ALTER TABLE countries ADD COLUMN task_number_counter bigint NOT NULL DEFAULT 0 CHECK (task_number_counter >= 0);
ALTER TABLE countries ADD COLUMN generation_last_served_at timestamptz NOT NULL DEFAULT 'epoch';

WITH historical_numbers AS (
  SELECT city.country_id, task.task_number::bigint AS task_number
  FROM tasks_v3 task JOIN cities_v3 city ON city.id=task.city_id
  UNION ALL
  SELECT country_id, (snapshot_json->>'taskNumber')::bigint FROM site_markers_v1
  WHERE snapshot_json->>'taskNumber' ~ '^[0-9]{1,10}$'
  UNION ALL
  SELECT receipt.country_id, (number.value #>> '{}')::bigint
  FROM idempotency receipt CROSS JOIN LATERAL jsonb_path_query(receipt.response_json, '$.**.taskNumber') number(value)
  WHERE number.value #>> '{}' ~ '^[0-9]{1,10}$'
  UNION ALL
  SELECT event.country_id, (number.value #>> '{}')::bigint
  FROM events event CROSS JOIN LATERAL jsonb_path_query(event.payload_json, '$.**.taskNumber') number(value)
  WHERE number.value #>> '{}' ~ '^[0-9]{1,10}$'
), maxima AS (
  SELECT country_id, MAX(task_number) AS task_number FROM historical_numbers GROUP BY country_id
) UPDATE countries country SET task_number_counter=GREATEST(country.task_number_counter,maxima.task_number)
  FROM maxima WHERE country.id=maxima.country_id;

CREATE FUNCTION allocate_country_task_number_v1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE scope text; lifetime_number bigint;
  preserve_explicit boolean := current_setting('tasktopia.preserve_task_numbers', true) = 'on';
BEGIN
  SELECT country_id INTO scope FROM cities_v3 WHERE id=NEW.city_id;
  IF scope IS NULL THEN RETURN NEW; END IF; -- The canonical city FK reports invalid input.
  SELECT task_number_counter INTO lifetime_number FROM countries WHERE id=scope FOR UPDATE;
  IF TG_OP='INSERT' OR NEW.task_number IS DISTINCT FROM OLD.task_number OR NEW.city_id IS DISTINCT FROM OLD.city_id THEN
    IF NEW.task_number IS NULL OR NEW.task_number <= 0
      OR (NOT COALESCE(preserve_explicit,false) AND NEW.task_number <= lifetime_number) THEN
      NEW.task_number := lifetime_number + 1;
    END IF;
  END IF;
  IF NEW.task_number IS NULL OR NEW.task_number <= 0 THEN RAISE EXCEPTION 'Task number must be positive'; END IF;
  IF NEW.task_number <= lifetime_number AND EXISTS (
    SELECT 1 FROM tasks_v3 task JOIN cities_v3 city ON city.id=task.city_id
    WHERE city.country_id=scope AND task.task_number=NEW.task_number AND task.id<>NEW.id
  ) THEN RAISE EXCEPTION 'Task number is already used in this country' USING ERRCODE='23505'; END IF;
  UPDATE countries SET task_number_counter=GREATEST(task_number_counter,NEW.task_number) WHERE id=scope;
  RETURN NEW;
END;
$$;
ALTER TABLE tasks_v3 ALTER COLUMN task_number SET DEFAULT 0;
CREATE TRIGGER tasks_v3_country_number_allocator BEFORE INSERT OR UPDATE OF task_number,city_id ON tasks_v3
  FOR EACH ROW EXECUTE FUNCTION allocate_country_task_number_v1();

CREATE INDEX world_generation_jobs_v1_country_fifo_idx ON world_generation_jobs_v1(country_id,created_at,id)
  WHERE status IN ('PENDING','RUNNING');
CREATE INDEX task_events_v7_task_created_idx ON task_events_v7(task_id,created_at,id);
CREATE INDEX task_defects_v18_task_created_idx ON task_defects_v18(task_id,created_at,id);
CREATE INDEX task_attachments_v1_task_created_idx ON task_attachments_v1(task_id,created_at,id);
