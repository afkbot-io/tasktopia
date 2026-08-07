ALTER TABLE tasks_v3 ADD COLUMN task_number integer;
ALTER TABLE tasks_v3 ADD COLUMN merge_requests_json jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Per-country serial, backfilled in creation order. New tasks take MAX+1
-- inside the creation transaction (see AppService.createTask).
WITH numbered AS (
  SELECT t.id AS task_id,
         ROW_NUMBER() OVER (PARTITION BY c.country_id ORDER BY t.created_at, t.id) AS number
  FROM tasks_v3 t
  JOIN cities_v3 c ON c.id = t.city_id
)
UPDATE tasks_v3 t SET task_number = n.number FROM numbered n WHERE n.task_id = t.id;

ALTER TABLE tasks_v3 ALTER COLUMN task_number SET NOT NULL;
CREATE INDEX tasks_v3_number_idx ON tasks_v3(task_number);

CREATE TABLE task_attachments_v1 (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks_v3(id) ON DELETE CASCADE,
  country_id text NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  storage_path text NOT NULL,
  actor text NOT NULL,
  actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_attachments_v1_task_idx ON task_attachments_v1(task_id, created_at);
