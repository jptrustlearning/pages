-- ============================================================================
-- JP Trust Learning — promo_codes v2
-- Adds: (1) per-plan discounts in ONE code, (2) members-only / renew-before-
-- expiry gating. Backward compatible — existing JPTFREE2026 / JPTHALF5050 keep
-- working unchanged. Run once in Supabase Dashboard → SQL Editor.
-- ============================================================================
--
-- WHAT'S NEW vs v1
-- ----------------
-- • discount_yearly   NUMERIC   — when applies_to='all', `discount_value` is the
--                                 MONTHLY discount and `discount_yearly` is the
--                                 YEARLY one. Lets one code give e.g. 5% monthly
--                                 / 10% yearly. (When applies_to is a single plan,
--                                 discount_value is used and discount_yearly is
--                                 ignored — old behaviour.)
-- • requires_active_member BOOL — when TRUE, the code only works for an email
--                                 that is an EXISTING member whose subscription
--                                 has NOT yet expired (i.e. renewing early).
--                                 New signups and lapsed members are rejected
--                                 with reason 'members_only'.
--
-- Both RPCs now take an extra p_email arg (defaults to '' so any older caller
-- still compiles). The email is only consulted when requires_active_member.
-- ============================================================================

-- ── 1. Add the new columns (idempotent) ────────────────────────────────────
ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS discount_yearly        NUMERIC,           -- null → fall back to discount_value
  ADD COLUMN IF NOT EXISTS requires_active_member BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. Shared helper: is this email an active (not-yet-expired) member? ─────
