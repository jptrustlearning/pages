-- ============================================================================
-- tool_reviews_v2.sql — สรุปคะแนนดาวแบบเปิดอ่านได้ (A263.7 · 23 ต.ค. 2026)
-- ⚠️ รันหลัง tool_reviews_v1.sql เสมอ (ต้องมีตาราง tool_reviews ก่อน) · รันซ้ำได้ ไม่ลบข้อมูล
--
-- ใช้ทำอะไร
--   1) แดชบอร์ดรายวัน (company/dashboard ใน jptrustdocs) ดึงสรุปคะแนนผ่านเครื่อง GitHub ทุกเช้า
--   2) เตรียมไว้โชว์คะแนนให้ลูกค้าเห็นในอนาคต (หน้าเว็บเรียกด้วย anon key ได้)
-- เปิดเผยแค่ "ตัวเลขรวม" (จำนวน · ดาวเฉลี่ย · จำนวนแต่ละดาว) + ความเห็นที่จูนกดอนุญาตแล้วเท่านั้น
--   ความเห็นทั้งหมด / เครื่อง / เวลา รายคน ยังอ่านได้เฉพาะแอดมิน (นโยบายเดิมของ v1)
-- ============================================================================


-- ---------- 1) ช่องอนุญาตให้โชว์ความเห็นต่อสาธารณะ (ค่าเริ่ม = ไม่โชว์) ----------
ALTER TABLE public.tool_reviews ADD COLUMN IF NOT EXISTS show_public BOOLEAN NOT NULL DEFAULT FALSE;


-- ---------- 2) RPC สรุปคะแนน (anon เรียกได้) ----------
-- คืน JSON array รายชิ้น (เฉพาะชิ้นที่ active):
--   item · label · n (รีวิวทั้งหมด) · avg (ดาวเฉลี่ย 2 ตำแหน่ง · ไม่มีรีวิว = null)
--   dist [1ดาว,2ดาว,3ดาว,4ดาว,5ดาว] · n_new_24h (รีวิวใหม่ 24 ชม.) · n_notes_24h (มีความเห็น อัพเดทใน 24 ชม.)
--   last_at (รีวิวล่าสุด) · quotes (ความเห็นที่ show_public = true ล่าสุด 6 ข้อ: stars · note · at)
CREATE OR REPLACE FUNCTION public.tool_review_public()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.item), '[]'::jsonb)
  FROM (
    SELECT
      i.item,
      i.label,
      COUNT(r.id)::INT                                                         AS n,
      ROUND(AVG(r.stars)::NUMERIC, 2)                                          AS avg,
      jsonb_build_array(
        COUNT(r.id) FILTER (WHERE r.stars = 1), COUNT(r.id) FILTER (WHERE r.stars = 2),
        COUNT(r.id) FILTER (WHERE r.stars = 3), COUNT(r.id) FILTER (WHERE r.stars = 4),
        COUNT(r.id) FILTER (WHERE r.stars = 5))                                AS dist,
      COUNT(r.id) FILTER (WHERE r.created_at > NOW() - INTERVAL '24 hours')::INT AS n_new_24h,
      COUNT(r.id) FILTER (WHERE r.note IS NOT NULL
                            AND r.updated_at > NOW() - INTERVAL '24 hours')::INT AS n_notes_24h,
      MAX(r.updated_at)                                                        AS last_at,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('stars', q.stars, 'note', q.note, 'at', q.updated_at)
                                 ORDER BY q.updated_at DESC), '[]'::jsonb)
         FROM (SELECT stars, note, updated_at FROM public.tool_reviews q0
                WHERE q0.item = i.item AND q0.show_public AND q0.note IS NOT NULL
                ORDER BY q0.updated_at DESC LIMIT 6) q)                        AS quotes
    FROM public.tool_review_items i
    LEFT JOIN public.tool_reviews r ON r.item = i.item
    WHERE i.active
    GROUP BY i.item, i.label
  ) t;
$$;

REVOKE ALL ON FUNCTION public.tool_review_public() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tool_review_public() TO anon, authenticated;


-- ---------- 3) ทดสอบหลังรัน ----------
--   SELECT public.tool_review_public();     -- ยังไม่มีรีวิว = [{"item":"OWLET BOT","n":0,"avg":null,...}]


-- ---------- 4) อนุญาตให้โชว์ความเห็นต่อสาธารณะ (จูนเลือกเองทีละข้อ) ----------
--   ดูความเห็นที่ยังไม่อนุญาต:
--   SELECT id, updated_at AT TIME ZONE 'Asia/Bangkok' AS เวลา, stars, note
--     FROM public.tool_reviews WHERE note IS NOT NULL AND NOT show_public ORDER BY updated_at DESC LIMIT 50;
--   อนุญาต:   UPDATE public.tool_reviews SET show_public = TRUE  WHERE id IN (…);
--   ถอนคืน:   UPDATE public.tool_reviews SET show_public = FALSE WHERE id IN (…);
