-- ============================================================================
-- jpt_signup_approval_v1.sql — อนุมัติ/ปฏิเสธการสมัครผ่านปุ่มในอีเมล (A129 · 20 ก.ย. 2026)
-- ============================================================================
-- สถานะการรัน:  ⬜ ยังไม่ได้รัน   (รันแล้วให้แก้บรรทัดนี้เป็น ✅ พร้อมวันที่ — กฎ A67)
--
-- ⚠️ ก่อนวางใน SQL Editor: ลบของเก่าในแท็บให้เกลี้ยงก่อน (SQL Editor รันทั้งแท็บ — บทเรียน A69 §4)
-- ไฟล์นี้รันซ้ำได้ (idempotent) · ไม่แตะข้อมูลสมาชิกเดิมแม้แต่แถวเดียว
--
-- ทำอะไร
--   ① ตาราง public.signup_requests   — คิวคำขอสมัคร/ต่ออายุที่รออนุมัติ (service-role เท่านั้น)
--   ② jpt_decide_request()            — อนุมัติ/ปฏิเสธแบบ atomic (กดซ้ำ/กดพร้อมกันไม่บวกวันซ้ำ)
--   ③ jpt_approve() ฉบับแก้           — ทางสำรองใน SQL Editor · เลิกบวกวันซ้ำสองเท่า
--   ④ ปิดรู: REVOKE EXECUTE จาก anon/authenticated (ของเดิมใครมี anon key ก็เรียก rpc/jpt_approve ได้)
--   ⑤ trigger ชุด A69 (v2) ฉบับ canonical — เดิมมีแต่ใน DB ไม่มีไฟล์ใน repo
--
-- โมเดลใหม่: signup-webhook "ไม่ grant" อีกต่อไป — แค่สร้างบัญชีแบบ hold + บันทึกคำขอลงตารางนี้
--            วันสมาชิกถูกนับ "ตอนกดอนุมัติ" ครั้งเดียว = max(ตอนนี้, วันหมดอายุเดิม) + 30/365 วัน
-- ============================================================================

-- ① คิวคำขอ ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.signup_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_code             text NOT NULL,                 -- ไม่ UNIQUE: เลขรันชนกันได้ถ้าสมัครพร้อมกันเป๊ะ (คิวต้องไม่ล้มเพราะเรื่องนี้)
  token_hash           text NOT NULL UNIQUE,          -- sha256(hex) ของ token ในลิงก์อีเมล (ไม่เก็บ token ดิบ)
  email                text NOT NULL,
  username             text,
  kind                 text NOT NULL DEFAULT 'new'     CHECK (kind IN ('new','renew')),
  plan                 text,
  duration_days        integer NOT NULL DEFAULT 0,
  base_price           numeric NOT NULL DEFAULT 0,
  amount_due           numeric NOT NULL DEFAULT 0,
  promo_code           text,
  promo_discount_type  text,
  promo_discount_value numeric NOT NULL DEFAULT 0,
  slip_path            text,                           -- path ใน repo payment (null = โค้ดฟรี ไม่มีสลิป)
  slip_bytes           integer,
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  decided_at           timestamptz,
  decided_note         text,
  granted_expires_at   timestamptz
);
CREATE INDEX IF NOT EXISTS signup_requests_ref_idx    ON public.signup_requests (ref_code);
CREATE INDEX IF NOT EXISTS signup_requests_email_idx  ON public.signup_requests (lower(email));
CREATE INDEX IF NOT EXISTS signup_requests_status_idx ON public.signup_requests (status, created_at);

ALTER TABLE public.signup_requests ENABLE ROW LEVEL SECURITY;   -- ไม่มี policy = anon/authenticated อ่านเขียนไม่ได้เลย
REVOKE ALL ON public.signup_requests FROM PUBLIC, anon, authenticated;
GRANT  ALL ON public.signup_requests TO service_role;

