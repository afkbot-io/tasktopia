CREATE INDEX world_chunk_payloads_v1_published_idx
  ON world_chunk_payloads_v1(country_id, published_at DESC);
