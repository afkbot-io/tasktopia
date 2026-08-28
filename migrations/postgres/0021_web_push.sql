CREATE TABLE push_subscriptions_v1 (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL CHECK (length(endpoint) BETWEEN 12 AND 2048),
  endpoint_hash text NOT NULL CHECK (endpoint_hash ~ '^[a-f0-9]{64}$'),
  p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 80 AND 120),
  auth text NOT NULL CHECK (length(auth) BETWEEN 20 AND 32),
  expiration_time bigint,
  scope text NOT NULL DEFAULT '/' CHECK (scope = '/'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX push_subscriptions_v1_endpoint_uidx ON push_subscriptions_v1(endpoint_hash);
CREATE INDEX push_subscriptions_v1_user_idx ON push_subscriptions_v1(user_id, updated_at DESC);

CREATE TABLE push_deliveries_v1 (
  id bigserial PRIMARY KEY,
  event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  subscription_id text NOT NULL,
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RETRY', 'SENT', 'FAILED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_code text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX push_deliveries_v1_event_subscription_uidx ON push_deliveries_v1(event_id, subscription_id);
CREATE INDEX push_deliveries_v1_claim_idx ON push_deliveries_v1(status, next_attempt_at, id)
  WHERE status IN ('PENDING', 'RETRY');

CREATE TABLE push_delivery_cursor_v1 (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  event_id bigint NOT NULL DEFAULT 0
);
INSERT INTO push_delivery_cursor_v1(singleton, event_id)
SELECT true, COALESCE(MAX(id), 0) FROM events;
