-- Task detail and cascading deletion select one task's history. Without this
-- FK-leading index, each open scans every comment in every country.
CREATE INDEX task_comments_v3_task_created_idx ON task_comments_v3(task_id,created_at,id);
