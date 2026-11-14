-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                      | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1   | maintainer@emeraldcoastsystemsgroup.com     | First Career Coaching store (0.1.0): one person row per verified account, a coach's published code, a seeker's ten-minute share preview, the consent row, its one summary snapshot and a coach's own "stop viewing" record. Plain tables only: on the native kernel a package without an operator-installed relationship policy keeps one private copy of every table per person, so nothing here is shared until storage/relationships.json is installed for the tenant. Timestamps are ISO-8601 text written by the package so the installed policy can compare them with now().

-- The caller's own person row. person_id is the kernel's native principal id; issuer and subject bind the row to the
-- verified account (the installed policy reads the caller's row by exactly those two). A newly enrolled account with
-- the same issuer and subject has another person_id, so it never inherits this row's links.
CREATE TABLE IF NOT EXISTS cc_people (
  person_id     TEXT PRIMARY KEY,
  issuer        TEXT NOT NULL,
  subject       TEXT NOT NULL,
  tenant_id     TEXT NOT NULL,
  display_name  TEXT,
  email         TEXT,
  coach_code    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- A coach's published code, stored only as its hash. A seeker resolves an exact code to this row; there is no
-- search. Removing the row turns the code off: nobody new can share with that coach by it.
CREATE TABLE IF NOT EXISTS cc_coach_codes (
  code_hash        TEXT PRIMARY KEY,
  coach_person_id  TEXT NOT NULL,
  coach_issuer     TEXT NOT NULL,
  coach_subject    TEXT NOT NULL,
  tenant_id        TEXT NOT NULL,
  display_name     TEXT,
  email            TEXT,
  created_at       TEXT NOT NULL
);

-- A seeker's pending share: recipient, scope, payload digest and the consent revision it expects, for ten minutes.
-- preview_id is the browser's intent id, so a lost answer is retried with the same id.
CREATE TABLE IF NOT EXISTS cc_previews (
  preview_id         TEXT PRIMARY KEY,
  link_id            TEXT NOT NULL,
  expected_revision  INTEGER NOT NULL,
  seeker_person_id   TEXT NOT NULL,
  seeker_issuer      TEXT NOT NULL,
  seeker_subject     TEXT NOT NULL,
  coach_person_id    TEXT NOT NULL,
  coach_issuer       TEXT NOT NULL,
  coach_subject      TEXT NOT NULL,
  coach_name         TEXT,
  coach_email        TEXT,
  tenant_id          TEXT NOT NULL,
  scope              TEXT NOT NULL,
  field_groups       TEXT NOT NULL,
  alias              TEXT NOT NULL,
  days               INTEGER NOT NULL,
  payload            TEXT NOT NULL,
  payload_digest     TEXT NOT NULL,
  source_as_of       TEXT NOT NULL,
  state              TEXT NOT NULL,
  ticket_id          TEXT,
  created_at         TEXT NOT NULL,
  expires_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

-- The consent: both people's exact identities, the scope and field groups, the approval and the deadline. revision
-- rises on every activation, renewal and revocation, so an old approval cannot be replayed.
CREATE TABLE IF NOT EXISTS cc_links (
  link_id              TEXT PRIMARY KEY,
  seeker_person_id     TEXT NOT NULL,
  seeker_issuer        TEXT NOT NULL,
  seeker_subject       TEXT NOT NULL,
  coach_person_id      TEXT NOT NULL,
  coach_issuer         TEXT NOT NULL,
  coach_subject        TEXT NOT NULL,
  coach_name           TEXT,
  coach_email          TEXT,
  tenant_id            TEXT NOT NULL,
  app                  TEXT NOT NULL,
  scope                TEXT NOT NULL,
  field_groups         TEXT NOT NULL,
  alias                TEXT NOT NULL,
  state                TEXT NOT NULL,
  revision             INTEGER NOT NULL,
  approval_ticket_id   TEXT,
  approval_preview_id  TEXT,
  approval_receipt     TEXT,
  approved_at          TEXT,
  expires_at           TEXT NOT NULL,
  revoked_at           TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

-- The one snapshot a link shows, at the link's revision. Revocation deletes it in the same transaction.
CREATE TABLE IF NOT EXISTS cc_snapshots (
  link_id           TEXT PRIMARY KEY,
  revision          INTEGER NOT NULL,
  seeker_person_id  TEXT NOT NULL,
  coach_person_id   TEXT NOT NULL,
  payload           TEXT NOT NULL,
  payload_digest    TEXT NOT NULL,
  source_as_of      TEXT NOT NULL,
  published_at      TEXT NOT NULL,
  expires_at        TEXT NOT NULL
);

-- A coach's own record that they stopped viewing a link. The coach never writes the seeker's rows.
CREATE TABLE IF NOT EXISTS cc_link_drops (
  link_id          TEXT PRIMARY KEY,
  coach_person_id  TEXT NOT NULL,
  coach_issuer     TEXT NOT NULL,
  coach_subject    TEXT NOT NULL,
  dropped_at       TEXT NOT NULL
);
