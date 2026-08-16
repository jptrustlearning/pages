-- ============================================================================
-- page_events_v2.sql — ขยาย analytics ให้ครอบทุกหน้า Tool & Kit + เก็บคลิก
-- รันใน Supabase SQL Editor ครั้งเดียว (ทับของเดิมได้ ไม่ลบข้อมูลเก่า)
--
-- เปลี่ยนจาก v1:
--   1) whitelist หน้า ย้ายจากฮาร์ดโค้ดในฟังก์ชัน → ตาราง page_events_pages
--      (เพิ่มหน้าใหม่ = INSERT บรรทัดเดียว ไม่ต้องแก้ฟังก์ชันอีก)
--   2) เพิ่ม event_type: click, download, scroll_90
--   3) rate guard 120 → 400 event/ชม./session (เพราะเก็บคลิกอัตโนมัติแล้ว)
--   4) เพิ่ม RPC ฝั่งอ่านสำหรับหน้าแอดมิน (ล็อกด้วย token)
--
-- นโยบายเก็บข้อมูล: ไม่ลบ (ตามที่เคาะไว้)
--   ประมาณการ: 1 row ≈ 200 bytes → 1 ล้าน event ≈ 200 MB
--   ดูขนาดจริงได้ที่ท้ายไฟล์ ข้อ 7
-- ============================================================================


-- ---------- 0) ตารางฐาน page_events (ถ้ายังไม่มี — v1 อาจไม่เคยรัน) ----------
CREATE TABLE IF NOT EXISTS public.page_events (
  id             BIGSERIAL PRIMARY KEY,
  page           TEXT        NOT NULL,
  visitor_id     UUID        NOT NULL,
  session_id     UUID        NOT NULL,
  event_type     TEXT        NOT NULL,
  detail         TEXT,
  referrer_host  TEXT,
  utm_source     TEXT,
  device         TEXT,
  dwell_sec      INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_page_events_page_time ON public.page_events(page, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_events_session   ON public.page_events(session_id);
CREATE INDEX IF NOT EXISTS idx_page_events_visitor   ON public.page_events(visitor_id);

ALTER TABLE public.page_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.page_events FROM anon, authenticated;

DROP POLICY IF EXISTS "admin reads page_events" ON public.page_events;
CREATE POLICY "admin reads page_events" ON public.page_events
  FOR SELECT TO authenticated
  USING ( lower(auth.jwt() ->> 'email') = 'jptrustlearning@gmail.com' );

GRANT SELECT ON public.page_events TO authenticated;


-- ---------- 1) ตารางรายชื่อหน้าที่อนุญาต ----------
CREATE TABLE IF NOT EXISTS public.page_events_pages (
  page       TEXT PRIMARY KEY,
  label      TEXT,                                -- ชื่อไทยสำหรับโชว์ในหน้าแอดมิน
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.page_events_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.page_events_pages FROM anon, authenticated;

INSERT INTO public.page_events_pages(page, label) VALUES
  ('jptrust-toolkit',           'หน้าหลัก Tool & Kit'),
  ('ea-oneclick-desk',          'ดาวน์โหลดฟรี · OneClick Desk'),
  ('gold-momentum-app',         'Gold Momentum Dashboard'),
  ('gold-strategy-compare',     'เปรียบเทียบกลยุทธ์ทองคำ'),
  ('gold-golden-cross',         'Golden Cross'),
  ('gold-momentum-6m',          'โมเมนตัม 6 เดือน'),
  ('gold-zone-backtest',        'Zone Trading · Backtest'),
  ('gold-zone-strategy',        'Zone Trading · กติกา'),
  ('gold-buyhold-dca',          'ซื้อครั้งเดียว vs ออมทอง'),
  ('gold-swing-h1-sensitivity', 'H1 Swing · Sensitivity'),
  ('smc-patient-hunter-report', 'SMC Patient Hunter'),
  ('sp500-scanner',             'S&P 500 Scanner'),
  ('sector-rotation',           'Sector Rotation'),
  ('port-recorder',             'Port Recorder'),
  ('my-portfolio',              'My Portfolio'),
  ('portfolio-planner',         'วางแผนพอร์ตการลงทุน'),
  ('finance-planner',           'วางแผนการเงินส่วนบุคคล'),
  ('toolkit-guide',             'คู่มือการใช้งาน'),
  ('roadmap',                   'Roadmap')
ON CONFLICT (page) DO UPDATE SET label = EXCLUDED.label, active = TRUE;


-- ---------- 2) ค่าตั้งค่า (เก็บ token ของหน้าแอดมิน) ----------
CREATE TABLE IF NOT EXISTS public.analytics_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
ALTER TABLE public.analytics_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_config FROM anon, authenticated;

-- 🔴 ต้องเปลี่ยนค่านี้เป็นรหัสจริงก่อนใช้งาน (ใช้ตัวเดียวกับหน้า admin.html ได้)
INSERT INTO public.analytics_config(key, value)
VALUES ('admin_token', 'CHANGE_ME_ตั้งรหัสยาวๆ')
ON CONFLICT (key) DO NOTHING;


-- ---------- 3) index เพิ่มสำหรับหน้าแอดมิน ----------
CREATE INDEX IF NOT EXISTS idx_page_events_time      ON public.page_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_events_type_time ON public.page_events(event_type, created_at DESC);


