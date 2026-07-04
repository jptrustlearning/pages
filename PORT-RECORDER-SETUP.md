# 🦉 Port Recorder — คู่มือ Setup (ทำครั้งเดียว)

แอปแยก standalone: `port-recorder.html` — **ไม่มี jp-gate, ไม่ใช้ Supabase, public**
URL หลัง deploy: `https://app.jptrustlearning.com/port-recorder.html`

ทุกอย่าง **$0** — user เก็บข้อมูลใน Google Drive ตัวเอง, ราคาจาก Yahoo ผ่าน Worker ฟรี, OCR รันในเครื่อง user

มี 2 อย่างที่ Joon ต้องทำเองครั้งเดียว (Claude ทำแทนไม่ได้ ต้องใช้ account Joon):

---

## ① Deploy Worker ราคาหุ้น (~5 นาที)

1. เข้า Cloudflare dashboard (`jptrustlearning@gmail.com`) → **Workers & Pages** → **Create** → **Create Worker**
2. ตั้งชื่อ เช่น `port-price` → Deploy (โค้ดตัวอย่างก่อน)
3. กด **Edit code** → ลบทั้งหมด → วางโค้ดจากไฟล์ **`workers/port-price-worker.js`** ใน repo นี้ → **Save and deploy**
4. ได้ URL เช่น `https://port-price.cde52259.workers.dev`
5. ทดสอบ: เปิด `https://port-price.xxx.workers.dev/hist?symbol=AAPL&from=2026-06-01`
   → ต้องเห็น JSON `{"symbol":"AAPL","dates":[...],"closes":[...]}`

**Endpoint:** `GET /hist?symbol=TICKER&from=YYYY-MM-DD` — daily adjusted closes, มี edge-cache รายวัน (ticker เดิมวันเดิมไม่ยิง Yahoo ซ้ำ) · Free plan 100k req/วัน เหลือเฟือ

---

## ② สร้าง Google OAuth Client ID (~10 นาที)

ให้ user เชื่อม Google Drive ตัวเอง (scope `drive.file` = แอปเห็นเฉพาะไฟล์ที่แอปสร้าง — non-sensitive, ไม่ต้องผ่าน verification ยุ่งยาก)

1. เข้า https://console.cloud.google.com (account `jptrustlearning@gmail.com`)
2. สร้าง Project ใหม่ ชื่อ เช่น `JP Port Recorder`
3. **APIs & Services → Library** → ค้น **Google Drive API** → **Enable**
4. **APIs & Services → OAuth consent screen**:
   - User type: **External** → Create
   - App name: `JP Port Recorder` · support email: `jptrustlearning@gmail.com`
   - Scopes: เพิ่ม `.../auth/drive.file`
   - **Publishing status: กด "Publish App"** (สำคัญ! ถ้าค้าง Testing จะใช้ได้เฉพาะ email ที่ whitelist)
5. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Type: **Web application**
   - Name: `port-recorder-web`
   - **Authorized JavaScript origins** (ไม่ต้องใส่ redirect URI):
     - `https://app.jptrustlearning.com`
     - `http://localhost:8000` (ไว้เทสในเครื่อง)
6. ได้ **Client ID** รูปแบบ `xxxxxxx.apps.googleusercontent.com`

---

## ③ ใส่ค่าลงแอป

เทสก่อน: เปิดแอป → แท็บ **ตั้งค่า** → วาง Worker URL + Client ID ในช่อง → บันทึก (เก็บใน localStorage เครื่องนั้น)

Production (ฝังถาวรให้ user ทุกคน): แก้ 2 บรรทัดบนสุดของ `<script>` ใน `port-recorder.html`:

```js
const DEFAULT_WORKER_URL = 'https://port-price.xxx.workers.dev';
const DEFAULT_CLIENT_ID  = 'xxxxxxx.apps.googleusercontent.com';
```

commit + push → เสร็จ (บอก Claude ให้แก้ก็ได้)

---

## สถาปัตยกรรม (อ้างอิง)

| ส่วน | ที่เก็บ/แหล่ง | หมายเหตุ |
|---|---|---|
| ข้อมูลพอร์ต | localStorage เสมอ + Drive (ถ้าเชื่อม) | ไฟล์ `portfolio-data.json` ใน folder "JP Port Recorder" |
| รูปสลิป | ฝังใน record เป็น JPEG ย่อ (~700px) | ติดไปกับ JSON เดียวกัน ซิงก์พร้อมกัน |
| ราคา | Yahoo → Worker → เก็บใน localStorage + Drive | backfill ตั้งแต่วันซื้อครั้งเดียว แล้ว append รายวัน |
| OCR | Tesseract.js (CDN, lazy-load ครั้งแรกที่ใช้) | รันในเครื่อง user 100% |
| Rebalance | `targets` per portfolio ใน JSON | โหมด ขาย+ซื้อ / เติมเงินอย่างเดียว · tolerance ตั้งได้ |

**Flow สลิป:** อัพรูป → OCR → Pending record (ticker/ราคา/จำนวน/วันที่ เดาให้) → user กด ✓ ตรวจ/แก้ในฟอร์ม → เลือกพอร์ต → เข้าพอร์ตจริง + backfill ราคา

**ความปลอดภัย:** ไม่มี server เราเก็บข้อมูล user เลย — browser คุยตรงกับ Google Drive ของ user เอง · Worker เห็นแค่ ticker+วันที่ (ข้อมูลตลาดสาธารณะ)

**ข้อจำกัดที่รู้ไว้:**
- Yahoo endpoint เป็น unofficial — ถ้าโดนบล็อกวันไหน แก้ที่ Worker ตัวเดียว (สลับ Stooq/EODHD) แอปไม่ต้องแตะ
- Google token อายุ 1 ชม. — หมดแล้วแอปขอใหม่เอง อาจมี popup แวบครั้งแรกของวัน
- ข้อมูลอยู่ per-เครื่อง จนกว่าจะเชื่อม Drive (เชื่อมแล้วเปิดเครื่องไหนก็ดึงจาก Drive ได้)
