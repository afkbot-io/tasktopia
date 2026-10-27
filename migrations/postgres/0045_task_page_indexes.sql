-- Bounded keyset reads must not scan/sort every task before returning a page.
-- No columns/contracts change: previous images keep their ordinary reads.
CREATE INDEX tasks_v3_updated_page_idx ON tasks_v3(updated_at DESC,id DESC);
CREATE INDEX tasks_v3_city_updated_page_idx ON tasks_v3(city_id,updated_at DESC,id DESC);
CREATE INDEX tasks_v3_district_updated_page_idx ON tasks_v3(district_id,updated_at DESC,id DESC);
