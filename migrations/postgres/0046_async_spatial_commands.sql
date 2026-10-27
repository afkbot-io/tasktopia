-- Older workers only claim PENDING/RUNNING. Keep new spatial commands in
-- separate storage states so an old worker can never mistake one for country
-- regeneration during a rolling update or application rollback. Public jobs
-- continue to expose only PENDING/RUNNING/COMPLETED/FAILED.
ALTER TABLE world_generation_jobs_v1 DROP CONSTRAINT world_generation_jobs_v1_operation_check;
ALTER TABLE world_generation_jobs_v1 ADD CONSTRAINT world_generation_jobs_v1_operation_check
  CHECK (operation IN ('city.create','district.create','task.create','country.regenerate',
    'task.set_status','task.transfer','task.delete','city.delete','district.delete','district.complete'));
ALTER TABLE world_generation_jobs_v1 DROP CONSTRAINT world_generation_jobs_v1_status_check;
ALTER TABLE world_generation_jobs_v1 ADD CONSTRAINT world_generation_jobs_v1_status_check
  CHECK (status IN ('PENDING','RUNNING','QUEUED','EXECUTING','COMPLETED','FAILED'));

DROP INDEX world_generation_jobs_v1_claim_idx;
CREATE INDEX world_generation_jobs_v1_claim_idx ON world_generation_jobs_v1(status,created_at,id)
  WHERE status IN ('PENDING','RUNNING','QUEUED','EXECUTING');
DROP INDEX world_generation_jobs_v1_country_fifo_idx;
CREATE INDEX world_generation_jobs_v1_country_fifo_idx ON world_generation_jobs_v1(country_id,created_at,id)
  WHERE status IN ('PENDING','RUNNING','QUEUED','EXECUTING');
