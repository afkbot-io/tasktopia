CREATE TABLE country_invitations (
 id text PRIMARY KEY,
 country_id text NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
 email text NOT NULL,
 role text NOT NULL CHECK (role IN ('MEMBER','VIEWER')),
 token_hash text NOT NULL UNIQUE,
 created_by text NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 revoked_at timestamptz
);
CREATE INDEX country_invitations_country ON country_invitations(country_id);
CREATE TABLE account_recovery_codes (
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 code_hash text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id, code_hash)
);
