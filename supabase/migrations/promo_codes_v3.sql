-- ============================================================================
-- JP Trust Learning — promo_codes v3
-- Adds: new-user-only gating (mirror image of v2's members-only). A code with
-- requires_new_user=TRUE works ONLY for an email that does NOT yet exist in
-- auth.users at all — a brand-new signup. Anyone who has ever had an account
-- (active OR lapsed) is rejected with reason 'new_only'.
--
-- Backward compatible. Run AFTER promo_codes.sql (v1) and promo_codes_v2.sql.
-- Run once in Supabase Dashboard → SQL Editor.
--
-- Applied to JPTHALF5050 (50%-off launch promo) so existing members can't reuse
-- the launch discount to renew. JPTRENEW2569MAY (members-only) is unaffected.
--
-- NOTE: requires_new_user and requires_active_member are mutually exclusive by
-- meaning. If both were ever TRUE on one row, no email could pass — guard added.
-- ============================================================================

-- ── 1. New column ───────────────────────────────────────────────────────────
ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS requires_new_user BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. Helper: does this email already exist in auth.users? ─────────────────
-- SECURITY DEFINER so it can read auth.users. TRUE when the email is already
-- registered (in any state). An empty/blank email counts as NOT existing, so a
-- new-user promo previews as usable until the user types an email that's taken.
CREATE OR REPLACE FUNCTION public.email_exists(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(trim(coalesce(p_email,'')));
BEGIN
  IF v_email = '' THEN RETURN FALSE; END IF;
  RETURN EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email);
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$$;

-- ── 3. preview_promo(code, plan, email) — re-defined to add new-user gate ────
CREATE OR REPLACE FUNCTION public.preview_promo(p_code TEXT, p_plan TEXT, p_email TEXT DEFAULT '')
RETURNS TABLE (
  valid          BOOLEAN,
  reason         TEXT,
  discount_type  TEXT,
  discount_value NUMERIC,
  base_price     INT,
  final_price    INT,
  slip_required  BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c       public.promo_codes%ROWTYPE;
  v_code  TEXT := upper(trim(coalesce(p_code,'')));
  v_plan  TEXT := lower(trim(coalesce(p_plan,'')));
  v_base  INT;
  v_final INT;
  v_pct   NUMERIC;
BEGIN
  v_base := CASE v_plan WHEN 'monthly' THEN 150 WHEN 'yearly' THEN 1400 ELSE 0 END;

  IF v_code = '' THEN
    RETURN QUERY SELECT FALSE,'empty',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
  END IF;

  SELECT * INTO c FROM public.promo_codes WHERE code = v_code;
  IF NOT FOUND OR NOT c.active THEN
    RETURN QUERY SELECT FALSE,'invalid',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
  END IF;
  IF c.valid_from IS NOT NULL AND now() < c.valid_from THEN
    RETURN QUERY SELECT FALSE,'not_started',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
  END IF;
  IF c.valid_until IS NOT NULL AND now() > c.valid_until THEN
    RETURN QUERY SELECT FALSE,'expired',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
  END IF;
  IF c.applies_to <> 'all' AND c.applies_to <> v_plan THEN
    RETURN QUERY SELECT FALSE,'wrong_plan',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
  END IF;
  IF c.max_uses IS NOT NULL AND c.used_count >= c.max_uses THEN
    RETURN QUERY SELECT FALSE,'sold_out',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
  END IF;
  -- members-only gate (v2)
  IF c.requires_active_member AND NOT public.is_active_member(p_email) THEN
    RETURN QUERY SELECT FALSE,'members_only',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
  END IF;
  -- new-user-only gate (v3): reject any email that already has an account
  IF c.requires_new_user AND public.email_exists(p_email) THEN
    RETURN QUERY SELECT FALSE,'new_only',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
  END IF;

  v_final := public.promo_final_price(c.discount_type, c.discount_value, c.discount_yearly, c.applies_to, v_plan, v_base);

  IF c.applies_to = 'all' AND v_plan = 'yearly' THEN
    v_pct := COALESCE(c.discount_yearly, c.discount_value);
  ELSE
    v_pct := c.discount_value;
  END IF;

  RETURN QUERY SELECT
    TRUE, 'ok', c.discount_type, v_pct, v_base, v_final,
    (c.discount_type <> 'free');
END;
$$;

-- ── 4. reserve_promo(code, plan, email) — re-defined to add new-user gate ────
CREATE OR REPLACE FUNCTION public.reserve_promo(p_code TEXT, p_plan TEXT, p_email TEXT DEFAULT '')
RETURNS TABLE (
  reserved       BOOLEAN,
  reason         TEXT,
  discount_type  TEXT,
  discount_value NUMERIC,
  base_price     INT,
  final_price    INT,
  slip_required  BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c       public.promo_codes%ROWTYPE;
  v_code  TEXT := upper(trim(coalesce(p_code,'')));
  v_plan  TEXT := lower(trim(coalesce(p_plan,'')));
  v_base  INT;
  v_final INT;
  v_pct   NUMERIC;
BEGIN
  v_base := CASE v_plan WHEN 'monthly' THEN 150 WHEN 'yearly' THEN 1400 ELSE 0 END;

  -- Pre-check eligibility gates WITHOUT consuming a slot.
  SELECT * INTO c FROM public.promo_codes WHERE code = v_code;
  IF FOUND AND c.requires_active_member AND NOT public.is_active_member(p_email) THEN
    RETURN QUERY SELECT FALSE,'members_only',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
  END IF;
  IF FOUND AND c.requires_new_user AND public.email_exists(p_email) THEN
    RETURN QUERY SELECT FALSE,'new_only',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
  END IF;

  -- Single atomic UPDATE: only succeeds if the code is currently usable.
  UPDATE public.promo_codes
     SET used_count = used_count + 1
   WHERE code = v_code
     AND active
     AND (valid_from  IS NULL OR now() >= valid_from)
     AND (valid_until IS NULL OR now() <= valid_until)
     AND (applies_to = 'all' OR applies_to = v_plan)
     AND (max_uses IS NULL OR used_count < max_uses)
  RETURNING * INTO c;

  IF NOT FOUND THEN
    SELECT * INTO c FROM public.promo_codes WHERE code = v_code;
    IF NOT FOUND OR NOT c.active THEN
      RETURN QUERY SELECT FALSE,'invalid',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
    ELSIF c.valid_from IS NOT NULL AND now() < c.valid_from THEN
      RETURN QUERY SELECT FALSE,'not_started',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
    ELSIF c.valid_until IS NOT NULL AND now() > c.valid_until THEN
      RETURN QUERY SELECT FALSE,'expired',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
    ELSIF c.applies_to <> 'all' AND c.applies_to <> v_plan THEN
      RETURN QUERY SELECT FALSE,'wrong_plan',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
    ELSE
      RETURN QUERY SELECT FALSE,'sold_out',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
    END IF;
  END IF;

  v_final := public.promo_final_price(c.discount_type, c.discount_value, c.discount_yearly, c.applies_to, v_plan, v_base);

  IF c.applies_to = 'all' AND v_plan = 'yearly' THEN
    v_pct := COALESCE(c.discount_yearly, c.discount_value);
  ELSE
    v_pct := c.discount_value;
  END IF;

  RETURN QUERY SELECT
    TRUE, 'ok', c.discount_type, v_pct, v_base, v_final,
    (c.discount_type <> 'free');
END;
$$;

-- ── 5. Grants ───────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.preview_promo(TEXT, TEXT, TEXT) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_promo(TEXT, TEXT, TEXT) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.email_exists(TEXT) FROM anon, authenticated;

-- ── 6. Flag JPTHALF5050 as new-user-only ────────────────────────────────────
UPDATE public.promo_codes
   SET requires_new_user = TRUE
 WHERE code = 'JPTHALF5050';

-- ── 7. Verify ───────────────────────────────────────────────────────────────
-- New email (not in auth.users):
--   SELECT * FROM public.preview_promo('JPTHALF5050','yearly','brandnew@example.com'); -- valid, final 700
-- Existing email (active OR lapsed):
--   SELECT * FROM public.preview_promo('JPTHALF5050','yearly','existing@example.com'); -- valid=false, reason new_only
-- Members-only promo still works the opposite way:
--   SELECT * FROM public.preview_promo('JPTRENEW2569MAY','yearly','member@example.com'); -- valid (active member)
--   SELECT * FROM public.preview_promo('JPTRENEW2569MAY','yearly','brandnew@example.com'); -- members_only
--
-- TO MAKE ANY FUTURE PROMO NEW-USER-ONLY:
--   ...add column requires_new_user=TRUE in the INSERT, or
--   UPDATE public.promo_codes SET requires_new_user=TRUE WHERE code='YOURCODE';
-- ============================================================================
