-- Additive country topology. Geometry stays in canonical country/personal
-- geography owners; reads never allocate or alter these edges.
CREATE TABLE country_transport_networks_v1 (
  country_id text PRIMARY KEY REFERENCES countries(id) ON DELETE CASCADE,
  network_json jsonb NOT NULL CHECK (jsonb_typeof(network_json) = 'object'),
  revision text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
