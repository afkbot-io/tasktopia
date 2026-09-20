-- Explicit publication snapshots only. Existing links must not gain new fields.
ALTER TABLE task_share_previews ADD COLUMN country_name TEXT;
ALTER TABLE task_share_previews ADD COLUMN city_name TEXT;
ALTER TABLE task_share_previews ADD COLUMN district_name TEXT;
