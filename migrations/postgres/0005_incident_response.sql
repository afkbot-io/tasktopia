ALTER TABLE task_defects_v18
  DROP CONSTRAINT task_defects_v18_status_check;

ALTER TABLE task_defects_v18
  ADD CONSTRAINT task_defects_v18_status_check
  CHECK(status IN ('OPEN', 'IN_PROGRESS', 'VERIFYING', 'FIXED'));

CREATE INDEX task_defects_v18_active_idx
  ON task_defects_v18(task_id, updated_at)
  WHERE status <> 'FIXED';
