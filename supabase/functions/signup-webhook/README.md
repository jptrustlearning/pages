# Supabase Edge Function: `signup-webhook` (v3)

Receives signup data from `signup.html` and does **3 things**:

1. **Writes registration data** to `jptrustlearning/payment` GitHub repo (CSV + JSON + slip)
2. **Auto-grants Supabase access** — creates `auth.users` row with `email_confirm: true` so the user can login via OTP immediately
3. **Sends welcome email** in Thai via **Resend HTTP API**

GitHub PAT and Resend API key stay server-side (Supabase secrets). Client never sees them.

---

## 🎯 What changed across versions

| | v1 | v2 | v3 (current) |
|---|---|---|---|
| Supabase user creation | Manual via Dashboard | Auto (`admin.createUser`) | Auto (`admin.createUser`) |
| Welcome email | None | Gmail SMTP via nodemailer | **Resend HTTP API** |
| Email Thai encoding | n/a | RFC 2047 (handled by nodemailer) | Native UTF-8 (handled by Resend) |
| Required email secrets | none | `SMTP_HOST/PORT/USER/PASS` | `RESEND_API_KEY`, `RESEND_FROM` |
| Deliverability | n/a | Mediocre (Gmail-to-Gmail spam) | High (Resend reputation + verified domain) |

Grant + email are **best-effort** — if they fail, signup still succeeds (data saved in GitHub). The JSON log records what happened so admin can retry manually.

---

## 🚀 Deploy ครั้งแรก

```bash
# Install Supabase CLI (if not yet)
npm install -g supabase

# Login + link
supabase login
cd /path/to/pages
supabase link --project-ref rcdukwwcbyryauhqlzmx

# Set secrets
supabase secrets set GITHUB_PAT=<github_pat>
supabase secrets set RESEND_API_KEY=re_xxxxx
supabase secrets set RESEND_FROM='JP Trust Learning <noreply@jptrustlearning.com>'

# Deploy
supabase functions deploy signup-webhook
```

> **Note:** เก่า v2 secrets (`SMTP_HOST/PORT/USER/PASS`) ไม่จำเป็นแล้ว — function ignore ไป. ถ้าจะเคลียร์ให้สะอาด:
> ```bash
> supabase secrets unset SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASS
> ```

---

## 🔄 Deploy code change

```powershell
cd ~\Documents\pages
git pull origin main
supabase functions deploy signup-webhook
```

Secrets persist across deploys — ไม่ต้องตั้งใหม่ unless rotating

---

## 🧪 Test

After deploy, สมัครด้วย email ใหม่ที่ `signup.html`:

1. ตรวจ `auth.users` ใน Supabase Dashboard → ต้องมี user ใหม่
2. ตรวจ email inbox → ต้องได้ welcome email
3. ตรวจ [resend.com/emails](https://resend.com/emails) → ดู status (delivered/bounced/clicked)
4. ตรวจ logs: `supabase functions logs signup-webhook`

---

## 📝 Required secrets

| Secret | Purpose |
|---|---|
| `GITHUB_PAT` | Write to `jptrustlearning/payment` repo |
| `RESEND_API_KEY` | Send welcome email via Resend |
| `RESEND_FROM` | Sender display, e.g. `JP Trust Learning <noreply@jptrustlearning.com>` |

Auto-injected by Supabase runtime (don't set manually): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

---

## 🐛 Troubleshooting

### Welcome email ไม่มาถึง

1. เช็ค [resend.com/emails](https://resend.com/emails) → status?
   - `delivered` → ไป spam folder?
   - `bounced` → email address ผิด หรือ recipient mailbox เต็ม
   - `failed` → คลิกดู error detail
2. เช็ค logs: `supabase functions logs signup-webhook` → หา `[email] welcome email failed:` line
3. Common errors:
   - `Resend 401` → API key ผิดหรือถูก revoke
   - `Resend 422: from must be from a verified domain` → `RESEND_FROM` ใช้ domain ที่ยังไม่ verified
   - `missing RESEND_API_KEY secret` → ลืม set secret หรือ deploy ก่อนตั้ง secret

---

## 🔐 Security notes

- API keys อยู่เฉพาะ Supabase secrets — ไม่ commit ลง repo
- Edge function ใช้ `SUPABASE_SERVICE_ROLE_KEY` (auto-injected) สำหรับ `admin.createUser` — bypass RLS, ห้าม leak
- Resend API key: แนะนำใช้ scope "Sending access" only — ไม่ใช่ Full access — เพื่อ minimize blast radius ถ้า leak
- CORS = `*` ตอนนี้; tighten ได้ในอนาคต โดยเปลี่ยนเป็น `https://jptrustlearning.github.io` หรือ custom domain

---

*v3 — switched welcome email from Gmail SMTP (nodemailer) to Resend HTTP API for better deliverability and simpler integration.*