-- ② อนุมัติ / ปฏิเสธ (atomic) --------------------------------------------------
CREATE OR REPLACE FUNCTION public.jpt_decide_request(p_token_hash text, p_action text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  r        public.signup_requests%ROWTYPE;
  v_uid    uuid;
  v_meta   jsonb;
  v_cur    timestamptz;
  v_exp    timestamptz;
  v_other  integer;
  v_now    text := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  v_new    jsonb;
BEGIN
  IF p_action NOT IN ('approve','reject') THEN
    RAISE EXCEPTION 'JPT: bad action %', p_action;
  END IF;

  -- จองคำขอแบบ atomic: มีแค่คนแรกที่เปลี่ยน pending → approved/rejected ได้
  UPDATE public.signup_requests sr
     SET status       = CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
         decided_at   = now(),
         decided_note = NULLIF(btrim(COALESCE(p_note, '')), '')
   WHERE sr.token_hash = p_token_hash AND sr.status = 'pending'
  RETURNING sr.* INTO r;

  IF NOT FOUND THEN
    SELECT sr.* INTO r FROM public.signup_requests sr WHERE sr.token_hash = p_token_hash;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'JPT: request not found';
    END IF;
    RETURN jsonb_build_object(
      'changed', false, 'status', r.status, 'email', r.email, 'username', r.username,
      'kind', r.kind, 'plan', r.plan, 'ref_code', r.ref_code, 'amount_due', r.amount_due,
      'decided_at', r.decided_at, 'decided_note', r.decided_note, 'expires_at', r.granted_expires_at);
  END IF;

  SELECT u.id, COALESCE(u.raw_app_meta_data, '{}'::jsonb)
    INTO v_uid, v_meta
    FROM auth.users u
   WHERE lower(u.email) = lower(r.email)
   FOR UPDATE;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'JPT: ไม่พบบัญชี % ใน auth.users', r.email;   -- rollback ทั้งก้อน คำขอกลับเป็น pending
  END IF;

  SELECT count(*) INTO v_other
    FROM public.signup_requests sr
   WHERE lower(sr.email) = lower(r.email) AND sr.status = 'pending' AND sr.id <> r.id;

  IF p_action = 'approve' THEN
    BEGIN
      v_cur := NULLIF(v_meta->>'subscription_expires_at', '')::timestamptz;
    EXCEPTION WHEN OTHERS THEN v_cur := NULL; END;

    IF COALESCE(r.duration_days, 0) > 0 THEN
      v_exp := GREATEST(now(), COALESCE(v_cur, now())) + make_interval(days => r.duration_days);
    ELSE
      v_exp := v_cur;                                   -- legacy / ไม่มีแพ็ก: ไม่แตะวันหมดอายุ
    END IF;

    v_new := (v_meta - 'jpt_pending' - 'jpt_rejected_at' - 'jpt_reject_note')
      || jsonb_build_object(
           'subscription_status',     'active',
           'jpt_hold',                (v_other > 0),
           'jpt_approve_at',          v_now,            -- ประทับใหม่ → trigger jpt_hold_on_grant ปล่อยผ่าน
           'plan',                    r.plan,
           'amount',                  r.amount_due,
           'amount_due',              r.amount_due,
           'base_price',              r.base_price,
           'promo_applied',           (r.promo_code IS NOT NULL AND r.promo_code <> ''),
           'promo_code',              NULLIF(r.promo_code, ''),
           'promo_discount_type',     r.promo_discount_type,
           'promo_discount_value',    r.promo_discount_value,
           'ref_code',                r.ref_code,
           -- วันสมัครครั้งแรก: ห้ามทับ (A32) — ถ้ายังไม่เคยมี ใช้เวลาที่ส่งใบสมัครใบนี้
           'subscription_started_at', COALESCE(NULLIF(v_meta->>'subscription_started_at', ''),
                                        to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
           'subscription_renewed_at', CASE WHEN r.kind = 'renew'
                                        THEN to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                                        ELSE v_meta->'subscription_renewed_at' END);
    IF v_exp IS NOT NULL THEN
      v_new := v_new || jsonb_build_object('subscription_expires_at',
                 to_char(v_exp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    END IF;

    UPDATE auth.users u SET raw_app_meta_data = v_new WHERE u.id = v_uid;
    UPDATE public.signup_requests sr SET granted_expires_at = v_exp WHERE sr.id = r.id;

  ELSE  -- reject
    -- ไม่แตะ subscription_status / วันหมดอายุ: สมาชิกที่ยังมีวันเหลือใช้งานต่อได้ตามเดิม
    -- ถ้ายังมีคำขออื่นของอีเมลนี้ค้างอยู่ → คงสถานะ hold ไว้
    IF v_other = 0 THEN
      v_new := (v_meta - 'jpt_pending')
        || jsonb_build_object('jpt_hold', false, 'jpt_rejected_at', v_now,
                              'jpt_reject_note', NULLIF(btrim(COALESCE(p_note, '')), ''));
      UPDATE auth.users u SET raw_app_meta_data = v_new WHERE u.id = v_uid;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'changed', true, 'status', CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
    'email', r.email, 'username', r.username, 'kind', r.kind, 'plan', r.plan,
    'ref_code', r.ref_code, 'amount_due', r.amount_due,
    'decided_at', now(), 'decided_note', NULLIF(btrim(COALESCE(p_note, '')), ''),
    'expires_at', v_exp, 'other_pending', v_other);
END
$fn$;

-- ③ jpt_approve() ฉบับแก้ — ทางสำรองใน SQL Editor ---------------------------------
--    SELECT * FROM jpt_approve('someone@gmail.com');                          -- ปกติ
--    SELECT * FROM jpt_approve('someone@gmail.com', '2026-12-31T23:59:59Z');  -- กำหนดวันเอง
--
--    • มีคำขอ pending ในคิว → อนุมัติคำขอที่เก่าสุด (ตรรกะเดียวกับปุ่มในอีเมล นับวันครั้งเดียว)
--    • ไม่มีคำขอในคิว (บัญชีค้างจาก flow เก่า ที่ webhook บวกวันไปแล้วตอนสมัคร)
--        → แค่ปลด hold · วันหมดอายุเดิมที่ยังอยู่ในอนาคต "คงไว้ ไม่บวกซ้ำ"
--          (ฉบับ A69 บวกซ้ำ: รายเดือนได้ 60 วัน รายปีได้ 2 ปี — จำลองยืนยันแล้ว 20 ก.ย.)
--        → ถ้าไม่มีวัน/หมดไปแล้ว ค่อยนับ ตอนนี้ + 30/365
CREATE OR REPLACE FUNCTION public.jpt_approve(p_email text, p_expires timestamptz DEFAULT NULL)
RETURNS TABLE(email text, สถานะ text, หมดอายุ text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_uid  uuid;
  v_meta jsonb;
  v_hash text;
  v_cur  timestamptz;
  v_exp  timestamptz;
BEGIN
  SELECT u.id, COALESCE(u.raw_app_meta_data, '{}'::jsonb) INTO v_uid, v_meta
    FROM auth.users u WHERE lower(u.email) = lower(p_email) FOR UPDATE;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'JPT: ไม่พบอีเมล %', p_email;
  END IF;

  SELECT sr.token_hash INTO v_hash
    FROM public.signup_requests sr
   WHERE lower(sr.email) = lower(p_email) AND sr.status = 'pending'
   ORDER BY sr.created_at LIMIT 1;

  IF v_hash IS NOT NULL AND p_expires IS NULL THEN
    PERFORM public.jpt_decide_request(v_hash, 'approve', 'via jpt_approve()');
  ELSE
    BEGIN
      v_cur := NULLIF(v_meta->>'subscription_expires_at', '')::timestamptz;
    EXCEPTION WHEN OTHERS THEN v_cur := NULL; END;
    v_exp := COALESCE(
      p_expires,
      CASE WHEN v_cur IS NOT NULL AND v_cur > now() THEN v_cur
           ELSE now() + CASE WHEN v_meta->>'plan' = 'yearly' THEN INTERVAL '365 days' ELSE INTERVAL '30 days' END
      END);
    UPDATE auth.users u
       SET raw_app_meta_data = (v_meta - 'jpt_pending' - 'jpt_rejected_at' - 'jpt_reject_note') || jsonb_build_object(
             'subscription_status',     'active',
             'jpt_hold',                false,
             'jpt_approve_at',          to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
             'subscription_expires_at', to_char(v_exp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
     WHERE u.id = v_uid;
    IF v_hash IS NOT NULL THEN   -- กำหนดวันเอง + มีคำขอค้าง → ปิดคำขอนั้นด้วย ไม่ให้ค้างในคิว
      UPDATE public.signup_requests sr
         SET status = 'approved', decided_at = now(), decided_note = 'via jpt_approve(date)', granted_expires_at = v_exp
       WHERE sr.token_hash = v_hash;
    END IF;
  END IF;

  RETURN QUERY
  SELECT u.email::text,
         u.raw_app_meta_data->>'subscription_status',
         u.raw_app_meta_data->>'subscription_expires_at'
    FROM auth.users u
   WHERE u.id = v_uid;
END
$fn$;

-- ④ ปิดรู: ฟังก์ชัน SECURITY DEFINER ใน public ถูกเปิดให้ anon เรียกผ่าน /rest/v1/rpc/ โดยปริยาย ----
REVOKE ALL ON FUNCTION public.jpt_decide_request(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.jpt_approve(text, timestamptz)       FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jpt_decide_request(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.jpt_approve(text, timestamptz)       TO service_role;

-- ⑤ trigger ชุด A69 (v2) — ฉบับ canonical · ชั้นกันที่สอง ------------------------------
--    ใครก็ตาม (รวม webhook รุ่นเก่า/บั๊กในอนาคต) ที่เซ็ต/เปลี่ยน subscription_expires_at
--    โดยไม่ประทับ jpt_approve_at ใหม่ → โดนเขียนทับเป็น revoked + jpt_hold ทันที
CREATE OR REPLACE FUNCTION public.jpt_hold_new_signup()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NEW.email ~* '@(xsnipersquad\.site)$' THEN
    RAISE EXCEPTION 'JPT: blocked domain %', NEW.email;
  END IF;
  BEGIN
    IF jsonb_exists(NEW.raw_app_meta_data, 'subscription_expires_at')
       AND COALESCE(NEW.raw_app_meta_data->>'jpt_hold', '') <> 'false' THEN
      NEW.raw_app_meta_data := NEW.raw_app_meta_data || jsonb_build_object(
        'subscription_status', 'revoked',
        'jpt_hold',            true,
        'jpt_hold_at',         to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS jpt_hold_new_signup ON auth.users;
CREATE TRIGGER jpt_hold_new_signup
BEFORE INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.jpt_hold_new_signup();

CREATE OR REPLACE FUNCTION public.jpt_hold_on_grant()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  approving boolean;
BEGIN
  BEGIN
    approving := NEW.raw_app_meta_data->>'jpt_approve_at' IS NOT NULL
             AND NEW.raw_app_meta_data->>'jpt_approve_at'
                 IS DISTINCT FROM OLD.raw_app_meta_data->>'jpt_approve_at';

    IF NEW.raw_app_meta_data->>'subscription_expires_at' IS NOT NULL
       AND NEW.raw_app_meta_data->>'subscription_expires_at'
           IS DISTINCT FROM OLD.raw_app_meta_data->>'subscription_expires_at'
       AND NOT approving THEN
      NEW.raw_app_meta_data := NEW.raw_app_meta_data || jsonb_build_object(
        'subscription_status', 'revoked',
        'jpt_hold',            true,
        'jpt_hold_at',         to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS jpt_hold_renewal  ON auth.users;
DROP TRIGGER IF EXISTS jpt_hold_on_grant ON auth.users;
CREATE TRIGGER jpt_hold_on_grant
BEFORE UPDATE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.jpt_hold_on_grant();

-- ============================================================================
-- ตรวจหลังรัน (อ่านอย่างเดียว) — ควรได้ trigger 2 แถว + ฟังก์ชัน 4 ตัว + ตาราง 1
-- ============================================================================
-- SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname LIKE 'jpt%';
-- SELECT proname FROM pg_proc WHERE proname LIKE 'jpt_%' ORDER BY 1;
-- SELECT count(*) FROM public.signup_requests;
--
-- คิวรออนุมัติ:
-- SELECT ref_code, kind, email, plan, amount_due, created_at AT TIME ZONE 'Asia/Bangkok' AS ส่งเมื่อ
--   FROM public.signup_requests WHERE status = 'pending' ORDER BY created_at;
