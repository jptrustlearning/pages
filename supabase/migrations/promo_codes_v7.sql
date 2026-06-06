-- ============================================================================
-- JP Trust Learning — promo_codes v7
-- JPTFREE2026 policy change (6 Jun 2569):
--   1. NEW USERS ONLY — requires_new_user = TRUE. Any email that already has
--      an auth.users account (active OR lapsed) is rejected with 'new_only'.
--      Uses the generic gate added in v3 — no RPC change needed.
--   2. Deadline extended 7 Jun → 15 Jun 2569 (BKK end of day).
--      15 Jun 23:59:59 BKK (UTC+7) = 2026-06-15T16:59:59Z.
--
-- Still monthly-only (v4) · still unlimited uses · still active.
-- requires_active_member stays FALSE (mutually exclusive with new-user gate).
--
-- Run once in Supabase Dashboard → SQL Editor. Idempotent — safe to re-run.
-- Run AFTER promo_codes.sql (v1) … promo_codes_v6.sql.
-- ============================================================================

UPDATE public.promo_codes
   SET requires_new_user = TRUE,
       valid_until       = '2026-06-15T16:59:59Z',
       description       = 'Beta — free access (เฉพาะสมาชิกใหม่ · รายเดือน · ถึง 15 มิ.ย. 2569)'
 WHERE code = 'JPTFREE2026';

-- ── Verify ───────────────────────────────────────────────────────────────
--   SELECT code, applies_to, requires_new_user, valid_until, active
--     FROM public.promo_codes WHERE code = 'JPTFREE2026';
--   -- expect: monthly · requires_new_user=t · 2026-06-15 16:59:59+00 · t
--
--   SELECT * FROM public.preview_promo('JPTFREE2026','monthly','brandnew@x.com');
--   -- expect: valid=t, final 0, slip false
--   SELECT * FROM public.preview_promo('JPTFREE2026','monthly','existing@x.com');
--   -- expect: valid=f, reason new_only   (use a real registered email)
--   SELECT * FROM public.preview_promo('JPTFREE2026','yearly','brandnew@x.com');
--   -- expect: valid=f, reason wrong_plan (unchanged from v4)
--   -- (after 15 Jun 2569 BKK)            reason expired
