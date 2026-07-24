-- =============================================================================
-- Migration 037: Purchasing chat + durable feedback memory
-- -----------------------------------------------------------------------------
-- DATE         | AUTHOR                          | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 2026-06-18   | roger.murphy@agenticfederal.us  | Conversational concierge: persisted
--              | chats + free-form remembered feedback ("prefers organic", "buys the
--              | big size", "avoid Brand X") injected into every future session.
-- =============================================================================

-- Free-form preferences the shopper teaches the bot in conversation. Loaded into
-- the system prompt every turn so the concierge "remembers" across sessions.
-- (Per-item usual SKUs live in shop_preferences from migration 035; this is the
-- softer, qualitative memory.)
CREATE TABLE IF NOT EXISTS shop_feedback (
  feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL DEFAULT '00000000-0000-4000-8000-00000000c001',
  user_sub    VARCHAR(255) NOT NULL,
  note        TEXT NOT NULL,                      -- the remembered preference
  source      VARCHAR(20) NOT NULL DEFAULT 'chat',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shop_feedback_user ON shop_feedback (user_sub);
-- One row per distinct note per shopper (re-teaching the same thing is a no-op).
CREATE UNIQUE INDEX IF NOT EXISTS uq_shop_feedback_user_note
  ON shop_feedback (user_sub, lower(note));

-- Persisted conversations so a chat is resumable.
CREATE TABLE IF NOT EXISTS shop_conversations (
  conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_sub   VARCHAR(255) NOT NULL,
  title      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shop_conv_user ON shop_conversations (user_sub);

CREATE TABLE IF NOT EXISTS shop_messages (
  message_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES shop_conversations(conversation_id) ON DELETE CASCADE,
  user_sub        VARCHAR(255) NOT NULL,
  role            VARCHAR(16) NOT NULL,           -- user | assistant
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shop_msgs_conv ON shop_messages (conversation_id, created_at);
