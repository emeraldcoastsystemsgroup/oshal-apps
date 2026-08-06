/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-06 02:43:35 | maintainer@emeraldcoastsystemsgroup.com     | Backfill authoritative campaign ownership, maintain a bounded member ACL, and FORCE caller-GUC RLS across every D&D tenant table without breaking transactional join-code admission.
 */

-- SEC-04 database boundary
-- -----------------------------------------------------------------------------
-- `user_sub` has two historical meanings in this schema: campaign-owned rows use
-- it as the owner, while dnd_players uses it as the member identity and archive
-- rows may record the member who authored a beat.  A dedicated owner_sub removes
-- that ambiguity.  The campaign member ACL is deliberately denormalized so RLS
-- can authorize a whole shared table without a recursive campaigns <-> players
-- policy.  Triggers below make both derived values database-owned.

ALTER TABLE dnd_campaigns  ADD COLUMN IF NOT EXISTS owner_sub text;
ALTER TABLE dnd_campaigns  ADD COLUMN IF NOT EXISTS member_subs text[];
ALTER TABLE dnd_encounters ADD COLUMN IF NOT EXISTS owner_sub text;
ALTER TABLE dnd_characters ADD COLUMN IF NOT EXISTS owner_sub text;
ALTER TABLE dnd_archive    ADD COLUMN IF NOT EXISTS owner_sub text;
ALTER TABLE dnd_players    ADD COLUMN IF NOT EXISTS owner_sub text;
ALTER TABLE dnd_snapshots  ADD COLUMN IF NOT EXISTS owner_sub text;

-- Drop only our derived-field triggers while repairing an interrupted or drifted
-- prior application.  They are recreated before RLS is enabled below.
DROP TRIGGER IF EXISTS dnd_campaign_security_fields ON dnd_campaigns;
DROP TRIGGER IF EXISTS dnd_campaign_owner_propagation ON dnd_campaigns;
DROP TRIGGER IF EXISTS dnd_player_membership_sync ON dnd_players;
DROP TRIGGER IF EXISTS dnd_encounter_owner_stamp ON dnd_encounters;
DROP TRIGGER IF EXISTS dnd_character_owner_stamp ON dnd_characters;
DROP TRIGGER IF EXISTS dnd_archive_owner_stamp ON dnd_archive;
DROP TRIGGER IF EXISTS dnd_player_owner_stamp ON dnd_players;
DROP TRIGGER IF EXISTS dnd_snapshot_owner_stamp ON dnd_snapshots;

UPDATE dnd_campaigns
   SET owner_sub = user_sub
 WHERE owner_sub IS DISTINCT FROM user_sub;

UPDATE dnd_campaigns c
   SET member_subs = COALESCE((
         SELECT array_agg(DISTINCT p.user_sub ORDER BY p.user_sub)
           FROM dnd_players p
          WHERE p.campaign_id = c.campaign_id
       ), ARRAY[]::text[])
 WHERE member_subs IS DISTINCT FROM COALESCE((
         SELECT array_agg(DISTINCT p.user_sub ORDER BY p.user_sub)
           FROM dnd_players p
          WHERE p.campaign_id = c.campaign_id
       ), ARRAY[]::text[]);

UPDATE dnd_encounters e
   SET owner_sub = c.owner_sub
  FROM dnd_campaigns c
 WHERE c.campaign_id = e.campaign_id
   AND e.owner_sub IS DISTINCT FROM c.owner_sub;

UPDATE dnd_characters ch
   SET owner_sub = c.owner_sub
  FROM dnd_campaigns c
 WHERE c.campaign_id = ch.campaign_id
   AND ch.owner_sub IS DISTINCT FROM c.owner_sub;

UPDATE dnd_characters
   SET owner_sub = user_sub
 WHERE campaign_id IS NULL
   AND owner_sub IS DISTINCT FROM user_sub;

UPDATE dnd_archive a
   SET owner_sub = c.owner_sub
  FROM dnd_campaigns c
 WHERE c.campaign_id = a.campaign_id
   AND a.owner_sub IS DISTINCT FROM c.owner_sub;

UPDATE dnd_players p
   SET owner_sub = c.owner_sub
  FROM dnd_campaigns c
 WHERE c.campaign_id = p.campaign_id
   AND p.owner_sub IS DISTINCT FROM c.owner_sub;

