-- CHANGE LOG
-- -----------------------------------------------------------------------------
-- SEQ | AUTHOR                                    | DESCRIPTION
-- -----------------------------------------------------------------------------
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Per-user "remote only" matching. The corpus has carried a `remote` flag per posting since 095 (every ATS adapter derives it), and the Job Search screen has filtered on it since 1.11.0 — but nothing AUTOMATED consulted it, so a remote-only candidate was still scored against, digested, and shown on-site roles. This is the standing preference that closes that: it gates which postings are AI-scored at all (so tokens are not spent on roles the person would never take), the digest, and the matched board.
--
-- Additive and default FALSE, so every existing user's behaviour is byte-for-byte what it is
-- today until they turn it on. It lives on career_score_settings because that is already the
-- per-user table the scoring pass reads (title_terms, the cron cursors) and it is FORCE-RLS
-- owner-scoped there — a preference must never be readable across users.

ALTER TABLE career_score_settings
  ADD COLUMN IF NOT EXISTS remote_only BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN career_score_settings.remote_only IS
  'When true, the automated match considers only postings whose corpus `remote` flag is set: '
  'the scoring candidate query, the digest, and the matched board. The Job Search screen keeps '
  'its own explicit Any/Remote/On-site pills and is deliberately NOT overridden by this.';
