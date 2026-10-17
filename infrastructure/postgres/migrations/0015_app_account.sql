-- phase: expand
-- The app account row (book P2.06 Outputs, created here: the merged callback does not write it) and the onboarding
-- states P2.12 writes. `chat` is the placeholder step between terms and done; P2.06's check list did not include it.
-- The birth date is never a column: an adult confirmation stores only age_confirmed_at. storage_quota_bytes is
-- read-only for web; no step writes it yet. did is personal data, so every grant is a column list.
CREATE TABLE app.account (
  did types.did PRIMARY KEY,
  first_seen_at timestamptz NOT NULL,
  onboarding text NOT NULL DEFAULT 'age'
    CHECK (onboarding IN ('age', 'terms', 'chat', 'done', 'blocked_underage')),
  terms_version text,
  terms_accepted_at timestamptz,
  privacy_version text,
  age_confirmed_at timestamptz,
  storage_quota_bytes bigint
);

GRANT SELECT (
  did, first_seen_at, onboarding, terms_version, terms_accepted_at, privacy_version, age_confirmed_at,
  storage_quota_bytes
) ON app.account TO web;
GRANT INSERT (did, first_seen_at, onboarding, terms_version, terms_accepted_at, privacy_version, age_confirmed_at)
  ON app.account TO web;
GRANT UPDATE (onboarding, terms_version, terms_accepted_at, privacy_version, age_confirmed_at)
  ON app.account TO web;
