-- Per-card read high-water marks preserve unseen pages across browsers.
CREATE TABLE notification_reads_v1 (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  country_id text NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  task_id text NOT NULL REFERENCES tasks_v3(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('COMPLETED','DEFECT','OPENED','ASSIGNED')),
  event_id bigint NOT NULL,
  PRIMARY KEY(user_id,country_id,task_id,kind)
);
