-- ============================================================================
-- JP Trust Learning — promo_codes v4
-- Restrict JPTFREE2026 (free beta code):
--   • monthly plan ONLY (was 'all')           → yearly now returns wrong_plan
--   • valid until 7 Jun 2569 (2026) 23:59 BKK → after that returns expired
-- Pure data change — no schema or function changes. Run in SQL Editor.
--
-- BKK = UTC+7 → 7 Jun 2026 23:59:59 BKK = 7 Jun 2026 16:59:59 UTC.
-- (valid_from stays NULL = no lower bound; still unlimited uses; still active.)
-- ============================================================================

UPDATE public.promo_codes
   SET applies_to  = 'monthly',
       valid_until = '2026-06-07T16:59:59Z',
       description = 'Beta — free access (เฉพาะรายเดือน · ถึง 7 มิ.ย. 2569)'
 WHERE code = 'JPTFREE2026';

-- ── Verify ───────────────────────────────────────────────────────────────
--   SELECT * FROM public.preview_promo('JPTFREE2026','monthly','x@x.com'); -- valid, final 0, slip false
--   SELECT * FROM public.preview_promo('JPTFREE2026','yearly','x@x.com');  -- valid=false, reason wrong_plan
--   (after 7 Jun 2569)                                                     -- valid=false, reason expired
--   SELECT code, applies_to, valid_until, active FROM public.promo_codes WHERE code='JPTFREE2026';
-- ============================================================================
