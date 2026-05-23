-- ============================================================================
-- JP Trust Learning — promo_codes table + atomic reservation
-- Run this once in Supabase Dashboard → SQL Editor.
-- ============================================================================
--
-- Pricing model: server-side price table lives in the Edge Function
--   (monthly 150, yearly 1400). A promo code adjusts that price.
--
-- discount_type:
--   'free'    → final price 0,  slip NOT required (e.g. JPTFREE2026)
--   'percent' → final price = base * (1 - discount_value/100)   [slip required]
--   'fixed'   → final price = base - discount_value (floored at 0) [slip required]
--
-- Quota ("30 สิทธิ์") is consumed atomically ONLY when a signup completes,
-- via reserve_promo() (SECURITY DEFINER so it can bump used_count past RLS).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.promo_codes (
  code            TEXT PRIMARY KEY,
  description     TEXT,
  discount_type   TEXT NOT NULL CHECK (discount_type IN ('free','percent','fixed')),
  discount_value  NUMERIC NOT NULL DEFAULT 0,        -- percent: 0-100 · fixed: THB · free: ignored
  applies_to      TEXT NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all','monthly','yearly')),
  valid_from      TIMESTAMPTZ,                        -- null = no lower bound
  valid_until     TIMESTAMPTZ,                        -- null = no upper bound
  max_uses        INT,                                -- null = unlimited
  used_count      INT NOT NULL DEFAULT 0,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── RLS ──────────────────────────────────────────────────────────────────
-- The anon client only ever calls the two RPCs below (which are SECURITY
-- DEFINER and run as owner). We do NOT grant direct table access to anon, so
-- the code list / used_count / quotas are never exposed or writable from the
-- client. Service-role (Edge Function) bypasses RLS anyway.
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;
-- (intentionally no policies for anon/authenticated → no direct access)

-- ── preview_promo(code, plan) ──────────────────────────────────────────────
-- READ-ONLY. Validates a code for a plan and returns the resulting price.
-- Does NOT consume quota. Used by the signup page when the user clicks "ใช้รหัส".
-- Returns one row; `valid=false` with a reason when not usable.
CREATE OR REPLACE FUNCTION public.preview_promo(p_code TEXT, p_plan TEXT)
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
BEGIN
  -- base price table (must match Edge Function PLAN_PRICES)
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

  -- compute final price
  IF c.discount_type = 'free' THEN
    v_final := 0;
  ELSIF c.discount_type = 'percent' THEN
    v_final := GREATEST(0, round(v_base * (1 - c.discount_value/100.0)))::INT;
  ELSE -- fixed
    v_final := GREATEST(0, (v_base - c.discount_value))::INT;
  END IF;

  RETURN QUERY SELECT
    TRUE, 'ok', c.discount_type, c.discount_value, v_base, v_final,
    (c.discount_type <> 'free');  -- free = no slip; discounted = slip still required
END;
$$;

-- ── reserve_promo(code, plan) ──────────────────────────────────────────────
-- ATOMIC. Re-validates AND consumes one quota slot in a single UPDATE so
-- concurrent signups can't oversell the 30 seats. Returns the locked-in price.
-- Called by the Edge Function (service-role) at signup completion ONLY.
-- For 'free'/unlimited codes it still validates window/plan but doesn't cap.
CREATE OR REPLACE FUNCTION public.reserve_promo(p_code TEXT, p_plan TEXT)
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
BEGIN
  v_base := CASE v_plan WHEN 'monthly' THEN 150 WHEN 'yearly' THEN 1400 ELSE 0 END;

  -- Single atomic UPDATE: only succeeds if the code is currently usable.
  -- The WHERE clause re-checks window/plan/quota; RETURNING gives the row we
  -- consumed. used_count is bumped only when max_uses is set (limited codes).
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
    -- Distinguish the failure reason for a helpful client message
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

  IF c.discount_type = 'free' THEN
    v_final := 0;
  ELSIF c.discount_type = 'percent' THEN
    v_final := GREATEST(0, round(v_base * (1 - c.discount_value/100.0)))::INT;
  ELSE
    v_final := GREATEST(0, (v_base - c.discount_value))::INT;
  END IF;

  RETURN QUERY SELECT
    TRUE, 'ok', c.discount_type, c.discount_value, v_base, v_final,
    (c.discount_type <> 'free');
END;
$$;

-- Allow the anon client to call preview only (it's read-only & safe).
-- reserve is called by the Edge Function with the service role.
GRANT EXECUTE ON FUNCTION public.preview_promo(TEXT, TEXT) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_promo(TEXT, TEXT) FROM anon, authenticated;

-- ── Seed the two codes ─────────────────────────────────────────────────────
-- JPTFREE2026 — free, unlimited, always on (current beta).
INSERT INTO public.promo_codes (code, description, discount_type, discount_value, applies_to, valid_from, valid_until, max_uses, active)
VALUES ('JPTFREE2026', 'Beta — free access', 'free', 0, 'all', NULL, NULL, NULL, TRUE)
ON CONFLICT (code) DO UPDATE
  SET discount_type=EXCLUDED.discount_type, discount_value=EXCLUDED.discount_value,
      applies_to=EXCLUDED.applies_to, valid_from=EXCLUDED.valid_from,
      valid_until=EXCLUDED.valid_until, max_uses=EXCLUDED.max_uses, active=EXCLUDED.active;

-- JPTHALF5050 — 50% off, 20 May–30 Jun 2026 (Asia/Bangkok), 30 seats.
-- BKK is UTC+7, so 20 May 00:00 BKK = 19 May 17:00 UTC; 30 Jun 23:59:59 BKK = 30 Jun 16:59:59 UTC.
INSERT INTO public.promo_codes (code, description, discount_type, discount_value, applies_to, valid_from, valid_until, max_uses, active)
VALUES ('JPTHALF5050', '20 พ.ค.–30 มิ.ย. 2569 — ลด 50% เฉพาะรายปี (30 สิทธิ์แรก)', 'percent', 50, 'yearly',
        '2026-05-19T17:00:00Z', '2026-06-30T16:59:59Z', 30, TRUE)
ON CONFLICT (code) DO UPDATE
  SET discount_type=EXCLUDED.discount_type, discount_value=EXCLUDED.discount_value,
      applies_to=EXCLUDED.applies_to, valid_from=EXCLUDED.valid_from,
      valid_until=EXCLUDED.valid_until, max_uses=EXCLUDED.max_uses, active=EXCLUDED.active;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- SELECT code, discount_type, discount_value, applies_to, valid_from, valid_until, max_uses, used_count, active FROM public.promo_codes;
-- SELECT * FROM public.preview_promo('JPTHALF5050','yearly');   -- expect final_price 700, slip_required true
-- SELECT * FROM public.preview_promo('JPTHALF5050','monthly');  -- expect valid false, reason wrong_plan (yearly-only)
-- SELECT * FROM public.preview_promo('JPTFREE2026','monthly');  -- expect final_price 0,   slip_required false
