-- AI-first fields: assignee role + requester, plus task dependency table.

ALTER TABLE tasks_v3
  ADD COLUMN assignee_role TEXT,
  ADD COLUMN for_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX tasks_v3_assignee_role_idx ON tasks_v3(city_id, assignee_role) WHERE assignee_role IS NOT NULL;
CREATE INDEX tasks_v3_for_user_idx ON tasks_v3(for_user_id) WHERE for_user_id IS NOT NULL;

CREATE TABLE task_dependencies_v1 (
  task_id TEXT NOT NULL REFERENCES tasks_v3(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks_v3(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE INDEX task_dependencies_v1_dependent_idx ON task_dependencies_v1(task_id);
CREATE INDEX task_dependencies_v1_dependency_idx ON task_dependencies_v1(depends_on_task_id);