UPDATE dnd_snapshots s
   SET owner_sub = c.owner_sub
  FROM dnd_campaigns c
 WHERE c.campaign_id = s.campaign_id
   AND s.owner_sub IS DISTINCT FROM c.owner_sub;

ALTER TABLE dnd_campaigns  ALTER COLUMN owner_sub SET NOT NULL;
ALTER TABLE dnd_campaigns  ALTER COLUMN member_subs SET DEFAULT ARRAY[]::text[];
ALTER TABLE dnd_campaigns  ALTER COLUMN member_subs SET NOT NULL;
ALTER TABLE dnd_encounters ALTER COLUMN owner_sub SET NOT NULL;
ALTER TABLE dnd_characters ALTER COLUMN owner_sub SET NOT NULL;
ALTER TABLE dnd_archive    ALTER COLUMN owner_sub SET NOT NULL;
ALTER TABLE dnd_players    ALTER COLUMN owner_sub SET NOT NULL;
ALTER TABLE dnd_snapshots  ALTER COLUMN owner_sub SET NOT NULL;

-- Empty subjects would be reachable from the fail-closed anonymous GUC stamp.
-- Refuse them instead of silently assigning ownership that cannot be recovered.
DO $constraints$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('dnd_campaigns',  'ck_dnd_campaigns_owner_sub_nonempty',  'owner_sub'),
      ('dnd_encounters', 'ck_dnd_encounters_owner_sub_nonempty', 'owner_sub'),
      ('dnd_characters', 'ck_dnd_characters_owner_sub_nonempty', 'owner_sub'),
      ('dnd_archive',    'ck_dnd_archive_owner_sub_nonempty',    'owner_sub'),
      ('dnd_players',    'ck_dnd_players_owner_sub_nonempty',    'owner_sub'),
      ('dnd_snapshots',  'ck_dnd_snapshots_owner_sub_nonempty',  'owner_sub'),
      ('dnd_players',    'ck_dnd_players_user_sub_nonempty',     'user_sub')
    ) AS checks(table_name, constraint_name, column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint
       WHERE conname = target.constraint_name
         AND conrelid = target.table_name::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (btrim(%I) <> '''') NOT VALID',
        target.table_name, target.constraint_name, target.column_name
      );
    END IF;
    EXECUTE format(
      'ALTER TABLE %I VALIDATE CONSTRAINT %I',
      target.table_name, target.constraint_name
    );
  END LOOP;
END
$constraints$;

CREATE INDEX IF NOT EXISTS idx_dnd_campaigns_owner  ON dnd_campaigns (owner_sub);
CREATE INDEX IF NOT EXISTS idx_dnd_encounters_owner ON dnd_encounters (owner_sub);
CREATE INDEX IF NOT EXISTS idx_dnd_characters_owner ON dnd_characters (owner_sub);
CREATE INDEX IF NOT EXISTS idx_dnd_archive_owner    ON dnd_archive (owner_sub);
CREATE INDEX IF NOT EXISTS idx_dnd_players_owner    ON dnd_players (owner_sub);
CREATE INDEX IF NOT EXISTS idx_dnd_snapshots_owner  ON dnd_snapshots (owner_sub);

/** Keep campaign owner and member ACL fields derived, including on direct SQL. */
CREATE OR REPLACE FUNCTION public.dnd_stamp_campaign_security_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND current_setting('oshal.is_operator', true) IS DISTINCT FROM 'on' THEN
    -- Campaign ownership and its invitation capability are immutable to ordinary
    -- owners/members.  Only the explicit operator rail may transfer or rotate them.
    NEW.user_sub := OLD.user_sub;
    NEW.join_code := OLD.join_code;
  END IF;
  NEW.owner_sub := NEW.user_sub;
  IF TG_OP = 'INSERT' THEN
    NEW.member_subs := ARRAY[]::text[];
  ELSIF pg_trigger_depth() = 1 THEN
    -- Only the nested dnd_players sync trigger may change the derived ACL.
    NEW.member_subs := OLD.member_subs;
  END IF;
  RETURN NEW;
END
$function$;

/** Derive every campaign child's owner from its authoritative parent row. */
CREATE OR REPLACE FUNCTION public.dnd_stamp_child_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'dnd_characters' AND NEW.campaign_id IS NULL THEN
    NEW.owner_sub := NEW.user_sub;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.campaign_id IS NOT DISTINCT FROM OLD.campaign_id
     AND NEW.owner_sub IS NOT DISTINCT FROM OLD.owner_sub THEN
    RETURN NEW;
  END IF;
  SELECT c.owner_sub INTO NEW.owner_sub
    FROM public.dnd_campaigns c
   WHERE c.campaign_id = NEW.campaign_id;
  IF NEW.owner_sub IS NULL THEN
    RAISE EXCEPTION 'D&D campaign owner is unavailable for %', NEW.campaign_id
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END
$function$;

/** Keep the non-recursive campaign ACL synchronized with membership mutations. */
CREATE OR REPLACE FUNCTION public.dnd_sync_campaign_members()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE')
     AND (TG_OP = 'DELETE'
       OR OLD.campaign_id IS DISTINCT FROM NEW.campaign_id
       OR OLD.user_sub IS DISTINCT FROM NEW.user_sub) THEN
    -- The already-authorized player mutation arms only its exact old campaign
    -- for this transaction.  That lets the derived ACL remove the caller while
    -- the UPDATE's new row no longer contains the departing member.
    PERFORM set_config('oshal.dnd_membership_campaign', OLD.campaign_id::text, true);
    UPDATE public.dnd_campaigns
       SET member_subs = array_remove(member_subs, OLD.user_sub)
     WHERE campaign_id = OLD.campaign_id;
    PERFORM set_config('oshal.dnd_membership_campaign', '', true);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE')
     AND (TG_OP = 'INSERT'
       OR OLD.campaign_id IS DISTINCT FROM NEW.campaign_id
       OR OLD.user_sub IS DISTINCT FROM NEW.user_sub) THEN
    UPDATE public.dnd_campaigns
       SET member_subs = CASE
         WHEN NEW.user_sub = ANY(member_subs) THEN member_subs
         ELSE array_append(member_subs, NEW.user_sub)
       END
     WHERE campaign_id = NEW.campaign_id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$;

/** Propagate an operator-authorized campaign ownership transfer to all children. */
CREATE OR REPLACE FUNCTION public.dnd_propagate_campaign_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.owner_sub IS NOT DISTINCT FROM OLD.owner_sub THEN RETURN NEW; END IF;
  UPDATE public.dnd_encounters SET owner_sub = NEW.owner_sub WHERE campaign_id = NEW.campaign_id;
  UPDATE public.dnd_characters SET owner_sub = NEW.owner_sub WHERE campaign_id = NEW.campaign_id;
  UPDATE public.dnd_archive SET owner_sub = NEW.owner_sub WHERE campaign_id = NEW.campaign_id;
  UPDATE public.dnd_players SET owner_sub = NEW.owner_sub WHERE campaign_id = NEW.campaign_id;
  UPDATE public.dnd_snapshots SET owner_sub = NEW.owner_sub WHERE campaign_id = NEW.campaign_id;
  RETURN NEW;
END
$function$;

CREATE TRIGGER dnd_campaign_security_fields
BEFORE INSERT OR UPDATE ON dnd_campaigns
FOR EACH ROW EXECUTE FUNCTION public.dnd_stamp_campaign_security_fields();

CREATE TRIGGER dnd_campaign_owner_propagation
AFTER UPDATE OF user_sub ON dnd_campaigns
FOR EACH ROW EXECUTE FUNCTION public.dnd_propagate_campaign_owner();

CREATE TRIGGER dnd_encounter_owner_stamp
BEFORE INSERT OR UPDATE ON dnd_encounters
FOR EACH ROW EXECUTE FUNCTION public.dnd_stamp_child_owner();

CREATE TRIGGER dnd_character_owner_stamp
BEFORE INSERT OR UPDATE ON dnd_characters
FOR EACH ROW EXECUTE FUNCTION public.dnd_stamp_child_owner();

CREATE TRIGGER dnd_archive_owner_stamp
BEFORE INSERT OR UPDATE ON dnd_archive
FOR EACH ROW EXECUTE FUNCTION public.dnd_stamp_child_owner();

CREATE TRIGGER dnd_player_owner_stamp
BEFORE INSERT OR UPDATE ON dnd_players
FOR EACH ROW EXECUTE FUNCTION public.dnd_stamp_child_owner();

CREATE TRIGGER dnd_snapshot_owner_stamp
BEFORE INSERT OR UPDATE ON dnd_snapshots
FOR EACH ROW EXECUTE FUNCTION public.dnd_stamp_child_owner();

CREATE TRIGGER dnd_player_membership_sync
AFTER INSERT OR UPDATE OR DELETE ON dnd_players
FOR EACH ROW EXECUTE FUNCTION public.dnd_sync_campaign_members();

-- Replace only this migration's policies so a repeat application repairs drift.
DROP POLICY IF EXISTS dnd_campaigns_select ON dnd_campaigns;
DROP POLICY IF EXISTS dnd_campaigns_insert ON dnd_campaigns;
DROP POLICY IF EXISTS dnd_campaigns_update ON dnd_campaigns;
DROP POLICY IF EXISTS dnd_campaigns_delete ON dnd_campaigns;
DROP POLICY IF EXISTS dnd_encounters_select ON dnd_encounters;
DROP POLICY IF EXISTS dnd_encounters_insert ON dnd_encounters;
DROP POLICY IF EXISTS dnd_encounters_update ON dnd_encounters;
DROP POLICY IF EXISTS dnd_encounters_delete ON dnd_encounters;
DROP POLICY IF EXISTS dnd_characters_select ON dnd_characters;
DROP POLICY IF EXISTS dnd_characters_insert ON dnd_characters;
DROP POLICY IF EXISTS dnd_characters_update ON dnd_characters;
DROP POLICY IF EXISTS dnd_characters_delete ON dnd_characters;
DROP POLICY IF EXISTS dnd_archive_select ON dnd_archive;
DROP POLICY IF EXISTS dnd_archive_insert ON dnd_archive;
DROP POLICY IF EXISTS dnd_archive_delete ON dnd_archive;
DROP POLICY IF EXISTS dnd_players_select ON dnd_players;
DROP POLICY IF EXISTS dnd_players_insert ON dnd_players;
DROP POLICY IF EXISTS dnd_players_update ON dnd_players;
DROP POLICY IF EXISTS dnd_players_delete ON dnd_players;
DROP POLICY IF EXISTS dnd_snapshots_select ON dnd_snapshots;
DROP POLICY IF EXISTS dnd_snapshots_insert ON dnd_snapshots;
DROP POLICY IF EXISTS dnd_snapshots_delete ON dnd_snapshots;

CREATE POLICY dnd_campaigns_select ON dnd_campaigns FOR SELECT USING (
  current_setting('oshal.is_operator', true) = 'on'
  OR owner_sub = NULLIF(current_setting('oshal.current_sub', true), '')
  OR NULLIF(current_setting('oshal.current_sub', true), '') = ANY(member_subs)
  OR (
    status = 'active'
    AND join_code = NULLIF(current_setting('oshal.dnd_join_code', true), '')
  )
  OR campaign_id::text = NULLIF(current_setting('oshal.dnd_membership_campaign', true), '')
);

CREATE POLICY dnd_campaigns_insert ON dnd_campaigns FOR INSERT WITH CHECK (
  current_setting('oshal.is_operator', true) = 'on'
  OR owner_sub = NULLIF(current_setting('oshal.current_sub', true), '')
);

CREATE POLICY dnd_campaigns_update ON dnd_campaigns FOR UPDATE USING (
  current_setting('oshal.is_operator', true) = 'on'
  OR owner_sub = NULLIF(current_setting('oshal.current_sub', true), '')
  OR NULLIF(current_setting('oshal.current_sub', true), '') = ANY(member_subs)
  OR (
    status = 'active'
    AND join_code = NULLIF(current_setting('oshal.dnd_join_code', true), '')
  )
  OR campaign_id::text = NULLIF(current_setting('oshal.dnd_membership_campaign', true), '')
) WITH CHECK (
  current_setting('oshal.is_operator', true) = 'on'
  OR owner_sub = NULLIF(current_setting('oshal.current_sub', true), '')
  OR NULLIF(current_setting('oshal.current_sub', true), '') = ANY(member_subs)
  OR (
    status = 'active'
    AND join_code = NULLIF(current_setting('oshal.dnd_join_code', true), '')
  )
  OR campaign_id::text = NULLIF(current_setting('oshal.dnd_membership_campaign', true), '')
);

CREATE POLICY dnd_campaigns_delete ON dnd_campaigns FOR DELETE USING (
  current_setting('oshal.is_operator', true) = 'on'
  OR owner_sub = NULLIF(current_setting('oshal.current_sub', true), '')
);

-- A child campaign row is visible only when its parent is visible under the
-- non-recursive campaign policy.  The transaction-local join capability makes
-- only the exact active code's board and seat count visible during admission.
CREATE POLICY dnd_encounters_select ON dnd_encounters FOR SELECT USING (
  current_setting('oshal.is_operator', true) = 'on'
  OR EXISTS (SELECT 1 FROM dnd_campaigns c WHERE c.campaign_id = dnd_encounters.campaign_id)
);
CREATE POLICY dnd_encounters_insert ON dnd_encounters FOR INSERT WITH CHECK (
  current_setting('oshal.is_operator', true) = 'on'
  OR EXISTS (SELECT 1 FROM dnd_campaigns c WHERE c.campaign_id = dnd_encounters.campaign_id)
);
CREATE POLICY dnd_encounters_update ON dnd_encounters FOR UPDATE USING (
  current_setting('oshal.is_operator', true) = 'on'
  OR EXISTS (SELECT 1 FROM dnd_campaigns c WHERE c.campaign_id = dnd_encounters.campaign_id)
) WITH CHECK (
  current_setting('oshal.is_operator', true) = 'on'
  OR EXISTS (SELECT 1 FROM dnd_campaigns c WHERE c.campaign_id = dnd_encounters.campaign_id)
);
CREATE POLICY dnd_encounters_delete ON dnd_encounters FOR DELETE USING (
  current_setting('oshal.is_operator', true) = 'on'
  OR owner_sub = NULLIF(current_setting('oshal.current_sub', true), '')
);

CREATE POLICY dnd_characters_select ON dnd_characters FOR SELECT USING (
  current_setting('oshal.is_operator', true) = 'on'
  OR (campaign_id IS NULL
      AND owner_sub = NULLIF(current_setting('oshal.current_sub', true), '')
      AND user_sub = NULLIF(current_setting('oshal.current_sub', true), ''))
  OR (campaign_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM dnd_campaigns c WHERE c.campaign_id = dnd_characters.campaign_id
  ))
);
CREATE POLICY dnd_characters_insert ON dnd_characters FOR INSERT WITH CHECK (
  current_setting('oshal.is_operator', true) = 'on'
  OR (campaign_id IS NULL
      AND owner_sub = NULLIF(current_setting('oshal.current_sub', true), '')
      AND user_sub = NULLIF(current_setting('oshal.current_sub', true), ''))
  OR (campaign_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM dnd_campaigns c WHERE c.campaign_id = dnd_characters.campaign_id
  ))
);
CREATE POLICY dnd_characters_update ON dnd_characters FOR UPDATE USING (
  current_setting('oshal.is_operator', true) = 'on'
  OR (campaign_id IS NULL
      AND owner_sub = NULLIF(current_setting('oshal.current_sub', true), '')
      AND user_sub = NULLIF(current_setting('oshal.current_sub', true), ''))
  OR (campaign_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM dnd_campaigns c WHERE c.campaign_id = dnd_characters.campaign_id
  ))
) WITH CHECK (
  current_setting('oshal.is_operator', true) = 'on'
  OR (campaign_id IS NULL
      AND owner_sub = NULLIF(current_setting('oshal.current_sub', true), '')
      AND user_sub = NULLIF(current_setting('oshal.current_sub', true), ''))
  OR (campaign_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM dnd_campaigns c WHERE c.campaign_id = dnd_characters.campaign_id
  ))
);
CREATE POLICY dnd_characters_delete ON dnd_characters FOR DELETE USING (
  current_setting('oshal.is_operator', true) = 'on'
  OR owner_sub = NULLIF(current_setting('oshal.current_sub', true), '')
);

CREATE POLICY dnd_archive_select ON dnd_archive FOR SELECT USING (
  current_setting('oshal.is_operator', true) = 'on'
  OR EXISTS (SELECT 1 FROM dnd_campaigns c WHERE c.campaign_id = dnd_archive.campaign_id)
);
CREATE POLICY dnd_archive_insert ON dnd_archive FOR INSERT WITH CHECK (
  current_setting('oshal.is_operator', true) = 'on'
  OR EXISTS (SELECT 1 FROM dnd_campaigns c WHERE c.campaign_id = dnd_archive.campaign_id)
);
CREATE POLICY dnd_archive_delete ON dnd_archive FOR DELETE USING (
  current_setting('oshal.is_operator', true) = 'on'
  OR owner_sub = NULLIF(current_setting('oshal.current_sub', true), '')
);

CREATE POLICY dnd_players_select ON dnd_players FOR SELECT USING (
  current_setting('oshal.is_operator', true) = 'on'
  OR EXISTS (SELECT 1 FROM dnd_campaigns c WHERE c.campaign_id = dnd_players.campaign_id)
);
CREATE POLICY dnd_players_insert ON dnd_players FOR INSERT WITH CHECK (
  current_setting('oshal.is_operator', true) = 'on'
  OR (
    user_sub = NULLIF(current_setting('oshal.current_sub', true), '')
    AND EXISTS (SELECT 1 FROM dnd_campaigns c WHERE c.campaign_id = dnd_players.campaign_id)
  )
);
CREATE POLICY dnd_players_update ON dnd_players FOR UPDATE USING (
  current_setting('oshal.is_operator', true) = 'on'
  OR owner_sub = NULLIF(current_setting('oshal.current_sub', true), '')
  OR user_sub = NULLIF(current_setting('oshal.current_sub', true), '')
) WITH CHECK (
  current_setting('oshal.is_operator', true) = 'on'
  OR owner_sub = NULLIF(current_setting('oshal.current_sub', true), '')
  OR (
    user_sub = NULLIF(current_setting('oshal.current_sub', true), '')
    AND EXISTS (SELECT 1 FROM dnd_campaigns c WHERE c.campaign_id = dnd_players.campaign_id)
  )
);
CREATE POLICY dnd_players_delete ON dnd_players FOR DELETE USING (
  current_setting('oshal.is_operator', true) = 'on'
  OR owner_sub = NULLIF(current_setting('oshal.current_sub', true), '')
  OR user_sub = NULLIF(current_setting('oshal.current_sub', true), '')
);

CREATE POLICY dnd_snapshots_select ON dnd_snapshots FOR SELECT USING (
  current_setting('oshal.is_operator', true) = 'on'
  OR EXISTS (SELECT 1 FROM dnd_campaigns c WHERE c.campaign_id = dnd_snapshots.campaign_id)
);
CREATE POLICY dnd_snapshots_insert ON dnd_snapshots FOR INSERT WITH CHECK (
  current_setting('oshal.is_operator', true) = 'on'
  OR EXISTS (SELECT 1 FROM dnd_campaigns c WHERE c.campaign_id = dnd_snapshots.campaign_id)
);
CREATE POLICY dnd_snapshots_delete ON dnd_snapshots FOR DELETE USING (
  current_setting('oshal.is_operator', true) = 'on'
  OR owner_sub = NULLIF(current_setting('oshal.current_sub', true), '')
);

ALTER TABLE dnd_campaigns  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dnd_campaigns  FORCE ROW LEVEL SECURITY;
ALTER TABLE dnd_encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE dnd_encounters FORCE ROW LEVEL SECURITY;
ALTER TABLE dnd_characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE dnd_characters FORCE ROW LEVEL SECURITY;
ALTER TABLE dnd_archive    ENABLE ROW LEVEL SECURITY;
ALTER TABLE dnd_archive    FORCE ROW LEVEL SECURITY;
ALTER TABLE dnd_players    ENABLE ROW LEVEL SECURITY;
ALTER TABLE dnd_players    FORCE ROW LEVEL SECURITY;
ALTER TABLE dnd_snapshots  ENABLE ROW LEVEL SECURITY;
ALTER TABLE dnd_snapshots  FORCE ROW LEVEL SECURITY;
