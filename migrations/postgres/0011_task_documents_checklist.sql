CREATE TABLE task_documents_v1 (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  task_id text NOT NULL REFERENCES tasks_v3(id) ON DELETE CASCADE,
  file_name text NOT NULL CHECK (file_name ~ '^[a-z0-9][a-z0-9-]{0,78}\.md$'),
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  actor text NOT NULL DEFAULT 'Система страны',
  actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id, file_name)
);
CREATE INDEX task_documents_v1_task_idx ON task_documents_v1(task_id, position, file_name);

INSERT INTO task_documents_v1 (task_id, file_name, title, content, is_default, position, created_at, updated_at)
SELECT task.id, document.file_name, document.title,
  CASE document.file_name
    WHEN 'system-analysis.md' THEN task.system_analysis
    WHEN 'architecture.md' THEN task.architecture
    WHEN 'design-system.md' THEN task.design_system
    WHEN 'implementation-plan.md' THEN task.implementation_plan
  END,
  true, document.position, task.created_at, task.updated_at
FROM tasks_v3 task
CROSS JOIN (VALUES
  ('system-analysis.md', 'Системный анализ', 0),
  ('architecture.md', 'Архитектура', 1),
  ('design-system.md', 'Дизайн-система', 2),
  ('implementation-plan.md', 'План реализации', 3)
) AS document(file_name, title, position);

CREATE TABLE task_checklist_items_v1 (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  task_id text NOT NULL REFERENCES tasks_v3(id) ON DELETE CASCADE,
  title text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(task_id, position)
);
CREATE INDEX task_checklist_items_v1_task_idx ON task_checklist_items_v1(task_id, position);
