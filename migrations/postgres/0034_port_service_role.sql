-- Vocabulary and one-live-port invariant only. No existing role or terrain changes.
-- Coastal allocation is enabled separately after its persisted plan is validated.
ALTER TABLE tasks_v3 DROP CONSTRAINT tasks_v3_service_role_check;
ALTER TABLE tasks_v3 ADD CONSTRAINT tasks_v3_service_role_check
  CHECK (service_role IN ('EDUCATION','MEDICAL','FIRE','POLICE','SHOP','RAILWAY','AIRPORT','CIVIC','PORT'));

CREATE UNIQUE INDEX tasks_v3_one_port_per_city ON tasks_v3(city_id)
  WHERE service_role='PORT';
