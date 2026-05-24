-- ============================================================================
-- JP Trust Learning — promo_codes v6
-- Seed one new promo: JPTBETA2026RENEW. No schema/function change — reuses the
-- requires_active_member gate from v2. Run AFTER v2 (which adds that column).
-- Run once in Supabase Dashboard → SQL Editor.
--
-- JPTBETA2026RENEW — 50% off YEARLY, active (not-yet-expired) members only,
-- UNLIMITED uses, valid until 20 Jun 2569. Shown in the picker popup.
-- Pairs with the legacy-member force-expiry (20 Jun 2569): beta members stay
-- active right up to the last day they can use this renew discount.
-- BKK = UTC+7 → 20 Jun 2026 23:59:59 BKK = 20 Jun 2026 16:59:59 UTC.
-- ============================================================================

INSERT INTO public.promo_codes
  (code, description, discount_type, discount_value, discount_yearly, applies_to,
   valid_from, valid_until, max_uses,
   requires_active_member, requires_new_user, requires_existing_user, active)
VALUES
  ('JPTBETA2026RENEW',
   'ต่ออายุ Beta — ลด 50% เฉพาะรายปี · เฉพาะสมาชิกที่ยังไม่หมดอายุ · ถึง 20 มิ.ย. 2569',
   'percent', 50, NULL, 'yearly',
   NULL, '2026-06-20T16:59:59Z', NULL,
   TRUE, FALSE, FALSE, TRUE)
ON CONFLICT (code) DO UPDATE
  SET description=EXCLUDED.description, discount_type=EXCLUDED.discount_type,
      discount_value=EXCLUDED.discount_value, discount_yearly=EXCLUDED.discount_yearly,
      applies_to=EXCLUDED.applies_to, valid_from=EXCLUDED.valid_from,
      valid_until=EXCLUDED.valid_until, max_uses=EXCLUDED.max_uses,
      requires_active_member=EXCLUDED.requires_active_member,
      requires_new_user=EXCLUDED.requires_new_user,
      requires_existing_user=EXCLUDED.requires_existing_user, active=EXCLUDED.active;

-- ── Verify ───────────────────────────────────────────────────────────────
--   SELECT * FROM public.preview_promo('JPTBETA2026RENEW','yearly','member@x.com');   -- valid, final 700 (1400-50%)
--   SELECT * FROM public.preview_promo('JPTBETA2026RENEW','yearly','stranger@x.com'); -- valid=false, members_only
--   SELECT * FROM public.preview_promo('JPTBETA2026RENEW','monthly','member@x.com');  -- valid=false, wrong_plan
-- ============================================================================
