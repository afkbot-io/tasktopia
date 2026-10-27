-- Sync command receipts predate JSONB queueing and hash JSON.stringify(input).
-- Preserve the original serialization for newly queued spatial commands, so
-- retries of those existing receipts keep the original key order and identity.
-- Legacy generation jobs retain their established JSONB serialization.
ALTER TABLE world_generation_jobs_v1 ADD COLUMN payload_serialized text;
ALTER TABLE world_generation_jobs_v1 ADD CONSTRAINT world_generation_jobs_v1_payload_serialized_check
  CHECK (payload_serialized IS NULL OR payload_serialized::jsonb = payload_json);
