-- ============================================================================
-- JP Trust Learning — promo_codes v5
-- Adds a third eligibility gate: requires_existing_user. When TRUE, the code
-- works for ANY email that has EVER had an account (active OR lapsed) — but NOT
-- a brand-new email. This is the "any past customer" gate, looser than v2's
-- members-only (which also requires the sub to still be valid).
--
-- Gate summary (all mutually distinct):
--   requires_active_member  → must be a member whose sub hasn't expired   (RENEW)
--   requires_new_user       → email must NOT exist yet                    (HALF5050)
--   requires_existing_user  → email MUST exist (expired is fine)          (SECRET60)  ← new
--
-- Reuses email_exists() from v3. Backward compatible.
-- Run AFTER v1→v2→v3 (v4 optional, order-independent). Run once in SQL Editor.
-- ============================================================================

-- ── 1. New column ───────────────────────────────────────────────────────────
ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS requires_existing_user BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. preview_promo — re-defined to add the existing-user gate ─────────────
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
  -- members-only gate (v2): active, not-yet-expired member
  IF c.requires_active_member AND NOT public.is_active_member(p_email) THEN
    RETURN QUERY SELECT FALSE,'members_only',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
  END IF;
  -- new-user-only gate (v3): email must not exist yet
  IF c.requires_new_user AND public.email_exists(p_email) THEN
    RETURN QUERY SELECT FALSE,'new_only',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
  END IF;
  -- existing-user gate (v5): must have an account already (expired is fine)
  IF c.requires_existing_user AND NOT public.email_exists(p_email) THEN
    RETURN QUERY SELECT FALSE,'existing_only',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
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

-- ── 3. reserve_promo — re-defined to add the existing-user gate ─────────────
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

  -- Pre-check all eligibility gates WITHOUT consuming a slot.
  SELECT * INTO c FROM public.promo_codes WHERE code = v_code;
  IF FOUND AND c.requires_active_member AND NOT public.is_active_member(p_email) THEN
    RETURN QUERY SELECT FALSE,'members_only',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
  END IF;
  IF FOUND AND c.requires_new_user AND public.email_exists(p_email) THEN
    RETURN QUERY SELECT FALSE,'new_only',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
  END IF;
  IF FOUND AND c.requires_existing_user AND NOT public.email_exists(p_email) THEN
    RETURN QUERY SELECT FALSE,'existing_only',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
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

-- ── 4. Grants ───────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.preview_promo(TEXT, TEXT, TEXT) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_promo(TEXT, TEXT, TEXT) FROM anon, authenticated;

-- ── 5. Seed: JPTSECRET60 ────────────────────────────────────────────────────
-- Secret code (NOT shown in the picker — manual entry only, like JPTFREE2026).
-- 60% off yearly, 3 uses, valid until 31 Jul 2569. Any past customer (active or
-- lapsed) — does NOT require the subscription to still be valid.
-- BKK = UTC+7 → 31 Jul 2026 23:59:59 BKK = 31 Jul 2026 16:59:59 UTC.
INSERT INTO public.promo_codes
  (code, description, discount_type, discount_value, discount_yearly, applies_to,
   valid_from, valid_until, max_uses,
   requires_active_member, requires_new_user, requires_existing_user, active)
VALUES
  ('JPTSECRET60',
   'โค้ดลับ — ลด 60% เฉพาะรายปี · เฉพาะลูกค้าที่เคยสมัคร · 3 สิทธิ์ · ถึง 31 ก.ค. 2569',
   'percent', 60, NULL, 'yearly',
   NULL, '2026-07-31T16:59:59Z', 3,
   FALSE, FALSE, TRUE, TRUE)
ON CONFLICT (code) DO UPDATE
  SET description=EXCLUDED.description, discount_type=EXCLUDED.discount_type,
      discount_value=EXCLUDED.discount_value, discount_yearly=EXCLUDED.discount_yearly,
      applies_to=EXCLUDED.applies_to, valid_from=EXCLUDED.valid_from,
      valid_until=EXCLUDED.valid_until, max_uses=EXCLUDED.max_uses,
      requires_active_member=EXCLUDED.requires_active_member,
      requires_new_user=EXCLUDED.requires_new_user,
      requires_existing_user=EXCLUDED.requires_existing_user, active=EXCLUDED.active;

-- ── 6. Verify ───────────────────────────────────────────────────────────────
-- Past customer (active OR expired), yearly:
--   SELECT * FROM public.preview_promo('JPTSECRET60','yearly','existing@example.com'); -- valid, final 560 (1400-60%)
-- Brand-new email:
--   SELECT * FROM public.preview_promo('JPTSECRET60','yearly','brandnew@example.com'); -- valid=false, existing_only
-- Wrong plan:
--   SELECT * FROM public.preview_promo('JPTSECRET60','monthly','existing@example.com'); -- valid=false, wrong_plan
-- ============================================================================
