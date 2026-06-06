-- ============================================================================
-- JP Trust Learning — promo_codes v8
-- JPTSECRET60 quota change (6 Jun 2569): max_uses 3 → 10.
--
-- used_count is NOT reset — the quota check is used_count < max_uses, so any
-- redemptions already consumed still count (e.g. 2 used → 8 slots remain).
-- Everything else unchanged: 60% off · yearly-only · existing-customers-only
-- (requires_existing_user) · until 31 Jul 2569.
--
-- Run once in Supabase Dashboard → SQL Editor. Idempotent — safe to re-run.
-- Run AFTER promo_codes.sql (v1) … promo_codes_v7.sql.
-- ============================================================================

UPDATE public.promo_codes
   SET max_uses    = 10,
       description = 'โค้ดลับ — ลด 60% เฉพาะรายปี · เฉพาะลูกค้าที่เคยสมัคร · 10 สิทธิ์ · ถึง 31 ก.ค. 2569'
 WHERE code = 'JPTSECRET60';

-- ── Verify ───────────────────────────────────────────────────────────────
--   SELECT code, max_uses, used_count, applies_to, requires_existing_user,
--          valid_until, active
--     FROM public.promo_codes WHERE code = 'JPTSECRET60';
--   -- expect: max_uses=10 · used_count unchanged · yearly · t ·
--   --         2026-07-31 16:59:59+00 · t
--
--   SELECT * FROM public.preview_promo('JPTSECRET60','yearly','existing@x.com');
--   -- expect: valid=t, final 560   (use a real registered email)
