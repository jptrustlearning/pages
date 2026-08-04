-- ============================================================================
-- JP Trust Learning — promo_codes v12
-- NEW PROMO: JPTAUGUST30 — August 2026 launch/renewal offer
--
--   • ลด 30% เฉพาะแพ็กรายปี (yearly-only → monthly คืน 'wrong_plan')
--   • ใช้ได้ทั้ง "สมัครใหม่" และ "ต่ออายุ" — ไม่มี eligibility gate
--     (requires_active_member / requires_new_user / requires_existing_user = FALSE)
--     → ใครก็ใช้ได้: อีเมลใหม่ก็ได้ / ลูกค้าเดิมต่ออายุก็ได้
--   • จำกัด 30 สิทธิ์ (max_uses = 30) — นับ "ต่อการใช้ 1 ครั้ง" ไม่ใช่ต่อ email
--     สิทธิ์นี้แชร์รวมกันระหว่างคนสมัครใหม่ + คนต่ออายุ
--   • ช่วงเวลา: 1 ส.ค. 2569 00:00 → 31 ส.ค. 2569 23:59:59 (Asia/Bangkok, UTC+7)
--        1 Aug 00:00 BKK      = 2026-07-31T17:00:00Z
--       31 Aug 23:59:59 BKK   = 2026-08-31T16:59:59Z
--     ⚠️ valid_from อยู่ในอดีตแล้ว (วันนี้ 4 ส.ค.) → โปรมีผลทันทีที่รัน INSERT
--   • is_public = TRUE → โชว์อัตโนมัติทั้งใน signup popup และ dashboard renew hint
--     (list_public_promos จาก v9 อ่าน DB ตรง — ไม่ต้องแก้โค้ด/ไม่ต้อง deploy)
--
-- ยอดหลังลด (แพ็กรายปี ฿1,400): round(1400 × 0.7) = ฿980  (ยังต้องแนบสลิป)
--
-- หมายเหตุ: JPTJULY30 หมดอายุไปเองแล้ว (31 ก.ค. 16:59:59Z) — list_public_promos
-- กรองตามช่วงวันอยู่แล้ว จึงไม่ต้อง deactivate ด้วยมือ
--
-- Run once in Supabase Dashboard → SQL Editor. Idempotent — safe to re-run
-- (ON CONFLICT ไม่แตะ used_count → รันซ้ำไม่ล้างยอดที่ใช้ไปแล้ว).
-- Run AFTER promo_codes.sql (v1) … promo_codes_v11.sql.
-- ============================================================================

INSERT INTO public.promo_codes
  (code, description, discount_type, discount_value, discount_yearly,
   applies_to, valid_from, valid_until, max_uses,
   requires_active_member, requires_new_user, requires_existing_user,
   active, is_public)
VALUES
  ('JPTAUGUST30',
   'โปรเดือน ส.ค. · ลด 30% เฉพาะแพ็กรายปี · สมัครใหม่และต่ออายุ · 30 สิทธิ์ · ถึง 31 ส.ค. 2569',
   'percent', 30, NULL,
   'yearly', '2026-07-31T17:00:00Z', '2026-08-31T16:59:59Z', 30,
   FALSE, FALSE, FALSE,
   TRUE, TRUE)
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
--     FROM public.promo_codes WHERE code = 'JPTAUGUST30';
--   -- expect: yearly · percent · 30 · max_uses=30 · used_count=0 · ทุก gate = f ·
--   --         2026-07-31 17:00+00 → 2026-08-31 16:59:59+00 · active=t · is_public=t
--
--   SELECT * FROM public.list_public_promos();
--   -- expect: เห็น JPTAUGUST30 (seats_left=30) โผล่ในลิสต์สาธารณะ
--   --         และ "ไม่" เห็น JPTJULY30 อีกแล้ว (หมดช่วงวัน)
--
--   -- สมัครใหม่ (อีเมลที่ยังไม่เคยมี):
--   SELECT * FROM public.preview_promo('JPTAUGUST30','yearly','brandnew@x.com');
--   -- expect: valid=t, final 980, slip=true
--   -- ต่ออายุ (อีเมลลูกค้าเดิมจริง):
--   SELECT * FROM public.preview_promo('JPTAUGUST30','yearly','existing@x.com');
--   -- expect: valid=t, final 980, slip=true   ← ไม่มี gate จึงผ่านทั้งคู่
--   -- แพ็กรายเดือน:
--   SELECT * FROM public.preview_promo('JPTAUGUST30','monthly','anyone@x.com');
--   -- expect: valid=f, reason wrong_plan
-- ============================================================================
