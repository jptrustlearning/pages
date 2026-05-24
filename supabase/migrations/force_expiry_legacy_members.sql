-- ============================================================================
-- JP Trust Learning — Force expiry for legacy members with NO expiry date
-- Sets subscription_expires_at = 20 Jun 2569 (2026) for every user whose
-- expiry is currently missing/null (the old free-beta members), WITHOUT
-- touching anyone who already has a real expiry date.
--
-- Run in Supabase Dashboard → SQL Editor.
-- ⚠️  RUN STEP 1 (dry-run) FIRST and eyeball the list before STEP 2.
--
-- Target date: 20 Jun 2569 23:59:59 Asia/Bangkok = 20 Jun 2026 16:59:59 UTC.
-- ============================================================================

-- ── STEP 1 — DRY RUN: who WILL be changed? (read-only, run this first) ──────
-- Returns every user who has no usable expiry yet. These are the ONLY rows
-- step 2 will touch. If a paying member appears here unexpectedly, STOP.
SELECT
  email,
  raw_app_meta_data->>'subscription_status'     AS status,
  raw_app_meta_data->>'plan'                     AS plan,
  raw_app_meta_data->>'subscription_expires_at'  AS current_expiry,  -- expect null/empty
  created_at
FROM auth.users
WHERE COALESCE(NULLIF(raw_app_meta_data->>'subscription_expires_at',''), NULL) IS NULL
ORDER BY created_at;


-- ── STEP 2 — APPLY: set the forced expiry on exactly those rows ─────────────
-- The WHERE clause is identical to the dry-run, so it can ONLY affect users
-- with a missing/empty expiry. Members who already have a date are untouched.
-- Also stamps subscription_status='active' so the app treats them as valid
-- until the new date (only when status was missing — won't override 'revoked').
--
-- Uncomment and run after the dry-run looks right:
--
-- UPDATE auth.users
--    SET raw_app_meta_data =
--          raw_app_meta_data
--          || jsonb_build_object('subscription_expires_at','2026-06-20T16:59:59Z')
--          || CASE
--               WHEN COALESCE(raw_app_meta_data->>'subscription_status','') = ''
--               THEN jsonb_build_object('subscription_status','active')
--               ELSE '{}'::jsonb
--             END
--  WHERE COALESCE(NULLIF(raw_app_meta_data->>'subscription_expires_at',''), NULL) IS NULL;


-- ── STEP 3 — VERIFY (run after step 2) ──────────────────────────────────────
-- Everyone should now have an expiry; the forced ones read 2026-06-20.
-- SELECT email,
--        raw_app_meta_data->>'subscription_status'    AS status,
--        raw_app_meta_data->>'subscription_expires_at' AS expiry
--   FROM auth.users
--  ORDER BY (raw_app_meta_data->>'subscription_expires_at') NULLS FIRST;
--
-- Confirm none are left null:
-- SELECT count(*) AS still_missing
--   FROM auth.users
--  WHERE COALESCE(NULLIF(raw_app_meta_data->>'subscription_expires_at',''), NULL) IS NULL;
-- ============================================================================
