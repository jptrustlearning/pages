# temprender — JPTrust App Ad Renders

ชุดกราฟิกโฆษณาแอป JPTrust (แนวตั้ง 1080×1350 @2x → 2160×2700) ดีไซน์ดำ-ทองพรีเมียม
self-contained — ฝังฟอนต์ + สกรีนช็อต + โลโก้ไว้ในตัว แก้/เรนเดอร์ใหม่ได้โดยไม่ต้องต่อเน็ต

## ไฟล์หลัก
- `build_all.py` — **master builder** สร้างทั้ง 4 ภาพจากเทมเพลตเดียว (แก้คำที่ `CONFIGS`)
- `ad1.png` / `ad2.png` / `ad3.png` / `ad4.png` — ผลลัพธ์ (และ `.html` self-contained คู่กัน)
- `owl.png` — โลโก้นกฮูก (ครอปจาก ad reference)
- `screen_vs.jpg` `screen_roadmap.jpg` `screen_lab.jpg` `screen_news.jpg` — สกรีนช็อต (ครอป nav ออกแล้ว)
- `fonts/` — woff2: Anuphan (latin+thai 300–700), Cinzel (400/600), DM Serif Display (400)

## 4 ภาพในชุด
| ภาพ | มุมขาย | สกรีน |
|-----|--------|-------|
| ad5 | ภาพปก — ทุกเครื่องมือครบในแอปเดียว | screen_home |
| ad1 | VS S&P 500 — กลยุทธ์พิสูจน์แล้ว | screen_vs |
| ad2 | Roadmap 90 วัน — มีแผนทีละก้าว | screen_roadmap |
| ad3 | Strategy Lab — ทดสอบกลยุทธ์มือโปร | screen_lab |
| ad4 | Daily News — อ่านตลาดเช้า-บ่าย-เย็น | screen_news |
| ad5_cream | ปก เวอร์ชันพื้นครีมเหลือบทอง (theme=cream) | screen_home |

## เรนเดอร์ใหม่
    pip install playwright pillow --break-system-packages
    python3 -m playwright install chromium   # ครั้งแรกต่อเครื่อง
    python3 build_all.py                       # สร้างทั้ง 4
    python3 build_all.py --no-render           # เขียน HTML อย่างเดียว (พรีวิวเร็ว)

## แก้เนื้อหา / ดีไซน์
- คำโปรย/ฟีเจอร์: แก้ที่ dict `CONFIGS` ใน build_all.py (eyebrow, headline, sub, badge, feats, disc)
- เทมเพลต/สี/ขนาด: แก้ที่ตัวแปร `CSS`
- ไอคอน: เพิ่ม/แก้ที่ dict `ICON` (inline SVG เส้นทอง)
- เลย์เอาต์: ซ้าย = โลโก้+headline+sub+4 feature การ์ดไอคอน · ขวา = มือถือเอียง · ล่าง = CTA bar
- สเปกแบรนด์: JPTRUST-THEME-GUIDE.md (มารูน #1a0a0e/#3a1520, ทอง #D4AF37)

หมายเหตุ: โฟลเดอร์นี้เป็น asset โฆษณา ไม่เกี่ยวกับ build PWA — ไม่ถูก deploy
