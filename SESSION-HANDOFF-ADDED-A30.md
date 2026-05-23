# SESSION HANDOFF — ADDED A30

**Date:** 2026-05-23 (Asia/Bangkok)
**Repo:** `jptrustlearning/pages` · all work pushed to `main`
**Theme:** New `/new` entry page · signup UX (30s prep hold, Krungsri logo) ·
username→member-name · founder signup email (+ slip attachment) ·
**membership-expiry surfaced everywhere** (success modal + PDF + Settings) ·
**home near-expiry banner + renew flow**

> ⚠️ **ONE PENDING ACTION before everything works: redeploy the Edge Function.**
> Four features in this session touch `supabase/functions/signup-webhook/index.ts`
> and need a redeploy. See **§8 Deploy** below. Front-end pieces are already live.

---

## TL;DR

Worked through the new-member funnel and the membership-expiry story end to end:

1. **`/new`** — a clean new-member landing page (just a "สมัครสมาชิก" button).
2. **signup.html** — 30-second account-prep hold on success (stops premature
   "user not found"), Krungsri logo in the bank box, and the success modal +
   downloadable PDF now show the **membership expiry date**.
3. **member-dashboard.html** — login no longer auto-redirects on a mistyped email
   (soft notice instead); signup **username becomes the in-app member name**;
   Settings gained a **"สมาชิกของคุณ"** card (signup date / promo / expiry +
   days-left badge) and a **"ต่ออายุสมาชิก"** row; the **home screen shows a
   near-expiry banner** (≤14 days) that links to renewal.
4. **Edge Function** — stores `username` in `app_metadata`; **emails the two
   founders on every new signup with the payment slip attached**; returns
   subscription dates in the signup response.

HEAD at handoff: **`a07adca`**.

---

## 1. New entry page `/new` (`new.html`)

- Brand-new file `new.html` → served at `app.jptrustlearning.com/new` (and
  `…github.io/pages/new.html`). Maroon-gradient theme matching the login screen.
- **Final form (after one iteration):** NO email field — just a single
  **"สมัครสมาชิก"** button → `signup.html?v=<bust>` + a "มีบัญชีอยู่แล้ว? เข้าสู่
  ระบบ" link → `member-dashboard.html`. (First version had an email field that
  forwarded `?email=`; removed because the funnel already asks for email too
  many times.)
- Owl logo with `JPT` text fallback on image error.

## 2. signup.html — success flow rework

- **Install prompt MOVED then REMOVED.** Briefly added a PWA install card +
  manifest + SW register to the success modal; then **removed all of it** at
  Joon's request (manifest link, `serviceWorker.register`, `beforeinstallprompt`,
  `signupInstall()` all gone). signup.html has **no SW/manifest** again.
- **30-second account-prep hold** (`startSignupPrep()`): on success the modal
  shows a progress bar "กำลังเตรียมบัญชีของคุณ • NN วินาที". During the hold only
  **"ดาวน์โหลดใบยืนยัน"** is clickable; after 30s the bar turns green and a
  **"เริ่มต้นใช้งาน"** button (`#enterAppBtn`) appears → `goToLogin()`. Removed the
  old immediately-clickable "ย้อนกลับเข้าแอพ" button. Rationale: give the backend
  time to finish creating the auth user so a fast tap doesn't hit OTP before the
  user exists. Bar is thick (16px) glossy-green with a sweeping sheen
  (`prepSheen`) + pulsing glow (`prepGlow`).
- **Krungsri logo** added to the bank-transfer box: 44px rounded chip
  (`.bank-logo`, `object-fit:cover`) beside "ธนาคารกรุงศรีอยุธยา", wrapped with the
  holder name in a `.bank-id` group. Asset committed as **`krungsri-logo.jpg`**.
- **Expiry on success + PDF** (see §6). Copy reworded from "รอตรวจสอบ 24 ชม." →
  "บัญชีเปิดใช้งานแล้ว เริ่มต้นใช้งานได้ทันที / ทีมงานจะตรวจสอบการชำระเงินภายหลัง"
  (matches the revoke-later model). PDF status flipped รอตรวจสอบ → **เปิดใช้งานแล้ว**.

## 3. Login — soft email-not-found (member-dashboard.html)

- Previously: `sendOTP()` on a user-not-found / "not allowed" error **auto-
  redirected to signup** (via `jptRedirectModal`). This scared real members who
  simply mistyped their email ("ฉันไม่ใช่สมาชิกเหรอ?").
- Now: shows an **inline notice** under the email field (`#emailNotFound`):
  "ไม่พบอีเมลนี้ในระบบ" + a "สมัครสมาชิกด้วยอีเมลนี้" button (`goSignupFromLogin()`,
  pre-fills the typed email) + "ลองพิมพ์ใหม่". Notice auto-hides on input
  (`hideEmailNotFound()`). `jptRedirectModal` markup left in place but no longer
  triggered. Helper fns: `showEmailNotFound` / `hideEmailNotFound` /
  `goSignupFromLogin`.

