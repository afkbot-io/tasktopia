ALTER TABLE countries
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN goal text NOT NULL DEFAULT '',
  ADD COLUMN product_context text NOT NULL DEFAULT '',
  ADD COLUMN success_criteria text NOT NULL DEFAULT '',
  ADD COLUMN constraints text NOT NULL DEFAULT '';

ALTER TABLE cities_v3
  ADD COLUMN goal text NOT NULL DEFAULT '',
  ADD COLUMN acceptance_criteria text NOT NULL DEFAULT '',
  ADD COLUMN deadline timestamptz;

ALTER TABLE districts_v3
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN deadline timestamptz;

ALTER TABLE tasks_v3
  ADD COLUMN work_item_type text NOT NULL DEFAULT 'TASK'
    CHECK(work_item_type IN ('TASK', 'BUG', 'RELEASE', 'HOTFIX')),
  ADD COLUMN acceptance_criteria text NOT NULL DEFAULT '',
  ADD COLUMN system_analysis text NOT NULL DEFAULT '',
  ADD COLUMN architecture text NOT NULL DEFAULT '',
  ADD COLUMN design_system text NOT NULL DEFAULT '',
  ADD COLUMN implementation_plan text NOT NULL DEFAULT '';

CREATE INDEX tasks_v3_work_item_type_idx ON tasks_v3(city_id, work_item_type, status);
CREATE INDEX tasks_v3_due_at_idx ON tasks_v3(due_at) WHERE due_at IS NOT NULL AND status <> 'COMPLETED';
CREATE INDEX districts_v3_deadline_idx ON districts_v3(deadline) WHERE deadline IS NOT NULL AND status <> 'COMPLETED';

CREATE TABLE task_defects_v18 (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks_v3(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  reproduction_steps text NOT NULL DEFAULT '',
  actual_result text NOT NULL DEFAULT '',
  expected_result text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'FIXED')),
  fixed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX task_defects_v18_task_idx ON task_defects_v18(task_id, status, created_at);

