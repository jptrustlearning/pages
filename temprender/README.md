# temprender — JPTrust App Ad Renders (WIP)

โฟลเดอร์ชั่วคราวสำหรับงานทำภาพโฆษณาแอป JPTrust (กราฟิกแนวตั้งสำหรับ IG/FB)
self-contained — ฝังฟอนต์ + สกรีนช็อตไว้ในตัว แก้/เรนเดอร์ใหม่ได้เรื่อย ๆ

## ไฟล์
- `build_ad.py` — สคริปต์ประกอบ HTML + เรนเดอร์เป็น PNG (1080×1350 @2x → 2160×2700)
- `ad1.html` — Part 1 (VS S&P 500) self-contained (ฟอนต์+รูป base64 ในตัว) เปิดในเบราว์เซอร์ได้เลย
- `ad1.png` — ผลลัพธ์ภาพล่าสุด
- `screen_vs.jpg` — สกรีนช็อต VS S&P 500 (ครอปแถบ android nav ดำออกแล้ว)
- `fonts/` — woff2 เฉพาะที่ใช้: Anuphan (latin+thai 300–700), Cinzel (400/600), DM Serif Display (400)

## เรนเดอร์ใหม่
```bash
# ครั้งแรกต่อเครื่อง (chromium ของ playwright ลงใหม่ทุก session)
pip install playwright pillow --break-system-packages
python3 -m playwright install chromium

# เรนเดอร์
python3 build_ad.py            # เขียน ad1.html + ad1.png
python3 build_ad.py --no-render  # เขียน HTML อย่างเดียว (เร็ว, ไว้พรีวิว)
```
ไม่ต้องต่อเน็ตหรือ npm install — ฟอนต์อยู่ใน `fonts/` แล้ว

## แก้คำโปรย / ดีไซน์
แก้ตรง block HTML ใน `build_ad.py` (headline `<h1>`, `.sub`, bullets, `.badge`, `.cta`)
สเปกแบรนด์อ้างอิง: `JPTRUST-THEME-GUIDE.md` (มารูน #1a0a0e/#3a1520, ครีม #FAF6ED, ทอง #D4AF37)

## TODO
- [ ] Part 2 — Roadmap 90 วัน + Planning Toolkit
- [ ] Part 3 — Lab / 5 กลยุทธ์
- [ ] Part 4 — News / Insight รายวัน

> หมายเหตุ: โฟลเดอร์นี้เป็น asset โฆษณา ไม่เกี่ยวกับ build ของ PWA — ไม่ถูก deploy
