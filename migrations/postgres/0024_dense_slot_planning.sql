-- Template v2 is a deliberate spatial cutover; regenerate before map traffic.
-- Task intent is durable: AUTO may be assigned a residual park; explicit PARK
-- requests stay typed. Infrastructure reservations live in block parameters.
ALTER TABLE tasks_v3 ADD COLUMN visual_auto boolean NOT NULL DEFAULT true;
ALTER TABLE tasks_v3 ADD COLUMN requested_building_family text;
UPDATE tasks_v3 SET visual_auto=false WHERE visual_kind='PARK';
DELETE FROM city_layouts_v1;
DELETE FROM world_chunk_payloads_v1;
DELETE FROM country_overview_snapshots_v1;
UPDATE countries SET world_version=world_version+1;
