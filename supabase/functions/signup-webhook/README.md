# Supabase Edge Function: `signup-webhook`

รับข้อมูลสมัครสมาชิกจาก `signup.html` → validate → เขียนลง `jptrustlearning/payment` repo (GitHub PAT อยู่ฝั่ง server ไม่โผล่ใน client)

---

## 🚀 Deploy ครั้งแรก (ทำครั้งเดียว)

### 1. ติดตั้ง Supabase CLI

```bash
npm install -g supabase
# หรือถ้าใช้ macOS + Homebrew:
# brew install supabase/tap/supabase
```

### 2. Login

```bash
supabase login
# เปิด browser → login ด้วย Supabase account ที่ owner โปรเจคเรา
```

### 3. Link โปรเจค (ทำครั้งเดียว)

```bash
cd /path/to/pages  # folder ที่ clone repo มา
supabase link --project-ref rcdukwwcbyryauhqlzmx
```

### 4. เก็บ GitHub PAT เป็น secret (ทำครั้งเดียว)

```bash
supabase secrets set GITHUB_PAT=<GITHUB_PAT_FROM_WORKSHOP_TEMPLATE>
```

> **หมายเหตุ:** PAT ตัวนี้คือตัวเดียวกับที่อยู่ใน `workshop-registration` HTML — เปิดไฟล์ template แล้วคัดลอกค่า `GITHUB_TOKEN` มาใช้ Scope ต้องมี permission เขียน `jptrustlearning/payment` repo

### 5. Deploy function

```bash
supabase functions deploy signup-webhook
```

พอ deploy สำเร็จ จะได้ endpoint:
```
https://rcdukwwcbyryauhqlzmx.supabase.co/functions/v1/signup-webhook
```

`signup.html` เรียก endpoint นี้อยู่แล้ว → ใช้ได้ทันที

---

## 🔄 Deploy ครั้งต่อไป (หลังแก้โค้ด)

```bash
cd /path/to/pages
supabase functions deploy signup-webhook
```

แค่คำสั่งเดียว — link + secret ไม่ต้อง set ใหม่

---

## 🧪 ทดสอบ

### ผ่าน UI
เปิด `https://jptrustlearning.github.io/pages/signup.html` → กรอกฟอร์ม → submit

### ผ่าน curl (สำหรับ debug)

```bash
curl -X POST 'https://rcdukwwcbyryauhqlzmx.supabase.co/functions/v1/signup-webhook' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <SUPABASE_ANON_KEY>' \
  -H 'apikey: <SUPABASE_ANON_KEY>' \
  -d '{
    "email": "test@example.com",
    "username": "Test User",
    "age": 30,
    "promoCode": "JPTGOLD2026",
    "slipBase64": null,
    "slipFilename": null
  }'
```

Response ที่ควรได้:
```json
{ "ok": true, "refCode": "JPM-20260424-0001", "timestamp": "2026-04-24T..." }
```

---

## 📊 ดู logs

```bash
supabase functions logs signup-webhook
```

หรือ real-time:
```bash
supabase functions logs signup-webhook --follow
```

---

## 🔒 Security notes

- **GITHUB_PAT อยู่ใน Supabase secrets เท่านั้น** — Client (browser) ไม่เห็น, repo ไม่มี
- **CORS เปิด `*`** — ถ้าอยาก lock เฉพาะ `https://jptrustlearning.github.io` แก้ใน `corsHeaders` ของ `index.ts`
- **Rate limiting ยังไม่มี** — ถ้าโดน spam ให้เพิ่ม `Deno.env.get("RATE_LIMIT_KV")` หรือใช้ Supabase `rate_limit` policy
- **JWT required (default)** — Request ต้องมี `Authorization: Bearer <anon_key>` + `apikey: <anon_key>` (signup.html ใส่ให้แล้ว)

---

## 🛠 ถ้าเปลี่ยน PAT

```bash
# อัพเดท secret (ไม่ต้อง redeploy function)
supabase secrets set GITHUB_PAT=<new_token>
```

Function จะใช้ token ใหม่ทันทีใน invocation ถัดไป

---

## ❓ ถ้าลืมว่าเคย deploy หรือยัง

```bash
supabase functions list
```

ควรเห็น `signup-webhook` ในรายการ

---

## 🗂 Data locations ที่ function เขียนลง `jptrustlearning/payment`

| Path | Content |
|---|---|
| `member-registration.csv` | Master log (ทุก registration) |
| `member-logs/member_regis_NNNN_email.json` | Individual JSON log |
| `member-slips/slip_NNNN_email.ext` | Slip image (ถ้าไม่ใช้ promo) |

Ref code format: `JPM-YYYYMMDD-NNNN` (M = Member)
