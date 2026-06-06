-- =====================================================================
-- promo_codes v9 — public-promo flag + list_public_promos() RPC
-- ---------------------------------------------------------------------
-- Goal: make the promo displays DB-driven so launching a promo needs NO
-- code change / deploy. Frontends (signup promo picker + member-dashboard
-- expiry-reminder hint) call list_public_promos() instead of hardcoding.
--
--   * is_public = TRUE  → promo appears in public UIs
--   * is_public = FALSE → secret / manual-entry-only codes stay hidden
--                         (e.g. JPTSECRET60, JPTFREE2026)
--
-- The RPC only returns promos that are active, public, inside their date
-- window, and not sold out — so the frontends never show dead promos.
-- Safe to re-run (ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / UPDATE).
-- Run AFTER promo_codes.sql v1–v8.
-- =====================================================================

-- 1) Public flag (default FALSE = nothing leaks unless explicitly flagged)
ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) Flag the promos currently advertised in the signup popup
--    (mirrors PROMO_CATALOG as of 2026-06-06: BETA2026RENEW + HALF5050)
UPDATE public.promo_codes
   SET is_public = TRUE
 WHERE code IN ('JPTBETA2026RENEW', 'JPTHALF5050');

-- 3) Read-only list RPC — anon-safe (exposes no usage internals beyond
--    seats_left; secret codes are excluded by the is_public filter)
CREATE OR REPLACE FUNCTION public.list_public_promos()
RETURNS TABLE (
  code                    TEXT,
  description             TEXT,
  discount_type           TEXT,
  discount_value          NUMERIC,
  discount_yearly         NUMERIC,
  applies_to              TEXT,
  valid_from              TIMESTAMPTZ,
  valid_until             TIMESTAMPTZ,
  requires_active_member  BOOLEAN,
  requires_new_user       BOOLEAN,
  requires_existing_user  BOOLEAN,
  seats_left              INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.code,
         p.description,
         p.discount_type,
         p.discount_value,
         p.discount_yearly,
         p.applies_to,
         p.valid_from,
         p.valid_until,
         p.requires_active_member,
         p.requires_new_user,
         p.requires_existing_user,
         CASE WHEN p.max_uses IS NULL THEN NULL
              ELSE GREATEST(p.max_uses - p.used_count, 0) END AS seats_left
  FROM public.promo_codes p
  WHERE p.active = TRUE
    AND p.is_public = TRUE
    AND (p.valid_from  IS NULL OR now() >= p.valid_from)
    AND (p.valid_until IS NULL OR now() <= p.valid_until)
    AND (p.max_uses IS NULL OR p.used_count < p.max_uses)
  ORDER BY p.valid_until ASC NULLS LAST, p.code ASC;
$$;

GRANT EXECUTE ON FUNCTION public.list_public_promos() TO anon, authenticated;

-- =====================================================================
-- Verify after running:
--   SELECT code, is_public FROM public.promo_codes ORDER BY code;
--   SELECT * FROM public.list_public_promos();
--   → ต้องเห็น JPTBETA2026RENEW + JPTHALF5050 (และไม่เห็น JPTSECRET60/JPTFREE2026)
--
-- ตั้งโปรใหม่ให้โชว์ทุกหน้าอัตโนมัติ = INSERT row เดียว ตัวอย่าง:
--   INSERT INTO public.promo_codes
--     (code, description, discount_type, discount_value, discount_yearly,
--      applies_to, valid_from, valid_until, max_uses,
--      requires_active_member, requires_new_user, requires_existing_user,
--      active, is_public)
--   VALUES
--     ('JPTJULY2026', 'โปรเดือน ก.ค.', 'percent', 10, 20, 'all',
--      '2026-06-30T17:00:00Z', '2026-07-31T16:59:59Z', 50,
--      FALSE, FALSE, FALSE, TRUE, TRUE)
--   ON CONFLICT (code) DO UPDATE
--     SET description=EXCLUDED.description, discount_type=EXCLUDED.discount_type,
--         discount_value=EXCLUDED.discount_value, discount_yearly=EXCLUDED.discount_yearly,
--         applies_to=EXCLUDED.applies_to, valid_from=EXCLUDED.valid_from,
--         valid_until=EXCLUDED.valid_until, max_uses=EXCLUDED.max_uses,
--         requires_active_member=EXCLUDED.requires_active_member,
--         requires_new_user=EXCLUDED.requires_new_user,
--         requires_existing_user=EXCLUDED.requires_existing_user,
--         active=EXCLUDED.active, is_public=EXCLUDED.is_public;
-- =====================================================================
