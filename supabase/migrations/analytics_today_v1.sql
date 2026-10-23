-- ============================================================================
-- analytics_today_v1.sql — เพิ่มช่วง "วันนี้" ให้หน้า admin-analytics.html
-- รันใน Supabase SQL Editor ครั้งเดียว (ทับของเดิมได้ ไม่แตะข้อมูล ไม่ลบอะไร)
--
-- เปลี่ยนจาก page_events_v2.sql อย่างเดียว:
--   p_days = 0  → นับตั้งแต่ 00:00 น. เวลาไทย (Asia/Bangkok) ของวันนี้
--   p_days อื่น → เหมือนเดิมทุกตัว (NOW() - p_days วัน · ขั้นต่ำ 1 · สูงสุด 3650)
--   ก่อนรันไฟล์นี้ ปุ่ม "วันนี้" ส่ง 0 ไป ฟังก์ชันเดิมปัดเป็น 1 = ย้อนหลัง 24 ชม.
--
-- ฟังก์ชัน 8 ตัวข้างล่าง คัดลอกจาก page_events_v2.sql ข้อ 6 ทั้งก้อน
-- แก้เฉพาะบรรทัด v_from := ... ให้เรียก _analytics_from() แทน
-- ย้อนกลับ: รันข้อ 6 ของ page_events_v2.sql ซ้ำ (ฟังก์ชันเดิมกลับมาครบ)
-- ============================================================================


-- ---------- 1) ตัวคำนวณจุดเริ่มของช่วง ----------
CREATE OR REPLACE FUNCTION public._analytics_from(p_days INT)
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_days = 0
      THEN date_trunc('day', NOW() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok'
    ELSE NOW() - (GREATEST(LEAST(p_days, 3650), 1) || ' days')::INTERVAL
  END;
$$;
REVOKE ALL ON FUNCTION public._analytics_from(INT) FROM PUBLIC;


-- ---------- 2) RPC ฝั่งอ่าน (เหมือน v2 ข้อ 6 ยกเว้นบรรทัด v_from) ----------

