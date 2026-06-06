-- ============================================================================
-- restore_started_at_overwrite_all.sql  (6 มิ.ย. 2569)
--
-- กู้ "วันสมัครครั้งแรกจริง" ของสมาชิกทุกคน
--
-- ปัญหา: webhook เวอร์ชันก่อนหน้าเขียนทับ subscription_started_at ด้วยวันที่
--   renew ทุกครั้ง → สมาชิกที่เคยต่ออายุ "วันที่สมัคร" กลายเป็นวัน renew ล่าสุด
-- ความจริงเดียวที่เชื่อได้ของวันสมัครแรก = auth.users.created_at
--   (webhook สร้าง user ตอนสมัครครั้งแรกพอดี)
--
-- ต่างจาก backfill_started_at_from_created.sql (เติมเฉพาะคนที่ว่าง):
--   ตัวนี้ "เขียนทับทุกคน" ที่ค่าไม่ตรงกับ created_at — รวมคนที่โดนวัน renew ทับ
--
-- ⚠️⚠️ ลำดับสำคัญมาก ⚠️⚠️
--   ต้องรัน **หลัง** deploy signup-webhook เวอร์ชันใหม่ (index v17 fix,
--   commit แยก started_at/renewed_at) แล้วเท่านั้น
--   ถ้ารันก่อน deploy → การ renew ครั้งถัดไปจะทับวันสมัครอีกรอบ
--
-- ไม่แตะ: subscription_renewed_at (ปล่อย null สำหรับข้อมูลเก่า — ไม่มีทางรู้
--   ย้อนหลังว่าใคร renew เมื่อไหร่ จะเริ่มบันทึกจาก renew ครั้งถัดไปเป็นต้นไป)
--
-- วิธีใช้: รันทีละ STEP ใน Supabase SQL Editor
-- ============================================================================


-- ============================================================================
-- STEP 1 — DRY RUN: ดูก่อนว่าใครจะถูกแก้ และจะเปลี่ยนจากอะไรเป็นอะไร
-- (เฉพาะคนที่ค่าปัจจุบันไม่ตรงกับ created_at — คนที่ถูกอยู่แล้วไม่โดนแตะ)
-- ============================================================================
SELECT email,
       raw_app_meta_data->>'subscription_started_at'                            AS current_started,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')  AS will_set_to,
       raw_app_meta_data->>'subscription_expires_at'                            AS expires_at_unchanged
FROM auth.users
WHERE COALESCE(NULLIF(raw_app_meta_data->>'subscription_started_at',''), '')
      IS DISTINCT FROM
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
ORDER BY created_at;


-- ============================================================================
-- STEP 2 — APPLY: เขียนทับ subscription_started_at = created_at
-- (idempotent — รันซ้ำได้ รอบสองจะ 0 rows เพราะค่าตรงแล้ว)
-- ============================================================================
UPDATE auth.users
   SET raw_app_meta_data =
         raw_app_meta_data
         || jsonb_build_object(
              'subscription_started_at',
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            )
 WHERE COALESCE(NULLIF(raw_app_meta_data->>'subscription_started_at',''), '')
       IS DISTINCT FROM
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');


-- ============================================================================
-- STEP 3 — VERIFY: ทุกคนต้องตรงกับ created_at แล้ว (ผลลัพธ์ต้องเป็น 0 แถว)
-- ============================================================================
SELECT email,
       raw_app_meta_data->>'subscription_started_at'                            AS started_at,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')  AS expected
FROM auth.users
WHERE COALESCE(NULLIF(raw_app_meta_data->>'subscription_started_at',''), '')
      IS DISTINCT FROM
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

-- ตรวจภาพรวมเพิ่ม (optional): วันสมัคร vs วันหมดอายุของทุกคน
SELECT email,
       raw_app_meta_data->>'subscription_started_at' AS started_at,
       raw_app_meta_data->>'subscription_renewed_at' AS renewed_at,
       raw_app_meta_data->>'subscription_expires_at' AS expires_at
FROM auth.users
ORDER BY created_at;