-- SECURITY DEFINER so it can read auth.users. Returns TRUE only when the email
-- exists AND subscription_expires_at is in the future AND not revoked.
CREATE OR REPLACE FUNCTION public.is_active_member(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email   TEXT := lower(trim(coalesce(p_email,'')));
  v_meta    JSONB;
  v_exp     TIMESTAMPTZ;
  v_status  TEXT;
BEGIN
  IF v_email = '' THEN RETURN FALSE; END IF;

  SELECT raw_app_meta_data INTO v_meta
    FROM auth.users
   WHERE lower(email) = v_email
   LIMIT 1;

  IF v_meta IS NULL THEN RETURN FALSE; END IF;               -- no such user

  v_status := v_meta->>'subscription_status';
  IF v_status = 'revoked' THEN RETURN FALSE; END IF;         -- revoked → not active

  v_exp := (v_meta->>'subscription_expires_at')::TIMESTAMPTZ;
  IF v_exp IS NULL THEN RETURN FALSE; END IF;                -- never subscribed
  RETURN now() < v_exp;                                      -- TRUE only if still valid
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;                                              -- bad timestamp etc → deny
END;
$$;

-- ── 3. Shared helper: final price for a row + plan ──────────────────────────
-- Centralises the per-plan discount math so preview and reserve never drift.
CREATE OR REPLACE FUNCTION public.promo_final_price(
  p_discount_type  TEXT,
  p_discount_value NUMERIC,
  p_discount_yearly NUMERIC,
  p_applies_to     TEXT,
  p_plan           TEXT,
  p_base           INT
)
RETURNS INT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_pct NUMERIC;
BEGIN
  IF p_discount_type = 'free' THEN
    RETURN 0;
  ELSIF p_discount_type = 'fixed' THEN
    RETURN GREATEST(0, (p_base - p_discount_value))::INT;
  ELSE  -- percent
    -- choose the right percentage: for an 'all' code, yearly uses discount_yearly
    -- (falling back to discount_value if yearly is null); monthly always uses
    -- discount_value. For a single-plan code, discount_value is the only one.
    IF p_applies_to = 'all' AND p_plan = 'yearly' THEN
      v_pct := COALESCE(p_discount_yearly, p_discount_value);
    ELSE
      v_pct := p_discount_value;
    END IF;
    RETURN GREATEST(0, round(p_base * (1 - v_pct/100.0)))::INT;
  END IF;
END;
$$;

-- ── 4. preview_promo(code, plan, email) ─────────────────────────────────────
-- READ-ONLY. Now also enforces members-only and computes per-plan price.
-- Old 2-arg calls keep working via the p_email default.
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
  -- members-only gate
  IF c.requires_active_member AND NOT public.is_active_member(p_email) THEN
    RETURN QUERY SELECT FALSE,'members_only',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
  END IF;

  v_final := public.promo_final_price(c.discount_type, c.discount_value, c.discount_yearly, c.applies_to, v_plan, v_base);

  -- report the plan-appropriate discount_value back to the client (for the % label)
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

-- ── 5. reserve_promo(code, plan, email) ─────────────────────────────────────
-- ATOMIC consume. Re-checks members-only BEFORE consuming a slot so a non-member
-- never burns quota. Per-plan price via the shared helper.
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

  -- Pre-check members-only WITHOUT consuming a slot. We look the row up read-only
  -- first; if it's a members-only code and the email isn't an active member, bail
  -- before the consuming UPDATE.
  SELECT * INTO c FROM public.promo_codes WHERE code = v_code;
  IF FOUND AND c.requires_active_member AND NOT public.is_active_member(p_email) THEN
    RETURN QUERY SELECT FALSE,'members_only',NULL::TEXT,0::NUMERIC,v_base,v_base,TRUE; RETURN;
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

-- ── 6. Grants ───────────────────────────────────────────────────────────────
-- New 3-arg signatures need their own grants. Old 2-arg versions are replaced
-- by these (same name, new default arg), so anon keeps EXECUTE on preview.
GRANT EXECUTE ON FUNCTION public.preview_promo(TEXT, TEXT, TEXT) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_promo(TEXT, TEXT, TEXT) FROM anon, authenticated;
-- is_active_member reads auth.users — keep it off the client entirely.
REVOKE EXECUTE ON FUNCTION public.is_active_member(TEXT) FROM anon, authenticated;

-- ── 7. Seed: JPTRENEW2569MAY ────────────────────────────────────────────────
-- Members-only early-renewal promo. Monthly 5% / Yearly 10%. 10 uses total
-- (counted per redemption, not per email). May 2569 (2026), Asia/Bangkok.
-- BKK = UTC+7 → 1 May 00:00 BKK = 30 Apr 17:00 UTC; 31 May 23:59:59 BKK = 31 May 16:59:59 UTC.
INSERT INTO public.promo_codes
  (code, description, discount_type, discount_value, discount_yearly, applies_to,
   valid_from, valid_until, max_uses, requires_active_member, active)
VALUES
  ('JPTRENEW2569MAY',
   'ต่ออายุก่อนหมด พ.ค. 2569 — รายเดือนลด 5% / รายปีลด 10% (เฉพาะสมาชิกที่ยังไม่หมดอายุ · 10 สิทธิ์)',
   'percent', 5, 10, 'all',
   '2026-04-30T17:00:00Z', '2026-05-31T16:59:59Z', 10, TRUE, TRUE)
ON CONFLICT (code) DO UPDATE
  SET description=EXCLUDED.description, discount_type=EXCLUDED.discount_type,
      discount_value=EXCLUDED.discount_value, discount_yearly=EXCLUDED.discount_yearly,
      applies_to=EXCLUDED.applies_to, valid_from=EXCLUDED.valid_from,
      valid_until=EXCLUDED.valid_until, max_uses=EXCLUDED.max_uses,
      requires_active_member=EXCLUDED.requires_active_member, active=EXCLUDED.active;

-- ── 8. Verify ───────────────────────────────────────────────────────────────
-- A member with a future expiry:
--   SELECT * FROM public.preview_promo('JPTRENEW2569MAY','monthly','member@example.com'); -- valid, final 143 (150 - 5%)
--   SELECT * FROM public.preview_promo('JPTRENEW2569MAY','yearly','member@example.com');   -- valid, final 1260 (1400 - 10%)
-- A non-member / lapsed email:
--   SELECT * FROM public.preview_promo('JPTRENEW2569MAY','yearly','stranger@example.com'); -- valid=false, reason members_only
-- Old codes unaffected:
--   SELECT * FROM public.preview_promo('JPTHALF5050','yearly');   -- still 700, slip true
--   SELECT * FROM public.preview_promo('JPTFREE2026','monthly');  -- still 0, slip false
--
-- HOW TO ADD NEXT MONTH'S PROMO (no code change needed — just run an INSERT):
--   INSERT INTO public.promo_codes
--     (code, description, discount_type, discount_value, discount_yearly, applies_to,
--      valid_from, valid_until, max_uses, requires_active_member, active)
--   VALUES ('JPTRENEW2569JUN', 'มิ.ย. 2569 …', 'percent', 5, 10, 'all',
--           '<from UTC>', '<until UTC>', 10, TRUE, TRUE);
-- ============================================================================
