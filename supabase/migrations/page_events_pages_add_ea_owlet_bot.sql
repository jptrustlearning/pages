-- A224 (15 ต.ค. 2026) · เพิ่มหน้า ea-owlet-bot.html เข้า whitelist ของตัวเก็บสถิติ (lib/jpt-track.js)
-- ไม่รัน = หน้านี้ใช้งานได้ปกติ แค่ไม่มีสถิติ page_view/download ของหน้านี้ (RPC ทิ้งเงียบ)
-- ปุ่มดาวน์โหลดบนการ์ดในหน้า Tool&Kit นับอยู่แล้วภายใต้ 'jptrust-toolkit' ไม่ต้องรันไฟล์นี้ก็เห็น
-- ⚠️ ไฟล์ .sql ใน repo ≠ รันแล้ว — ยืนยันใน handoff เมื่อจูนรันจริง
INSERT INTO public.page_events_pages(page, label) VALUES
  ('ea-owlet-bot', 'ดาวน์โหลดฟรี · OWLET BOT')
ON CONFLICT (page) DO UPDATE SET label = EXCLUDED.label, active = TRUE;
