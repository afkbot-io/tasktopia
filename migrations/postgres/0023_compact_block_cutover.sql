-- Breaking spatial cutover. Product rows and task history remain intact.
-- Release must rebuild every city before map traffic is enabled.
DROP TRIGGER districts_v3_chunks_insert_v14 ON districts_v3;
DROP TRIGGER districts_v3_chunks_update_v14 ON districts_v3;
DROP TRIGGER districts_v3_chunks_delete_v14 ON districts_v3;
DROP TRIGGER districts_v3_chunk_cells_v1 ON districts_v3;
DROP TRIGGER tasks_v3_chunks_insert_v14 ON tasks_v3;
DROP TRIGGER tasks_v3_chunks_update_v14 ON tasks_v3;
DROP TRIGGER tasks_v3_chunks_delete_v14 ON tasks_v3;
DROP TRIGGER world_features_v6_chunks_insert_v14 ON world_features_v6;
DROP TRIGGER world_features_v6_chunks_update_v14 ON world_features_v6;
DROP TRIGGER world_features_v6_chunks_delete_v14 ON world_features_v6;
DROP FUNCTION refresh_district_chunks_v14();
DROP FUNCTION refresh_task_chunks_v14();
DROP FUNCTION refresh_feature_chunks_v14();
DROP FUNCTION refresh_world_chunk_district_cells_v1();
DROP FUNCTION compact_district_cell_runs_v1(jsonb);
DROP TABLE world_chunk_district_cells_v1;
DROP TABLE world_chunk_entities_v11;
DROP TABLE roads_v3;
DROP TABLE world_features_v6;

ALTER TABLE districts_v3 DROP COLUMN cells_json, DROP COLUMN lots_json;
ALTER TABLE districts_v3 ADD COLUMN spatial_bounds_json jsonb;
ALTER TABLE tasks_v3 DROP COLUMN origin_x, DROP COLUMN origin_y,
  DROP COLUMN footprint_json, DROP COLUMN entrance_x, DROP COLUMN entrance_y,
  DROP COLUMN access_json, DROP COLUMN access_kind;
UPDATE tasks_v3 SET building_type='compact-apartment-v1',
  visual_asset_key=CASE WHEN visual_kind='BUILDING' THEN 'compact-apartment-v1' ELSE visual_asset_key END;

-- The experimental shadow template is not a runtime-compatible layout.
DELETE FROM city_layouts_v1;
DELETE FROM world_chunk_payloads_v1;
UPDATE countries SET world_version=world_version+1;

CREATE INDEX city_blocks_v1_active_bounds_idx ON city_blocks_v1(layout_id,origin_x,origin_y,width,height);
