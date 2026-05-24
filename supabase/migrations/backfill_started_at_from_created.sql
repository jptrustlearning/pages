-- ============================================================================
-- JP Trust Learning — Backfill subscription_started_at from created_at
-- Legacy beta members never had a signup date stored. This copies each user's
-- auth created_at (when the account was actually made) into
-- subscription_started_at, WITHOUT touching anyone who already has one.
--
-- Run in Supabase Dashboard → SQL Editor.
-- ⚠️  RUN STEP 1 (dry-run) FIRST and check the list before STEP 2.
--
-- created_at is timestamptz; we emit it as an ISO-8601 UTC string ending in 'Z'
-- to match the format the signup webhook writes (Date.toISOString()), so the
-- admin view and any date math read it consistently.
-- ============================================================================

-- ── STEP 1 — DRY RUN: who WILL get a signup date? (read-only, run first) ────
SELECT
  email,
  raw_app_meta_data->>'subscription_started_at' AS current_started,  -- expect null/empty
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS will_set_to,
  created_at
FROM auth.users
WHERE COALESCE(NULLIF(raw_app_meta_data->>'subscription_started_at',''), NULL) IS NULL
ORDER BY created_at;


-- ── STEP 2 — APPLY: copy created_at → subscription_started_at ───────────────
-- Same WHERE as the dry-run, so it can ONLY fill in users who are missing it.
-- Anyone who already has a started date keeps it.
--
-- Uncomment and run after the dry-run looks right:
--
-- UPDATE auth.users
--    SET raw_app_meta_data =
--          raw_app_meta_data
--          || jsonb_build_object(
--               'subscription_started_at',
--               to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
--             )
--  WHERE COALESCE(NULLIF(raw_app_meta_data->>'subscription_started_at',''), NULL) IS NULL;


-- ── STEP 3 — VERIFY (run after step 2) ──────────────────────────────────────
-- Confirm none are left without a signup date:
-- SELECT count(*) AS still_missing
--   FROM auth.users
--  WHERE COALESCE(NULLIF(raw_app_meta_data->>'subscription_started_at',''), NULL) IS NULL;
--
-- Spot-check a few:
-- SELECT email,
--        raw_app_meta_data->>'subscription_started_at' AS started,
--        raw_app_meta_data->>'subscription_expires_at' AS expires
--   FROM auth.users
--  ORDER BY created_at;
-- ============================================================================
