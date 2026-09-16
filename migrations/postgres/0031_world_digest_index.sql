CREATE INDEX events_world_digest_idx ON events(country_id, id DESC)
WHERE type='task.defect_created' OR (type='task.status_changed' AND payload_json->>'status'='COMPLETED');
