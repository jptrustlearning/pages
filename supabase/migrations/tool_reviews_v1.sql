-- ============================================================================
-- tool_reviews_v1.sql — คะแนนดาวของของแจกฟรีใน Tool & Kit (A257 · 22 ต.ค. 2026)
-- รันใน Supabase SQL Editor ครั้งเดียว (รันซ้ำได้ ไม่ลบข้อมูล)
--
-- หน้า jptrust-toolkit.html ส่งคะแนนผ่าน RPC submit_tool_review (anon key)
--   · ไม่เก็บชื่อ/อีเมล — visitor_id = UUID สุ่มในเครื่อง (ตัวเดียวกับ jpt-track.js)
--   · 1 เครื่องให้ได้ 1 คะแนนต่อของ 1 เวอร์ชัน (ส่งซ้ำ = แก้คะแนนเดิม)
--   · ก่อนรันไฟล์นี้ หน้าเว็บเก็บคะแนนรอไว้ในเครื่องลูกค้า แล้วส่งใหม่ตอนเปิดหน้าครั้งถัดไป
-- ดูคะแนน: หน้า toolkit-analytics.html (ล็อกอินอีเมลแอดมิน) หรือคำสั่งท้ายไฟล์ ข้อ 5
-- ============================================================================


-- ---------- 1) รายชื่อของที่เปิดให้รีวิว (ของชิ้นใหม่ = INSERT บรรทัดเดียว) ----------
CREATE TABLE IF NOT EXISTS public.tool_review_items (
  item       TEXT PRIMARY KEY,
  label      TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.tool_review_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tool_review_items FROM anon, authenticated;

INSERT INTO public.tool_review_items(item, label) VALUES
  ('OWLET BOT', 'OWLET BOT · บอทเทรดฟรี MT5')
ON CONFLICT (item) DO UPDATE SET label = EXCLUDED.label, active = TRUE;


-- ---------- 2) ตารางคะแนน ----------
CREATE TABLE IF NOT EXISTS public.tool_reviews (
  id          BIGSERIAL PRIMARY KEY,
  item        TEXT        NOT NULL,
  version     TEXT        NOT NULL,
  visitor_id  UUID        NOT NULL,
  stars       SMALLINT    NOT NULL CHECK (stars BETWEEN 1 AND 5),
  note        TEXT        CHECK (note IS NULL OR char_length(note) <= 300),
  device      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item, version, visitor_id)
);
CREATE INDEX IF NOT EXISTS idx_tool_reviews_item_time ON public.tool_reviews(item, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_reviews_visitor   ON public.tool_reviews(visitor_id, updated_at DESC);

ALTER TABLE public.tool_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tool_reviews FROM anon, authenticated;

-- อ่านได้เฉพาะอีเมลแอดมิน (แบบเดียวกับ page_events) → หน้า toolkit-analytics.html
DROP POLICY IF EXISTS "admin reads tool_reviews" ON public.tool_reviews;
CREATE POLICY "admin reads tool_reviews" ON public.tool_reviews
  FOR SELECT TO authenticated
  USING ( lower(auth.jwt() ->> 'email') = 'jptrustlearning@gmail.com' );
GRANT SELECT ON public.tool_reviews TO authenticated;


-- ---------- 3) RPC เขียน (หน้าเว็บเรียกด้วย anon key) ----------
-- คืน TRUE = บันทึกแล้ว · FALSE = ปัดตก (ของไม่อยู่ในรายชื่อ / ค่าผิด / ยิงถี่เกิน)
CREATE OR REPLACE FUNCTION public.submit_tool_review(
  p_item    TEXT,
  p_version TEXT,
  p_visitor UUID,
  p_stars   INT,
  p_note    TEXT DEFAULT NULL,
  p_device  TEXT DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent INT;
  v_all    INT;
BEGIN
  IF p_visitor IS NULL OR p_stars IS NULL OR p_stars < 1 OR p_stars > 5 THEN RETURN FALSE; END IF;
  IF p_version IS NULL OR p_version !~ '^[0-9A-Za-z._-]{1,20}$' THEN RETURN FALSE; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tool_review_items WHERE item = p_item AND active) THEN RETURN FALSE; END IF;

  -- กันยิงถี่: เครื่องเดียวไม่เกิน 10 ครั้ง/ชม. · ทั้งระบบไม่เกิน 300 ครั้ง/ชม.
  SELECT COUNT(*) INTO v_recent FROM public.tool_reviews
   WHERE visitor_id = p_visitor AND updated_at > NOW() - INTERVAL '1 hour';
  IF v_recent >= 10 THEN RETURN FALSE; END IF;
  SELECT COUNT(*) INTO v_all FROM public.tool_reviews
   WHERE updated_at > NOW() - INTERVAL '1 hour';
  IF v_all >= 300 THEN RETURN FALSE; END IF;

  INSERT INTO public.tool_reviews(item, version, visitor_id, stars, note, device)
  VALUES (p_item, p_version, p_visitor, p_stars,
          NULLIF(btrim(LEFT(p_note, 300)), ''), NULLIF(LEFT(p_device, 12), ''))
  ON CONFLICT (item, version, visitor_id) DO UPDATE
     SET stars = EXCLUDED.stars, note = EXCLUDED.note, device = EXCLUDED.device, updated_at = NOW();
  RETURN TRUE;
END $$;

REVOKE ALL ON FUNCTION public.submit_tool_review(TEXT,TEXT,UUID,INT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_tool_review(TEXT,TEXT,UUID,INT,TEXT,TEXT) TO anon, authenticated;


-- ---------- 4) ทดสอบหลังรัน (ลบแถวทดสอบได้ตามต้องการ) ----------
--   SELECT public.submit_tool_review('OWLET BOT', '1.12', gen_random_uuid(), 5, 'ทดสอบ', 'desktop');   -- ต้องได้ true
--   SELECT public.submit_tool_review('ไม่มีชิ้นนี้', '1.0', gen_random_uuid(), 5, NULL, NULL);          -- ต้องได้ false


-- ---------- 5) ดูคะแนน ----------
-- สรุปรายชิ้น/รายเวอร์ชัน:
--   SELECT item, version, COUNT(*) AS รีวิว, ROUND(AVG(stars)::NUMERIC, 2) AS ดาวเฉลี่ย,
--          COUNT(*) FILTER (WHERE stars = 5) AS ห้าดาว, COUNT(*) FILTER (WHERE stars <= 2) AS สองดาวลงไป
--     FROM public.tool_reviews GROUP BY 1, 2 ORDER BY 1, 2;
-- ความเห็นล่าสุด:
--   SELECT updated_at AT TIME ZONE 'Asia/Bangkok' AS เวลา, item, version, stars, note
--     FROM public.tool_reviews WHERE note IS NOT NULL ORDER BY updated_at DESC LIMIT 50;
