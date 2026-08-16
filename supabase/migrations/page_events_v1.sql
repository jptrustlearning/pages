-- ============================================================================
-- page_events_v1.sql  —  Analytics สำหรับหน้าสาธารณะ (เริ่มที่ jptrust-toolkit)
-- รันใน Supabase SQL Editor ครั้งเดียว
--
-- แนวคิด: หน้าสาธารณะไม่มี auth.uid() → ใช้ user_events (A6) ไม่ได้
--         จึงแยกตารางใหม่ + เขียนผ่าน RPC (SECURITY DEFINER) เท่านั้น
--         anon เขียนตารางตรงไม่ได้ / อ่านไม่ได้ — อ่านได้เฉพาะอีเมลแอดมิน
-- ============================================================================

-- ---------- 1) ตาราง ----------
CREATE TABLE IF NOT EXISTS public.page_events (
  id             BIGSERIAL PRIMARY KEY,
  page           TEXT        NOT NULL,           -- 'jptrust-toolkit'
  visitor_id     UUID        NOT NULL,           -- localStorage (first-party, ไม่ผูกตัวตน)
  session_id     UUID        NOT NULL,           -- sessionStorage (ตายเมื่อปิดแท็บ)
  event_type     TEXT        NOT NULL,           -- page_view | tool_open | link_click | scroll_50 | session_end
  detail         TEXT,                           -- ชื่อ tool / href ปลายทาง
  referrer_host  TEXT,                           -- l.facebook.com, lin.ee, direct
  utm_source     TEXT,                           -- ?utm_source=line ฯลฯ
  device         TEXT,                           -- mobile | tablet | desktop
  dwell_sec      INT,                            -- เฉพาะ session_end (เวลาที่แท็บ visible จริง)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_page_events_page_time ON public.page_events(page, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_events_session   ON public.page_events(session_id);
CREATE INDEX IF NOT EXISTS idx_page_events_visitor   ON public.page_events(visitor_id);

-- ---------- 2) RLS: ปิดตายสำหรับ anon ----------
ALTER TABLE public.page_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.page_events FROM anon, authenticated;

-- อ่านได้เฉพาะแอดมิน (ล็อกอินด้วยอีเมลนี้เท่านั้น)
DROP POLICY IF EXISTS "admin reads page_events" ON public.page_events;
CREATE POLICY "admin reads page_events" ON public.page_events
  FOR SELECT TO authenticated
  USING ( lower(auth.jwt() ->> 'email') = 'jptrustlearning@gmail.com' );

GRANT SELECT ON public.page_events TO authenticated;

-- ---------- 3) RPC เขียน (ทางเดียวที่ anon เขียนได้) ----------
CREATE OR REPLACE FUNCTION public.track_page_event(
  p_page          TEXT,
  p_visitor       UUID,
  p_session       UUID,
  p_type          TEXT,
  p_detail        TEXT DEFAULT NULL,
  p_referrer_host TEXT DEFAULT NULL,
  p_utm_source    TEXT DEFAULT NULL,
  p_device        TEXT DEFAULT NULL,
  p_dwell_sec     INT  DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recent INT;
BEGIN
  -- whitelist หน้า + ชนิด event (กันยิงมั่ว)
  IF p_page NOT IN ('jptrust-toolkit') THEN RETURN; END IF;
  IF p_type NOT IN ('page_view','tool_open','link_click','scroll_50','session_end') THEN RETURN; END IF;

  -- rate guard: 1 session ยิงได้ไม่เกิน 120 event/ชั่วโมง
  SELECT COUNT(*) INTO v_recent
    FROM public.page_events
   WHERE session_id = p_session
     AND created_at > NOW() - INTERVAL '1 hour';
  IF v_recent >= 120 THEN RETURN; END IF;

  INSERT INTO public.page_events(
    page, visitor_id, session_id, event_type, detail,
    referrer_host, utm_source, device, dwell_sec
  ) VALUES (
    p_page, p_visitor, p_session, p_type, LEFT(p_detail, 160),
    LEFT(p_referrer_host, 120), LEFT(p_utm_source, 60),
    NULLIF(LEFT(p_device, 12), ''),
    LEAST(GREATEST(COALESCE(p_dwell_sec, 0), 0), 7200)
  );
END $$;

REVOKE ALL ON FUNCTION public.track_page_event(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_page_event(TEXT,UUID,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,INT) TO anon, authenticated;

-- ---------- 4) เช็คว่าติดตั้งสำเร็จ ----------
-- SELECT public.track_page_event('jptrust-toolkit', gen_random_uuid(), gen_random_uuid(), 'page_view', NULL, 'test', 'test', 'desktop', NULL);
-- SELECT * FROM public.page_events ORDER BY id DESC LIMIT 5;
