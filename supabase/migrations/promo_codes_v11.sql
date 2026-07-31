-- ============================================================================
-- JP Trust Learning — promo_codes v11
-- NEW PROMO: SECRETMIND2026 — โค้ดลับ ฟรี 100% รายเดือน 1 สิทธิ์
--
--   • ฟรี 100% (discount_type 'free' → final price 0, ข้ามสลิปอัตโนมัติ)
--   • เฉพาะแพ็กรายเดือน (applies_to 'monthly' → yearly คืน 'wrong_plan')
--   • ใช้ได้ทั้ง "สมัครใหม่" และ "ลูกค้าเก่า/ต่ออายุ" — ไม่มี eligibility gate
--     (requires_active_member / requires_new_user / requires_existing_user = FALSE)
--   • จำกัด 1 สิทธิ์ (max_uses = 1) — quota กินตอนสมัคร/ต่ออายุสำเร็จจริงเท่านั้น
--   • ช่วงเวลา: 31 ก.ค. 2569 00:00 → 31 ส.ค. 2569 23:59:59 (Asia/Bangkok, UTC+7)
--       31 Jul 00:00 BKK      = 2026-07-30T17:00:00Z
--       31 Aug 23:59:59 BKK   = 2026-08-31T16:59:59Z
--   • is_public = FALSE → โค้ดลับ ไม่โชว์ใน signup popup / dashboard renew hint
--     (list_public_promos ไม่คืน row นี้ — แบบเดียวกับ JPTSECRET60/JPTFREE2026)
--
-- Run once in Supabase Dashboard → SQL Editor. Idempotent — safe to re-run
-- (ON CONFLICT ไม่แตะ used_count → รันซ้ำไม่ล้างยอดที่ใช้ไปแล้ว).
-- Run AFTER promo_codes.sql (v1) … promo_codes_v10.sql.
-- ============================================================================

INSERT INTO public.promo_codes
  (code, description, discount_type, discount_value, discount_yearly,
   applies_to, valid_from, valid_until, max_uses,
   requires_active_member, requires_new_user, requires_existing_user,
   active, is_public)
VALUES
  ('SECRETMIND2026',
   'โค้ดลับ · ฟรี 100% เฉพาะแพ็กรายเดือน · สมัครใหม่และต่ออายุ · 1 สิทธิ์ · 31 ก.ค.–31 ส.ค. 2569',
   'free', 0, NULL,
   'monthly', '2026-07-30T17:00:00Z', '2026-08-31T16:59:59Z', 1,
   FALSE, FALSE, FALSE,
   TRUE, FALSE)
ON CONFLICT (code) DO UPDATE
  SET description            = EXCLUDED.description,
      discount_type          = EXCLUDED.discount_type,
      discount_value         = EXCLUDED.discount_value,
      discount_yearly        = EXCLUDED.discount_yearly,
      applies_to             = EXCLUDED.applies_to,
      valid_from             = EXCLUDED.valid_from,
      valid_until            = EXCLUDED.valid_until,
      max_uses               = EXCLUDED.max_uses,
      requires_active_member = EXCLUDED.requires_active_member,
      requires_new_user      = EXCLUDED.requires_new_user,
      requires_existing_user = EXCLUDED.requires_existing_user,
      active                 = EXCLUDED.active,
      is_public              = EXCLUDED.is_public;
      -- NOTE: used_count เจตนาไม่อยู่ใน SET → รันซ้ำไม่รีเซ็ตยอดที่ใช้ไปแล้ว

-- ── Verify after running ────────────────────────────────────────────────────
--   SELECT code, applies_to, discount_type, discount_value, max_uses, used_count,
--          requires_active_member, requires_new_user, requires_existing_user,
--          valid_from, valid_until, active, is_public
--     FROM public.promo_codes WHERE code = 'SECRETMIND2026';
--   -- expect: monthly · free · 0 · max_uses=1 · used_count=0 · ทุก gate = f ·
--   --         2026-07-30 17:00+00 → 2026-08-31 16:59:59+00 · active=t · is_public=f
--
--   SELECT * FROM public.list_public_promos();
--   -- expect: ไม่เห็น SECRETMIND2026 (โค้ดลับ)
--
--   -- รายเดือน (สมัครใหม่หรือลูกค้าเดิมก็ได้):
--   SELECT * FROM public.preview_promo('SECRETMIND2026','monthly','anyone@x.com');
--   -- expect: valid=t, final 0, slip=false
--   -- แพ็กรายปี:
--   SELECT * FROM public.preview_promo('SECRETMIND2026','yearly','anyone@x.com');
--   -- expect: valid=f, reason wrong_plan
-- ============================================================================
