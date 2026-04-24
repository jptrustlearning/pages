# Supabase Edge Function: `signup-webhook` (v2)

Receives signup data from `signup.html` and does **3 things**:

1. **Writes registration data** to `jptrustlearning/payment` GitHub repo (CSV + JSON + slip)
2. **Auto-grants Supabase access** — creates `auth.users` row with `email_confirm: true` so the user can login via OTP immediately
3. **Sends welcome email** in Thai via Gmail SMTP

GitHub PAT and SMTP password stay server-side (Supabase secrets). Client never sees them.

---

## 🎯 What changed in v2 (vs v1)

| | v1 (original) | v2 (this version) |
|---|---|---|
| Supabase user creation | Manual via Dashboard → Authentication → Users | **Auto** on every signup (`admin.createUser`) |
| Welcome email | None (Joon sends manually) | **Auto** HTML + plain text via Gmail SMTP |
| Response shape | `{ok, refCode, timestamp}` | `{ok, refCode, timestamp, granted, emailSent}` |
| JSON log fields | Registration data only | + `auto_grant` + `welcome_email` result blocks |
| New required secrets | `GITHUB_PAT` only | + `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` |

Grant + email are **best-effort** — if they fail, the signup still succeeds (data is saved in GitHub). The JSON log records what happened so admin can retry manually.

---

## 🚀 Deploy ครั้งแรก (ทำครั้งเดียว)

### 1. ติดตั้ง Supabase CLI (ถ้ายังไม่ได้ทำ)

```bash
npm install -g supabase
# หรือ macOS + Homebrew:
# brew install supabase/tap/supabase
```

### 2. Login

```bash
supabase login
# เปิด browser → login ด้วย Supabase account ที่ owner โปรเจค
```

### 3. Link โปรเจค

```bash
cd /path/to/pages
supabase link --project-ref rcdukwwcbyryauhqlzmx
```

### 4. ตั้ง secrets ทั้งหมด (ทำครั้งเดียว หรือเมื่อ password เปลี่ยน)

#### 4.1 GitHub PAT (เหมือน v1)

```bash
supabase secrets set GITHUB_PAT=<GITHUB_PAT>
```

#### 4.2 Gmail SMTP credentials (**ใหม่ใน v2**)

```bash
supabase secrets set SMTP_HOST=smtp.gmail.com
supabase secrets set SMTP_PORT=465
supabase secrets set SMTP_USER=jptrustlearning@gmail.com
supabase secrets set SMTP_PASS=<GMAIL_APP_PASSWORD_NO_SPACES>
```

> **Gmail App Password**: ใช้ตัวเดียวกับที่ตั้งใน Supabase Auth → SMTP ตอน A3 ได้เลย 16 ตัวอักษร ไม่ต้องมีเว้นวรรค ถ้าลืมหรือหายให้เข้า https://myaccount.google.com/apppasswords ด้วย account `jptrustlearning@gmail.com` แล้วสร้างใหม่ (ตัวเก่าจะ revoke อัตโนมัติหรือจะกดลบก็ได้)

#### 4.3 Supabase service role (อัตโนมัติ — **ไม่ต้องตั้ง**)

Edge Function runtime จะ inject ให้เองสองตัวนี้:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

ไม่ต้องใช้ `supabase secrets set` กับสองตัวนี้

### 5. เช็คว่า secrets ถูกตั้งครบ

```bash
supabase secrets list
```

ควรเห็น:
```
GITHUB_PAT          *****
SMTP_HOST           *****
SMTP_PORT           *****
SMTP_USER           *****
SMTP_PASS           *****
```

### 6. Deploy function

```bash
supabase functions deploy signup-webhook
```

Endpoint ที่ได้ (เหมือนเดิม):
```
https://rcdukwwcbyryauhqlzmx.supabase.co/functions/v1/signup-webhook
```

`signup.html` เรียก endpoint นี้อยู่แล้ว — **ไม่ต้องแก้ client**

---

## 🔄 Deploy ครั้งต่อไป (หลังแก้ `index.ts`)

