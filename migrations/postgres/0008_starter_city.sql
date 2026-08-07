-- Starter city: a special non-task city for templates, conventions and context cards.

CREATE TYPE city_kind AS ENUM ('WORK', 'TEMPLATE');
ALTER TABLE cities_v3 ADD COLUMN kind city_kind NOT NULL DEFAULT 'WORK';
CREATE UNIQUE INDEX idx_cities_template_per_country ON cities_v3(country_id) WHERE kind = 'TEMPLATE';

-- Reference cards inside a starter city (not tasks; no districts here).
CREATE TABLE city_reference_cards_v1 (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  country_id TEXT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  city_id TEXT NOT NULL REFERENCES cities_v3(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('TEMPLATE', 'CONVENTION', 'CONTEXT')),
  title TEXT NOT NULL CHECK (char_length(title) <= 160),
  body TEXT NOT NULL CHECK (char_length(body) <= 32000),
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_reference_cards_city ON city_reference_cards_v1(city_id);
CREATE INDEX idx_reference_cards_kind ON city_reference_cards_v1(city_id, kind);