## 4. Username → in-app member name

- **Edge Function**: `username` now added to `baseMeta` → stored in the auth
  user's `app_metadata`.
- **member-dashboard**: `loadSettingsFromCloud()` defaults `userSettings.name`
  to `app_metadata.username` **only when the user hasn't set their own name**
  (a name in `user_settings` always wins). `showApp()` re-applies after cloud
  load so brand-new users see their signup name immediately.
- **Existing users** (signed up before this) have no `username` in metadata →
  still "Member" until they set a name. Optional backfill: map email→username
  from `member-registration.csv` (in `jptrustlearning/payment`) and
  `updateUserById`. NOT done yet.

## 5. Founder notification email (+ slip attachment)

- New `sendFounderNotification()` in the Edge Function fires after the welcome
  email on **every successful signup**. Recipients default to
  **`Joonstinn@gmail.com, Watcharaphon0619@gmail.com`** (override via optional
  `FOUNDER_EMAILS` secret, comma-separated).
- Thai HTML + plain-text summary: username, email, age, plan, base price, amount
  due, promo, slip filename, ref code, expiry. `reply_to` = the customer.
- **Payment slip image is attached** when present: Resend `attachments:
  [{content: <base64>, filename: slip_<refCode>.<ext>}]`. `slipBase64` is raw
  base64 (no `data:` prefix — signup strips it with `.split(',')[1]`), exactly
  Resend's expected format. Slip row reads "(แนบมาในอีเมลนี้)".
- Best-effort — never blocks signup. Uses the same Resend key as the welcome
  email; no new secret required.
- ⚠️ If `RESEND_FROM` is still the `onboarding@resend.dev` sandbox sender, Resend
  may only deliver to the Resend account owner. If founder mail doesn't arrive,
  set up a verified domain in Resend (welcome email has the same constraint).

## 6. Membership expiry — surfaced in 3 places

Model confirmed by Joon: **account is active immediately on signup, expiry
counts from the signup date, revoke later if payment is bad.**

- **Edge Function response** now also returns: `plan`, `startedAt`, `expiresAt`,
  `promoCode`, `promoApplied` (all server-computed, authoritative).
- **signup success modal**: new `#subSummary` box — วันที่สมัคร / โปรโมชัน (if any)
  / สมาชิกหมดอายุ / ระยะเวลาสมาชิก. Filled by `renderSubSummary()` from
  `window._lastReg` (which now carries `expiresAt`/`startedAt`/`promoApplied`).
- **PDF cert** (`downloadPDF()`): added a **สมาชิกหมดอายุ** row (green) and the
  status row now says **เปิดใช้งานแล้ว**.
- **Settings → "สมาชิกของคุณ" card** (member-dashboard): วันที่สมัคร
  (`#memStarted`, from `subscription_started_at`) / โปรโมชันที่ใช้ (`#memPromo`,
  shown only if `promo_applied`) / สมาชิกหมดอายุ (`#memExpiry`) + a days-left
  badge (`#memDaysBadge`: green normal / amber ≤14d / red expired). Rendered by
  `renderMembershipCard(meta)`, hooked into `enforceSubscription()` (reuses the
  `getUser()` it already calls — no extra round-trip). `app_metadata` already
  carries `subscription_started_at`, `plan`, `promo_code`, `promo_applied`,
  `subscription_expires_at`, `subscription_status`.

## 7. Home near-expiry banner + renew flow

- **Renewal needs NO new system.** Backend `computeExpiry()` already **extends
  from the existing expiry** when the same email re-signs up (doesn't burn
  remaining days): `base = max(now, existing_expiry)` then `+ durationDays`. So
  **renew = `signup.html?email=<member>`** — same as the existing expired-gate
  button (`jptRenewBtn`).
- **Home banner** (`#expiryBanner`, first child of `.home-content`): hidden when
  >14 days left; amber "สมาชิกเหลืออีก N วัน · หมดอายุ <date>" at ≤14 days; red
  "สมาชิกหมดอายุแล้ว" when past (pre-revoke grace). Tap anywhere → `goRenew()`.
  Driven by `renderHomeExpiryBanner(daysLeft, expStr)`, called from inside
  `renderMembershipCard()`.
- **Settings**: new **"ต่ออายุสมาชิก"** row in the membership card → `goRenew()`.
- `goRenew()` routes to `signup.html?v=<bust>&email=<member>`; email comes from
  `_renewEmail` (set to `user.email` inside `enforceSubscription`) with fallback
  to `userSettings.email`.

---

## 8. ⚠️ DEPLOY — required for §4, §5, §6 to take effect

