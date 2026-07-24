-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- 2026-06-16 17:05:00 | roger.murphy@agenticfederal.us | Career-Hunter app: reserved
--   tenant registry (single-tenant now, multi-tenant ready) + a join table linking an
--   OSHAL career-application ticket to a per-user engine posting. Per-user connector keys
--   (anthropic click-to-connect, firecrawl settings field) reuse the existing
--   oshal_connections table (provider in ('anthropic','firecrawl')), so no new secret store.
-- -----------------------------------------------------------------------------

-- Tenant registry. Single 'default' tenant for now; the column exists everywhere a user
-- is scoped so flipping on true multi-tenant is config, not a migration.
CREATE TABLE IF NOT EXISTS career_hunter_tenants (
    tenant_id   TEXT PRIMARY KEY,
    label       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO career_hunter_tenants (tenant_id, label)
VALUES ('default', 'Default tenant')
ON CONFLICT (tenant_id) DO NOTHING;

-- Links a career-application ticket (OSHAL tickets table) to a per-user engine posting,
-- so the approvals surface can reconcile ticket state with the user's job board.
CREATE TABLE IF NOT EXISTS career_hunter_applications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   TEXT NOT NULL DEFAULT 'default',
    user_sub    TEXT NOT NULL,
    ticket_id   UUID,                 -- OSHAL tickets.ticketId
    posting_id  INTEGER NOT NULL,     -- engine corpus posting id
    company     TEXT,
    title       TEXT,
    include_oshal BOOLEAN NOT NULL DEFAULT FALSE,
    status      TEXT NOT NULL DEFAULT 'approval_required',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, user_sub, posting_id)
);
CREATE INDEX IF NOT EXISTS idx_career_apps_user   ON career_hunter_applications(user_sub);
CREATE INDEX IF NOT EXISTS idx_career_apps_ticket ON career_hunter_applications(ticket_id);
CREATE INDEX IF NOT EXISTS idx_career_apps_status ON career_hunter_applications(status);
