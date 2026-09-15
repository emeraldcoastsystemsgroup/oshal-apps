-- CHANGE LOG
-- SEQ | AUTHOR | DESCRIPTION
-- 1 | maintainer@emeraldcoastsystemsgroup.com | Produce a read-only legacy ownership review; never infer or assign an issuer.
-- This report is deliberately NOT an installation migration. Run only through an
-- authorized operator database session and keep its identity-bearing output private.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT COUNT(*) AS portraits_total,
       COUNT(*) FILTER (WHERE owner_issuer IS NULL) AS portraits_requiring_owner_review,
       COUNT(*) FILTER (WHERE owner_issuer IS NOT NULL) AS portraits_with_verified_owner
FROM ps_portraits;
SELECT user_sub AS legacy_subject, COUNT(*) AS portraits_requiring_owner_review,
       MIN(created_at) AS oldest_created_at, MAX(created_at) AS newest_created_at
FROM ps_portraits WHERE owner_issuer IS NULL
GROUP BY user_sub ORDER BY user_sub;
COMMIT;
