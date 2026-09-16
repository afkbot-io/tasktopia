CREATE TABLE task_share_previews (
  token_hash TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks_v3(id) ON DELETE CASCADE,
  publisher_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country_id TEXT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  task_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX task_share_previews_owner ON task_share_previews(publisher_id,task_id) WHERE revoked_at IS NULL;