-- ---------- 4) RPC เขียน (แทนของเดิม) ----------
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
  -- หน้าอยู่ใน whitelist และเปิดใช้งานอยู่
  IF NOT EXISTS (
    SELECT 1 FROM public.page_events_pages WHERE page = p_page AND active
  ) THEN RETURN; END IF;

  IF p_type NOT IN (
    'page_view','click','download','tool_open','link_click',
    'scroll_50','scroll_90','session_end'
  ) THEN RETURN; END IF;

  -- rate guard: 1 session ยิงได้ไม่เกิน 400 event/ชั่วโมง
  SELECT COUNT(*) INTO v_recent
    FROM public.page_events
   WHERE session_id = p_session
     AND created_at > NOW() - INTERVAL '1 hour';
  IF v_recent >= 400 THEN RETURN; END IF;

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


-- ---------- 5) ฝั่งอ่าน: ตรวจรหัสแอดมิน ----------
CREATE OR REPLACE FUNCTION public._analytics_ok(p_token TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT value FROM public.analytics_config WHERE key = 'admin_token') = p_token
    AND COALESCE(LENGTH(p_token), 0) >= 8
  , FALSE);
$$;
REVOKE ALL ON FUNCTION public._analytics_ok(TEXT) FROM PUBLIC;


-- ---------- 6) RPC ฝั่งอ่านสำหรับหน้าแอดมิน ----------

-- 6.1 ภาพรวม
CREATE OR REPLACE FUNCTION public.analytics_overview(p_token TEXT, p_days INT DEFAULT 30)
RETURNS TABLE(visitors BIGINT, sessions BIGINT, views BIGINT, clicks BIGINT,
              downloads BIGINT, avg_dwell NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from TIMESTAMPTZ;
BEGIN
  IF NOT public._analytics_ok(p_token) THEN RETURN; END IF;
  v_from := NOW() - (GREATEST(LEAST(p_days, 3650), 1) || ' days')::INTERVAL;

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
  v_from := NOW() - (GREATEST(LEAST(p_days, 3650), 1) || ' days')::INTERVAL;

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
  v_from := NOW() - (GREATEST(LEAST(p_days, 3650), 1) || ' days')::INTERVAL;

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
  v_from := NOW() - (GREATEST(LEAST(p_days, 3650), 1) || ' days')::INTERVAL;

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
  v_from := NOW() - (GREATEST(LEAST(p_days, 3650), 1) || ' days')::INTERVAL;

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
  v_from := NOW() - (GREATEST(LEAST(p_days, 3650), 1) || ' days')::INTERVAL;

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
  v_from := NOW() - (GREATEST(LEAST(p_days, 3650), 1) || ' days')::INTERVAL;

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
  v_from := NOW() - (GREATEST(LEAST(p_days, 3650), 1) || ' days')::INTERVAL;

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


-- ---------- 7) เช็คหลังติดตั้ง ----------
-- ตั้งรหัสแอดมินจริง (ทำก่อนใช้หน้า admin-analytics.html):
--   UPDATE public.analytics_config SET value = 'รหัสยาวๆของคุณ' WHERE key = 'admin_token';
--
-- ทดสอบเขียน:
--   SELECT public.track_page_event('jptrust-toolkit', gen_random_uuid(), gen_random_uuid(),
--                                  'click', 'ทดสอบ', 'test', NULL, 'desktop', NULL);
-- ทดสอบอ่าน:
--   SELECT * FROM public.analytics_overview('รหัสยาวๆของคุณ', 30);
--
-- ขนาดที่ใช้จริง:
--   SELECT pg_size_pretty(pg_total_relation_size('public.page_events')) AS ขนาด,
--          COUNT(*) AS จำนวนแถว FROM public.page_events;