-- 6.1 ภาพรวม
CREATE OR REPLACE FUNCTION public.analytics_overview(p_token TEXT, p_days INT DEFAULT 30)
RETURNS TABLE(visitors BIGINT, sessions BIGINT, views BIGINT, clicks BIGINT,
              downloads BIGINT, avg_dwell NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from TIMESTAMPTZ;
BEGIN
  IF NOT public._analytics_ok(p_token) THEN RETURN; END IF;
  v_from := public._analytics_from(p_days);

  RETURN QUERY
  WITH e AS (SELECT * FROM public.page_events WHERE created_at >= v_from),
       d AS (SELECT session_id, page, MAX(dwell_sec) mx FROM e
              WHERE event_type = 'session_end' AND dwell_sec > 0
              GROUP BY session_id, page)
  SELECT (SELECT COUNT(DISTINCT visitor_id) FROM e),
         (SELECT COUNT(DISTINCT session_id) FROM e),
         (SELECT COUNT(*) FROM e WHERE event_type = 'page_view'),
         (SELECT COUNT(*) FROM e WHERE event_type = 'click'),
         (SELECT COUNT(*) FROM e WHERE event_type = 'download'),
         (SELECT ROUND(AVG(mx)::NUMERIC, 1) FROM d);
END $$;

-- 6.2 แยกรายหน้า
CREATE OR REPLACE FUNCTION public.analytics_by_page(p_token TEXT, p_days INT DEFAULT 30)
RETURNS TABLE(page TEXT, label TEXT, views BIGINT, visitors BIGINT,
              clicks BIGINT, avg_dwell NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from TIMESTAMPTZ;
BEGIN
  IF NOT public._analytics_ok(p_token) THEN RETURN; END IF;
  v_from := public._analytics_from(p_days);

  RETURN QUERY
  WITH e AS (SELECT * FROM public.page_events WHERE created_at >= v_from),
       d AS (SELECT ev.page AS pg, ev.session_id, MAX(ev.dwell_sec) mx FROM e ev
              WHERE ev.event_type = 'session_end' AND ev.dwell_sec > 0
              GROUP BY ev.page, ev.session_id)
  SELECT e.page::TEXT,
         COALESCE(p.label, e.page)::TEXT,
         COUNT(*) FILTER (WHERE e.event_type = 'page_view'),
         COUNT(DISTINCT e.visitor_id),
         COUNT(*) FILTER (WHERE e.event_type = 'click'),
         (SELECT ROUND(AVG(d.mx)::NUMERIC, 1) FROM d WHERE d.pg = e.page)
    FROM e LEFT JOIN public.page_events_pages p ON p.page = e.page
   GROUP BY e.page, p.label
   ORDER BY 3 DESC;
END $$;

-- 6.3 รายวัน
CREATE OR REPLACE FUNCTION public.analytics_daily(p_token TEXT, p_days INT DEFAULT 30)
RETURNS TABLE(d DATE, views BIGINT, visitors BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from TIMESTAMPTZ;
BEGIN
  IF NOT public._analytics_ok(p_token) THEN RETURN; END IF;
  v_from := public._analytics_from(p_days);

  RETURN QUERY
  SELECT (created_at AT TIME ZONE 'Asia/Bangkok')::DATE,
         COUNT(*) FILTER (WHERE event_type = 'page_view'),
         COUNT(DISTINCT visitor_id)
    FROM public.page_events
   WHERE created_at >= v_from
   GROUP BY 1 ORDER BY 1;
END $$;

-- 6.4 คลิกยอดนิยม (p_page = NULL คือทุกหน้า)
CREATE OR REPLACE FUNCTION public.analytics_top_clicks(
  p_token TEXT, p_days INT DEFAULT 30, p_page TEXT DEFAULT NULL, p_limit INT DEFAULT 30)
RETURNS TABLE(page TEXT, detail TEXT, n BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from TIMESTAMPTZ;
BEGIN
  IF NOT public._analytics_ok(p_token) THEN RETURN; END IF;
  v_from := public._analytics_from(p_days);

  RETURN QUERY
  SELECT e.page::TEXT, e.detail::TEXT, COUNT(*)
    FROM public.page_events e
   WHERE e.created_at >= v_from
     AND e.event_type IN ('click','download','tool_open','link_click')
     AND e.detail IS NOT NULL
     AND (p_page IS NULL OR e.page = p_page)
   GROUP BY e.page, e.detail
   ORDER BY 3 DESC
   LIMIT GREATEST(LEAST(p_limit, 200), 1);
END $$;

-- 6.5 ที่มา + อุปกรณ์
CREATE OR REPLACE FUNCTION public.analytics_sources(p_token TEXT, p_days INT DEFAULT 30)
RETURNS TABLE(kind TEXT, name TEXT, n BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from TIMESTAMPTZ;
BEGIN
  IF NOT public._analytics_ok(p_token) THEN RETURN; END IF;
  v_from := public._analytics_from(p_days);

  RETURN QUERY
  WITH s AS (SELECT DISTINCT ON (session_id) session_id, referrer_host, utm_source, device
               FROM public.page_events
              WHERE created_at >= v_from
              ORDER BY session_id, created_at)
  SELECT 'referrer'::TEXT, COALESCE(referrer_host,'direct')::TEXT, COUNT(*) FROM s GROUP BY 2
  UNION ALL
  SELECT 'device'::TEXT,   COALESCE(device,'unknown')::TEXT,       COUNT(*) FROM s GROUP BY 2
  UNION ALL
  SELECT 'utm'::TEXT,      utm_source::TEXT,                       COUNT(*) FROM s
   WHERE utm_source IS NOT NULL GROUP BY 2
   ORDER BY 1, 3 DESC;
END $$;

-- ---------- 6.6 ฝั่งสมาชิกในแอพ (ตาราง user_events จาก A6) ----------
-- user_events มี RLS "อ่านได้เฉพาะแถวตัวเอง" → แอดมินอ่านภาพรวมไม่ได้
-- ฟังก์ชันพวกนี้เป็น SECURITY DEFINER จึงข้าม RLS ได้ แต่ล็อกด้วย token เดียวกัน
-- ถ้ายังไม่มีตาราง user_events จะคืนค่าว่างเฉยๆ ไม่ error

CREATE OR REPLACE FUNCTION public.analytics_members_overview(p_token TEXT, p_days INT DEFAULT 30)
RETURNS TABLE(members BIGINT, app_opens BIGINT, screen_views BIGINT,
              tool_opens BIGINT, events BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_from TIMESTAMPTZ;
BEGIN
  IF NOT public._analytics_ok(p_token) THEN RETURN; END IF;
  IF to_regclass('public.user_events') IS NULL THEN RETURN; END IF;
  v_from := public._analytics_from(p_days);

  RETURN QUERY
  WITH e AS (SELECT * FROM public.user_events WHERE created_at >= v_from)
  SELECT (SELECT COUNT(DISTINCT user_id) FROM e),
         (SELECT COUNT(*) FROM e WHERE event_type = 'app_open'),
         (SELECT COUNT(*) FROM e WHERE event_type = 'screen_view'),
         (SELECT COUNT(*) FROM e WHERE event_type = 'page_view'),
         (SELECT COUNT(*) FROM e);
END $fn$;

CREATE OR REPLACE FUNCTION public.analytics_members_daily(p_token TEXT, p_days INT DEFAULT 30)
RETURNS TABLE(d DATE, opens BIGINT, members BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_from TIMESTAMPTZ;
BEGIN
  IF NOT public._analytics_ok(p_token) THEN RETURN; END IF;
  IF to_regclass('public.user_events') IS NULL THEN RETURN; END IF;
  v_from := public._analytics_from(p_days);

  RETURN QUERY
  SELECT (created_at AT TIME ZONE 'Asia/Bangkok')::DATE,
         COUNT(*) FILTER (WHERE event_type = 'app_open'),
         COUNT(DISTINCT user_id)
    FROM public.user_events
   WHERE created_at >= v_from
   GROUP BY 1 ORDER BY 1;
END $fn$;

-- kind = 'screen' แท็บล่าง | 'tool' หน้าที่เปิดใน iframe | 'event' เหตุการณ์อื่น
-- median_sec = เวลาที่อยู่หน้านั้นโดยประมาณ = มัธยฐานของช่วงห่างถึง event ถัดไป
--              ของ user คนเดียวกัน · ตัดช่วงห่าง > 15 นาทีทิ้ง (ถือว่าวางเครื่องไป)
--              user_events ไม่มี dwell จริง นี่เป็นค่าประมาณ ไม่ใช่ค่าวัด
CREATE OR REPLACE FUNCTION public.analytics_members_breakdown(p_token TEXT, p_days INT DEFAULT 30)
RETURNS TABLE(kind TEXT, name TEXT, n BIGINT, members BIGINT, median_sec NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_from TIMESTAMPTZ;
BEGIN
  IF NOT public._analytics_ok(p_token) THEN RETURN; END IF;
  IF to_regclass('public.user_events') IS NULL THEN RETURN; END IF;
  v_from := public._analytics_from(p_days);

  RETURN QUERY
  WITH e AS (
    SELECT user_id, event_type, screen, url, created_at,
           LEAD(created_at) OVER (PARTITION BY user_id ORDER BY created_at) AS nxt
      FROM public.user_events
     WHERE created_at >= v_from
  ),
  g AS (
    SELECT *,
           CASE WHEN nxt IS NOT NULL
                 AND EXTRACT(EPOCH FROM (nxt - created_at)) <= 900
                THEN EXTRACT(EPOCH FROM (nxt - created_at)) END AS gap
      FROM e
  )
  SELECT 'screen'::TEXT, COALESCE(screen,'(ไม่ระบุ)')::TEXT, COUNT(*),
         COUNT(DISTINCT user_id),
         ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap)::NUMERIC, 0)
    FROM g WHERE event_type = 'screen_view' GROUP BY 2
  UNION ALL
  SELECT 'tool'::TEXT,
         -- ตัด cache-bust ?v=/&v= ออกก่อนจัดกลุ่ม ไม่งั้นหน้าเดียวกันแตกเป็นหลายแถวทุกครั้งที่ deploy
         -- (member-dashboard ตัดได้เฉพาะตอน v เป็นพารามิเตอร์ตัวแรก)
         regexp_replace(
           regexp_replace(
             regexp_replace(COALESCE(url,'(ไม่ระบุ)'), '([?&])v=\d+&', '\1', 'g'),
           '[?&]v=\d+$', '', 'g'),
         '^\.?/', '')::TEXT, COUNT(*),
         COUNT(DISTINCT user_id),
         ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap)::NUMERIC, 0)
    FROM g WHERE event_type = 'page_view' GROUP BY 2
  UNION ALL
  SELECT 'event'::TEXT, event_type::TEXT, COUNT(*), COUNT(DISTINCT user_id), NULL::NUMERIC
    FROM g WHERE event_type NOT IN ('screen_view','page_view') GROUP BY 2
   ORDER BY 1, 3 DESC;
END $fn$;


DO $$
DECLARE f TEXT;
BEGIN
  FOR f IN SELECT unnest(ARRAY[
    'analytics_overview(TEXT,INT)','analytics_by_page(TEXT,INT)','analytics_daily(TEXT,INT)',
    'analytics_top_clicks(TEXT,INT,TEXT,INT)','analytics_sources(TEXT,INT)',
    'analytics_members_overview(TEXT,INT)','analytics_members_daily(TEXT,INT)',
    'analytics_members_breakdown(TEXT,INT)'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon, authenticated', f);
  END LOOP;
END $$;


-- ---------- 3) เช็คหลังรัน ----------
-- จุดเริ่มของ "วันนี้" ต้องเป็น 00:00 เวลาไทย (แสดงเป็น UTC = 17:00 ของเมื่อวาน):
--   SELECT public._analytics_from(0) AS วันนี้_เริ่ม,
--          public._analytics_from(7) AS เจ็ดวัน_เริ่ม;
-- ทดสอบอ่าน:
--   SELECT * FROM public.analytics_overview('รหัสแอดมิน', 0);