The front-end is fully live (push → GitHub Pages + Cloudflare auto-deploy). But
the Edge Function changes (username storage, founder email, slip attachment,
expiry response fields) need a **manual redeploy**:

```powershell
cd C:\Users\PC\Documents\pages
git pull origin main
supabase functions deploy signup-webhook
```

No new secrets are required. `FOUNDER_EMAILS` is **optional** (defaults are
hard-coded). Existing secrets in use: `GITHUB_PAT`, `RESEND_API_KEY`,
`RESEND_FROM`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

**What works without deploy:** Settings "สมาชิกของคุณ" card + home banner + renew
buttons (they read existing `app_metadata`). **What needs deploy:** username as
member name for NEW signups, founder emails, slip attachments, and the expiry
shown on the success modal + PDF (those read the new response fields).

---

## 9. Current state / file versions

- **HEAD:** `a07adca`
- **Backups (next number):** signup → **v17**; member-dashboard → **v193**;
  edge `index` → **v13**. (Latest existing: signup-backup-v16, member-dashboard-
  backup-v192, index-backup-v12.ts.)
- **Last cache-bust timestamp used:** `1779548893` (signup.html?v= refs in
  member-dashboard ×4 + new.html ×1).
- **New asset:** `krungsri-logo.jpg`.
- **New page:** `new.html` (`/new`).
- Pre-existing harmless dup ID in member-dashboard: `editValue` ×3 (edit-modal
  inputs — not introduced this session, ignore).

---

## 10. NEXT — two features to build (fresh chat)

Both are real backend builds; do them one at a time. Spec below so the next chat
can start cold.

### A) Automatic near-expiry reminder email  *(bigger lift — needs a cron)*

- **Goal:** auto-email members whose `subscription_expires_at` is N days away
  (e.g. 7 and/or 1 day before), in Thai, with a renew link
  (`app.jptrustlearning.com/new` or `signup.html?email=`).
- **Architecture:** a NEW scheduled Edge Function (e.g. `expiry-reminder`) that:
  1. enumerates auth users (reuse the paginated `listUsers` pattern already in
     `signup-webhook` — `admin.auth.admin.listUsers({page, perPage:200})`),
  2. filters by `app_metadata.subscription_expires_at` within the target window
     and `subscription_status !== 'revoked'`,
  3. sends a reminder via Resend (reuse `RESEND_API_KEY`/`RESEND_FROM`),
  4. **records that a reminder was sent to avoid duplicates** — write a marker
     into `app_metadata` (e.g. `last_reminder_sent_at` / `reminder_stage`) via
     `updateUserById`, and skip if already sent for this window.
- **Scheduling:** Joon must enable a daily trigger — Supabase **Scheduled
  Functions** (cron) or `pg_cron` calling the function URL. Document the exact
  cron setup in that chat.
- **Watch out:** sandbox `RESEND_FROM` deliverability (see §5); idempotency so a
  daily run doesn't spam; timezone (compute "days left" in a stable way, prefer
  UTC ms math like the app does).

### B) Admin view of members nearing expiry  *(medium — no cron)*

- **Goal:** a page/list Joon can open to see who's expiring soon / already
  expired, sorted, so they can decide who to contact or follow up.
- **Architecture:** must NOT put the service-role key in the client. Either:
  - an Edge Function `admin-members` (service-role) that returns a JSON list
    (email, username, plan, started_at, expires_at, days_left, status),
    protected by a shared admin token / password passed in a header, **OR**
  - a Supabase SQL view + RLS limited to an admin role.
- **Front-end:** a simple protected `admin.html` (maroon/gold theme) that calls
  the function, shows a sortable table with days-left badges (reuse the
  green/amber/red badge styling from the Settings card), and a quick filter
  ("≤14 วัน" / "หมดอายุแล้ว" / "ทั้งหมด").
- **Watch out:** keep it behind a token; don't expose all users publicly. Decide
  with Joon how admins authenticate.

---

## 11. Reminders / conventions used this session

- `git pull --rebase` before every push (news commits land on `main` often — saw
  several interleave during this session).
- Backup file committed separately BEFORE each feature commit (incrementing N).
- Large-file edits done via Python `str.replace()` with `assert old in html`
  guards (more reliable than the str_replace tool on the 2,600-line dashboard).
- Validation each step: tag balance (`<div>` etc. == 0), dup-ID scan, and JS
  `node --check` on concatenated inline `<script>` blocks.
- **Edge Function (TS) syntax checked with esbuild** (`esbuild.transform(code,
  {loader:'ts'})`) since `deno` can't be installed here (deno.land not in the
  allowed network domains). Brace/paren/backtick balance also checked.
- Cache-bust via Python regex on `signup.html?v=\d+` across member-dashboard +
  new.html, using `date +%s`.
