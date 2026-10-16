-- Expand only: existing keys/read watermarks and the four legacy kinds stay
-- intact. A previous image continues to read its known kinds after rollback.
ALTER TABLE notification_reads_v1 DROP CONSTRAINT notification_reads_v1_kind_check;
ALTER TABLE notification_reads_v1 ADD CONSTRAINT notification_reads_v1_kind_check
  CHECK (kind IN ('COMPLETED','DEFECT','OPENED','ASSIGNED','COMMENT','MATERIAL','TESTING')) NOT VALID;
ALTER TABLE notification_reads_v1 VALIDATE CONSTRAINT notification_reads_v1_kind_check;

-- Album pages should not scan unrelated comments/material history. This
-- additive index is harmless to an older image and stores milestones only.
CREATE INDEX events_city_album_v1_idx ON events (
  country_id,
  (COALESCE(payload_json->>'cityId',payload_json#>>'{building,city,id}',payload_json#>>'{development,cityId}')),
  created_at DESC,id DESC
) WHERE type IN ('city.created','district.created','district.activated','district.completed','district.deleted','task.created','task.deleted','task.status_changed')
  AND (type<>'task.status_changed' OR payload_json->>'status'='COMPLETED');