```bash
cd /path/to/pages
supabase functions deploy signup-webhook
```

Secrets ไม่ต้อง set ใหม่

---

## 🧪 ทดสอบ

### ผ่าน UI

1. เปิด `https://jptrustlearning.github.io/pages/signup.html`
2. กรอกฟอร์ม (ใช้ email ทดสอบของตัวเอง) + ใส่ promo code `JPTGOLD2026`
3. กด Submit → ควรเห็น success modal

เช็คผล:
- เข้า `https://supabase.com/dashboard/project/rcdukwwcbyryauhqlzmx/auth/users` → ควรเห็น user เพิ่มเข้ามา
- เช็ค inbox email ที่ใช้สมัคร → ควรได้รับ welcome email ภายใน 10 วินาที
- เช็ค `https://github.com/jptrustlearning/payment/blob/main/member-registration.csv` → มี row ใหม่

### ผ่าน curl

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

Response ที่ต้องการ:
```json
{
  "ok": true,
  "refCode": "JPM-20260424-0042",
  "timestamp": "2026-04-24T...",
  "granted": true,
  "emailSent": true
}
```

ถ้า `granted: false` → เช็ค logs (section ถัดไป)
ถ้า `emailSent: false` → เช็ค SMTP secrets + App Password

---

## 📊 ดู logs

```bash
supabase functions logs signup-webhook
# หรือ real-time:
supabase functions logs signup-webhook --follow
```

Log messages ที่ควรเห็นในแต่ละ request สำเร็จ:
```
[grant] test@example.com — created
[email] welcome sent to test@example.com
```

Error patterns:
| Log message | แปลว่า | วิธีแก้ |
|---|---|---|
| `[grant] FAILED ... missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY` | Runtime ไม่ inject env | Redeploy function |
| `[grant] FAILED ... permission denied` | Service role key ผิด (ไม่น่าเกิด เพราะ auto-inject) | Recreate project link |
| `[email] FAILED ... missing SMTP_*` | ยังไม่ได้ set SMTP secrets | ทำ step 4.2 |
| `[email] FAILED ... 535` | Gmail App Password ผิด | สร้างใหม่ที่ apppasswords |
| `[email] FAILED ... connect ETIMEDOUT` | Port ถูก block | ใช้ port 587 แทน 465 |
| `[grant] ... already existed` | User เคยสมัครแล้ว | ปกติ — idempotent |

---

## 🔒 Security notes

- **All secrets อยู่ใน Supabase secrets เท่านั้น** — Client, repo, function source ไม่มีค่าจริง
- **CORS เปิด `*`** — ถ้าต้องการ lock เฉพาะ `https://jptrustlearning.github.io` แก้ `corsHeaders` ใน `index.ts`
- **JWT required** — Request ต้องมี `Authorization: Bearer <anon_key>` + `apikey: <anon_key>` (signup.html ใส่ให้แล้ว)
- **Rate limiting ยังไม่มี** — ถ้าโดน spam ให้เพิ่ม Deno KV counter หรือ Supabase rate limit policy
- **Email abuse**: Gmail App Password จำกัด 500 emails/วัน ถ้าโดน spam signup ก็อาจส่งเมลไม่สำเร็จชั่วคราว (ก็แค่ welcome email หาย แต่ user ยัง grant สำเร็จ)

---

## 🛠 ถ้าเปลี่ยน credentials

### เปลี่ยน GitHub PAT

```bash
supabase secrets set GITHUB_PAT=<new_token>
```

### เปลี่ยน Gmail App Password

```bash
supabase secrets set SMTP_PASS=<new_password>
```

ไม่ต้อง redeploy — function จะใช้ค่าใหม่ใน invocation ถัดไป

### เปลี่ยน sender email (จาก jptrustlearning@gmail.com → อื่น)

```bash
supabase secrets set SMTP_USER=<new_address>
supabase secrets set SMTP_PASS=<new_app_password>
```

