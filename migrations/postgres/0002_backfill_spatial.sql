INSERT INTO world_chunk_entities_v11(country_id, chunk_x, chunk_y, entity_kind, entity_id)
SELECT c.country_id, floor((cell->>'x')::numeric / 64)::integer,
  floor((cell->>'y')::numeric / 64)::integer, 'DISTRICT', d.id
FROM districts_v3 d JOIN cities_v3 c ON c.id = d.city_id
CROSS JOIN LATERAL jsonb_array_elements(d.cells_json) cell
ON CONFLICT DO NOTHING;

INSERT INTO world_chunk_entities_v11(country_id, chunk_x, chunk_y, entity_kind, entity_id)
SELECT c.country_id, floor((cell->>'x')::numeric / 64)::integer,
  floor((cell->>'y')::numeric / 64)::integer, 'TASK', t.id
FROM tasks_v3 t JOIN cities_v3 c ON c.id = t.city_id
CROSS JOIN LATERAL jsonb_array_elements(t.footprint_json || t.access_json) cell
ON CONFLICT DO NOTHING;

INSERT INTO world_chunk_entities_v11(country_id, chunk_x, chunk_y, entity_kind, entity_id)
SELECT f.country_id, floor((cell->>'x')::numeric / 64)::integer,
  floor((cell->>'y')::numeric / 64)::integer, 'FEATURE', f.id
FROM world_features_v6 f
CROSS JOIN LATERAL jsonb_array_elements(f.footprint_json || f.access_json) cell
ON CONFLICT DO NOTHING;
