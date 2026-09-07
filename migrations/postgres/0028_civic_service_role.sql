-- Add the city-owned administration milestone. No layout, task or history is
-- rewritten: the next normal task consumes the reservation after18used blocks.
ALTER TABLE tasks_v3 DROP CONSTRAINT tasks_v3_service_role_check;
ALTER TABLE tasks_v3 ADD CONSTRAINT tasks_v3_service_role_check
  CHECK (service_role IN ('EDUCATION','MEDICAL','FIRE','POLICE','SHOP','RAILWAY','AIRPORT','CIVIC'));