> **หมายเหตุ**: อีเมลที่แสดงใน inbox ของ recipient จะเป็นค่า `SMTP_USER` — ถ้าเปลี่ยนเมลจะเปลี่ยนชื่อผู้ส่งด้วย

---

## 🗂 Data locations ที่ function เขียนลง `jptrustlearning/payment`

| Path | Content |
|---|---|
| `member-registration.csv` | Master log (ทุก registration) |
| `member-logs/member_regis_NNNN_email.json` | Individual JSON log — now includes `auto_grant` + `welcome_email` fields |
| `member-slips/slip_NNNN_email.ext` | Slip image (ถ้าไม่ใช้ promo) |

Ref code format: `JPM-YYYYMMDD-NNNN` (M = Member)

### Example JSON log (v2)

```json
{
  "id": "0042",
  "ref_code": "JPM-20260424-0042",
  "timestamp": "2026-04-24T15:30:00.000Z",
  "username": "สมชาย ใจดี",
  "age": 35,
  "email": "somchai@example.com",
  "promo_code": "JPTGOLD2026",
  "promo_applied": true,
  "slip_filename": "PROMO_BYPASS",
  "status": "pending",
  "confirmations": {
    "slip_attached": true,
    "payment_made": true
  },
  "auto_grant": {
    "granted": true,
    "already_existed": false,
    "error": null
  },
  "welcome_email": {
    "sent": true,
    "error": null
  }
}
```

---

## 🩹 Manual recovery (ถ้า auto-grant หรือ email fail)

### Grant failed

```bash
# SSH-less way: เข้า Supabase Dashboard → Auth → Users → Add user
#   email: <user_email>
#   email confirm: ON
```

### Welcome email failed

อาจส่ง manual ผ่าน Gmail ของ `jptrustlearning@gmail.com` โดย copy text จาก section ที่ติดตั้งใน `index.ts` (ฟังก์ชัน `buildWelcomeEmailText`)

---

## ❓ Troubleshooting

### User ได้ OTP login ไม่ทันที ต้องทำยังไง?

ไม่ต้องทำอะไร — พอ auto-grant สำเร็จ user สามารถไป enter email ใน login screen แล้วระบบจะส่ง OTP ให้ตามปกติ (ผ่าน Supabase Auth SMTP — ที่เราตั้งไว้ใน A3)

### Email ไปที่ Spam folder

ปกติ — Gmail → Gmail ส่งครั้งแรกมักเข้า Spam แนะนำให้ reply email 1 ครั้ง หรือ add `jptrustlearning@gmail.com` ไปยัง contacts เพื่อไม่ให้เข้า Spam ในอนาคต
ระยะยาวถ้าอยากดีขึ้น: ย้ายไป Resend + custom domain SPF/DKIM

### Port 465 โดน block

บาง ISP/firewall block port 465 ลองใช้ 587 แทน:

```bash
supabase secrets set SMTP_PORT=587
```

Function จะ auto-detect และใช้ STARTTLS แทน implicit TLS

### Deployed แล้วไม่เห็น log message ใหม่

Redeploy ใหม่:
```bash
supabase functions deploy signup-webhook
```

CLI จะ compress + upload source code ใหม่

---

## 📖 Code structure

```
index.ts (490 lines)
├── Config constants
├── CORS helpers
├── Response helpers (jsonResponse, errResponse)
├── GitHub helpers (ghGetFile, ghPutText, ghPutBinary, ghNextRunningNumber)
├── Supabase admin helper (grantSupabaseUser)       ← NEW
├── Email helpers                                    ← NEW
│   ├── buildWelcomeEmailText
│   ├── buildWelcomeEmailHtml
│   ├── escapeHtml
│   └── sendWelcomeEmail
└── serve() handler
    ├── Validation
    ├── Generate ref code
    ├── Write CSV
    ├── Write slip
    ├── Auto-grant user                              ← NEW
    ├── Send welcome email                           ← NEW
    ├── Write JSON log (with grant + email results)
    └── Return { ok, refCode, timestamp, granted, emailSent }
```

---

*v2 · 24 เมษายน 2026 · Joon + Claude*
