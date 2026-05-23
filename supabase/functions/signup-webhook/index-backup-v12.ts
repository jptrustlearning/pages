// Supabase Edge Function: signup-webhook  (v3 — Resend)
// Receives member signup data → (1) writes to jptrustlearning/payment GitHub repo,
// (2) auto-creates Supabase auth user (email_confirm=true), (3) sends welcome email
// via Resend HTTP API.
//
// Deploy:      supabase functions deploy signup-webhook
// Invoke:      POST https://<project>.supabase.co/functions/v1/signup-webhook
//
// Required secrets (set via `supabase secrets set KEY=VALUE`):
//   • GITHUB_PAT       GitHub fine-grained PAT with Contents R/W on jptrustlearning/payment
//   • RESEND_API_KEY   Resend API key (re_xxxxx) — must be from a verified domain account
//   • RESEND_FROM      Sender, e.g. "JP Trust Learning <noreply@jptrustlearning.com>"
//
// Auto-provided by Supabase runtime (no need to set):
//   • SUPABASE_URL
//   • SUPABASE_SERVICE_ROLE_KEY
//
// Migration notes (v2 → v3):
//   The legacy SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS secrets are no longer used
//   here. They can stay set or be removed; this function ignores them.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============ Config ============
const GITHUB_REPO = "jptrustlearning/payment";
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/contents`;
const PROMO_CODE = "JPTFREE2026";
const MAX_SLIP_BASE64 = 7 * 1024 * 1024; // ~5MB binary → ~6.7MB base64; pad to 7MB
const APP_URL = "https://jptrustlearning.github.io/pages/member-dashboard.html";
const EMAIL_FROM_NAME = "JP Trust Learning";
const EMAIL_SUBJECT = "ยินดีต้อนรับสู่ JP Trust Learning — เริ่มต้นใช้งานได้ทันที";
// Founders notified on every new signup. Override via FOUNDER_EMAILS secret
// (comma-separated) if it ever changes — falls back to these two otherwise.
const FOUNDER_EMAILS_DEFAULT = "Joonstinn@gmail.com,Watcharaphon0619@gmail.com";

// ============ CORS ============
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ============ Response helpers ============
function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function errResponse(status: number, message: string) {
  return jsonResponse(status, { ok: false, error: message });
}

// ============ GitHub helpers ============
async function ghGetFile(path: string, pat: string): Promise<{ sha: string; content: string } | null> {
  try {
    const r = await fetch(`${GITHUB_API}/${path}`, {
      headers: { Authorization: `Bearer ${pat}`, "User-Agent": "jpt-signup-webhook" },
    });
    if (!r.ok) return null;
    const d = await r.json();
    const raw = atob(String(d.content).replace(/\n/g, ""));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const content = new TextDecoder("utf-8").decode(bytes);
    return { sha: d.sha as string, content };
  } catch (_) {
    return null;
  }
}

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

async function ghPutText(path: string, content: string, message: string, pat: string, existingSha?: string): Promise<boolean> {
  const body: Record<string, string> = { message, content: utf8ToBase64(content) };
  if (existingSha) {
    body.sha = existingSha;
  } else {
    const ex = await ghGetFile(path, pat);
    if (ex) body.sha = ex.sha;
  }
  const r = await fetch(`${GITHUB_API}/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${pat}`,
      "Content-Type": "application/json",
      "User-Agent": "jpt-signup-webhook",
    },
    body: JSON.stringify(body),
  });
  return r.ok;
}

async function ghPutBinary(path: string, b64: string, message: string, pat: string): Promise<boolean> {
  const body: Record<string, string> = { message, content: b64 };
  const ex = await ghGetFile(path, pat);
  if (ex) body.sha = ex.sha;
  const r = await fetch(`${GITHUB_API}/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${pat}`,
      "Content-Type": "application/json",
      "User-Agent": "jpt-signup-webhook",
    },
    body: JSON.stringify(body),
  });
  return r.ok;
}

async function ghNextRunningNumber(pat: string): Promise<number> {
  try {
    const r = await fetch(`${GITHUB_API}/member-logs`, {
      headers: { Authorization: `Bearer ${pat}`, "User-Agent": "jpt-signup-webhook" },
    });
    if (!r.ok) return 1;
    const f = await r.json();
    if (!Array.isArray(f)) return 1;
    const nums = f
      .map((x: { name: string }) => x.name.match(/^member_regis_(\d+)_/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => parseInt(m[1], 10));
    return nums.length ? Math.max(...nums) + 1 : 1;
  } catch (_) {
    return 1;
  }
}

// ============ Supabase admin helper ============
type GrantResult = { granted: boolean; alreadyExisted: boolean; expiresAt?: string | null; error?: string };

// Find an existing auth user id by email (paginated). Used on renewal /
// re-signup so we can refresh the subscription metadata of an existing user.
// deno-lint-ignore no-explicit-any
async function findUserIdByEmail(admin: any, email: string): Promise<string | null> {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) return null;
    const u = (data.users || []).find(
      (x: { email?: string }) => String(x.email || "").toLowerCase() === email,
    );
    if (u) return u.id as string;
    if (!data.users || data.users.length < 200) break;
  }
  return null;
}

async function grantSupabaseUser(
  email: string,
  baseMeta: Record<string, unknown>,
  durationDays: number,
): Promise<GrantResult> {
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !svcKey) {
    return { granted: false, alreadyExisted: false, error: "missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" };
  }

  // Compute an expiry that EXTENDS from a base date (so renewals don't burn
  // remaining days). base = max(now, existing_expiry). If durationDays is 0
  // (legacy / no plan), expiry is null.
  const nowMs = Date.now();
  const computeExpiry = (existingExpiryISO: string | null | undefined): string | null => {
    if (!durationDays) return null;
    let baseMs = nowMs;
    if (existingExpiryISO) {
      const t = Date.parse(existingExpiryISO);
      if (!isNaN(t) && t > baseMs) baseMs = t; // not yet expired → extend from old expiry
    }
    return new Date(baseMs + durationDays * 86400000).toISOString();
  };

  try {
    const admin = createClient(supaUrl, svcKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ---- New user: expiry counts from now ----
    const freshMeta = { ...baseMeta, subscription_expires_at: computeExpiry(null) };
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: freshMeta,
    });
    if (error) {
      // Idempotent: if user already exists, treat as success (don't fail signup)
      const msg = String(error.message || "").toLowerCase();
      if (
        msg.includes("already") ||
        msg.includes("registered") ||
        msg.includes("duplicate") ||
        msg.includes("exists")
      ) {
        // ---- Renewal / re-signup: EXTEND from the user's current expiry ----
        const id = await findUserIdByEmail(admin, email);
        if (id) {
          // Read current expiry to extend from it (don't lose remaining days)
          let currentExpiry: string | null = null;
          try {
            const { data: got } = await admin.auth.admin.getUserById(id);
            const m = (got?.user?.app_metadata || {}) as Record<string, unknown>;
            currentExpiry = (m.subscription_expires_at as string) || null;
          } catch (_) { /* fall back to now */ }
          const renewMeta = { ...baseMeta, subscription_expires_at: computeExpiry(currentExpiry) };
          const { error: upErr } = await admin.auth.admin.updateUserById(id, { app_metadata: renewMeta });
          if (upErr) {
            return { granted: true, alreadyExisted: true, expiresAt: renewMeta.subscription_expires_at as string | null, error: `metadata update failed: ${upErr.message}` };
          }
          return { granted: true, alreadyExisted: true, expiresAt: renewMeta.subscription_expires_at as string | null };
        }
        return { granted: true, alreadyExisted: true, expiresAt: null };
      }
      return { granted: false, alreadyExisted: false, error: error.message };
    }
    return { granted: !!data?.user, alreadyExisted: false, expiresAt: freshMeta.subscription_expires_at as string | null };
  } catch (err) {
    return {
      granted: false,
      alreadyExisted: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============ Email helpers ============
type EmailResult = { sent: boolean; error?: string };

function buildWelcomeEmailText(username: string): string {
  const who = (username || "สมาชิก").trim();
  return `เรียน คุณ${who}

ขอขอบพระคุณที่ไว้วางใจสมัครสมาชิกกับ JP Trust Learning ค่ะ
การสมัครของคุณเสร็จสมบูรณ์เรียบร้อยแล้ว และบัญชีของคุณพร้อมใช้งานทันที

── ขั้นตอนการเข้าใช้งานครั้งแรก ──

1. เปิด Application JPTrust บนมือถือ
2. กรอก Email ที่ใช้สมัครสมาชิก (อีเมลฉบับนี้)
3. ระบบจะส่ง รหัสผ่าน OTP 6 หลัก กลับมายังอีเมลของคุณภายใน 1–2 นาที
4. นำรหัส OTP มากรอกเพื่อเข้าสู่ระบบ

หลังจาก Log in ครั้งแรก ระบบจะให้คุณตั้งรหัส PIN 6 หลัก
เพื่อใช้เปิดแอปในครั้งถัดไปได้อย่างสะดวก

เปิดแอป: ${APP_URL}

── สิ่งที่คุณจะได้รับ ──

• Roadmap 90 วัน สู่พอร์ตการลงทุนที่ยั่งยืน
• กลยุทธ์ Momentum & Gold Trading พร้อม Backtest
• Gold Signal และ SP500 Scanner
• Framework วางแผนการเงินและพอร์ตการลงทุนส่วนบุคคล

หากไม่ได้รับรหัส OTP ภายใน 5 นาที กรุณาตรวจสอบในโฟลเดอร์ Junk / Spam
หรือตอบกลับอีเมลฉบับนี้เพื่อแจ้งทีมงาน

ขอต้อนรับเข้าสู่ครอบครัว JP Trust Learning ค่ะ

ด้วยความเคารพ
ทีมงาน JP Trust Learning
www.jptrustlearning.com
`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildWelcomeEmailHtml(username: string): string {
  const who = escapeHtml((username || "สมาชิก").trim());
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(EMAIL_SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;font-family:'Sarabun','Segoe UI',Arial,sans-serif;background:#FAF6ED;color:#3D3228;-webkit-text-size-adjust:100%;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#FAF6ED;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td align="center" style="padding:28px 24px 24px;border-bottom:1.5px solid rgba(212,175,55,0.35);">
          <div style="display:inline-block;width:64px;height:64px;background:linear-gradient(135deg,#722F37 0%,#5A1F26 100%);border-radius:50%;line-height:64px;color:#D4AF37;font-size:20px;font-weight:700;letter-spacing:2px;font-family:'Times New Roman',serif;">JPT</div>
          <div style="margin-top:12px;font-size:11px;letter-spacing:3px;color:#8B6914;text-transform:uppercase;font-family:'Times New Roman',serif;">JP Trust Learning</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px 28px 8px;background:#FFFEF8;">
          <h1 style="margin:0 0 20px;font-size:22px;color:#5A3D20;font-weight:700;line-height:1.35;">ยินดีต้อนรับสู่ JP Trust Learning</h1>
          <p style="font-size:15px;line-height:1.75;color:#3D3228;margin:0 0 12px;">เรียน คุณ${who}</p>
          <p style="font-size:15px;line-height:1.75;color:#3D3228;margin:0 0 18px;">ขอขอบพระคุณที่ไว้วางใจสมัครสมาชิกกับ JP Trust Learning ค่ะ<br>การสมัครของคุณเสร็จสมบูรณ์เรียบร้อยแล้ว และบัญชีของคุณพร้อมใช้งานทันที</p>

          <!-- Steps section -->
          <div style="margin:24px 0 20px;padding:20px 22px;background:linear-gradient(180deg,#FFFEF8 0%,#F5EDD8 100%);border:1.5px solid rgba(212,175,55,0.40);border-radius:10px;">
            <div style="font-size:11px;letter-spacing:2px;color:#8B6914;text-transform:uppercase;margin-bottom:12px;font-weight:600;">ขั้นตอนการเข้าใช้งานครั้งแรก</div>
            <ol style="margin:0;padding-left:22px;font-size:14.5px;line-height:1.95;color:#3D3228;">
              <li>เปิด Application JPTrust บนมือถือ</li>
              <li>กรอก Email ที่ใช้สมัครสมาชิก (อีเมลฉบับนี้)</li>
              <li>ระบบจะส่ง <strong style="color:#722F37;">รหัสผ่าน OTP 6 หลัก</strong> กลับมายังอีเมลของคุณภายใน 1–2 นาที</li>
              <li>นำรหัส OTP มากรอกเพื่อเข้าสู่ระบบ</li>
            </ol>
          </div>

          <p style="font-size:13.5px;line-height:1.7;color:#7A6F62;margin:0 0 24px;font-style:italic;">หลังจาก Log in ครั้งแรก ระบบจะให้คุณตั้งรหัส PIN 6 หลัก เพื่อใช้เปิดแอปในครั้งถัดไปได้อย่างสะดวก</p>

          <!-- CTA -->
          <div style="text-align:center;margin:28px 0 20px;">
            <a href="${APP_URL}" style="display:inline-block;padding:14px 40px;background:linear-gradient(135deg,#722F37 0%,#5A1F26 100%);color:#E8D48B;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;letter-spacing:1.5px;font-family:'Sarabun','Segoe UI',sans-serif;">เริ่มต้นใช้งาน →</a>
          </div>

          <!-- Features -->
          <div style="margin:24px 0 8px;padding:20px 22px;background:#FAF6ED;border-left:3px solid #D4AF37;border-radius:6px;">
            <div style="font-size:11px;letter-spacing:2px;color:#8B6914;text-transform:uppercase;margin-bottom:12px;font-weight:600;">สิ่งที่คุณจะได้รับ</div>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="font-size:14px;line-height:1.85;color:#3D3228;">
              <tr><td style="padding:2px 0;"><span style="color:#D4AF37;margin-right:8px;">◆</span>Roadmap 90 วัน สู่พอร์ตการลงทุนที่ยั่งยืน</td></tr>
              <tr><td style="padding:2px 0;"><span style="color:#D4AF37;margin-right:8px;">◆</span>กลยุทธ์ Momentum &amp; Gold Trading พร้อม Backtest</td></tr>
              <tr><td style="padding:2px 0;"><span style="color:#D4AF37;margin-right:8px;">◆</span>Gold Signal และ SP500 Scanner</td></tr>
              <tr><td style="padding:2px 0;"><span style="color:#D4AF37;margin-right:8px;">◆</span>Framework วางแผนการเงินและพอร์ตการลงทุนส่วนบุคคล</td></tr>
            </table>
          </div>

          <p style="font-size:13px;line-height:1.7;color:#7A6F62;margin:24px 0 16px;">หากไม่ได้รับรหัส OTP ภายใน 5 นาที กรุณาตรวจสอบในโฟลเดอร์ Junk / Spam หรือตอบกลับอีเมลฉบับนี้เพื่อแจ้งทีมงาน</p>

          <p style="font-size:14.5px;line-height:1.75;color:#3D3228;margin:20px 0 0;">ขอต้อนรับเข้าสู่ครอบครัว JP Trust Learning ค่ะ</p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 24px 28px;background:#FFFEF8;border-top:1px solid rgba(212,175,55,0.25);text-align:center;">
          <div style="font-size:13px;color:#5A3D20;font-weight:600;">ด้วยความเคารพ<br>ทีมงาน JP Trust Learning</div>
          <div style="font-size:11px;color:#8B6914;margin-top:8px;letter-spacing:1.5px;font-family:'Times New Roman',serif;">www.jptrustlearning.com</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendWelcomeEmail(email: string, username: string): Promise<EmailResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM") || `${EMAIL_FROM_NAME} <onboarding@resend.dev>`;
  if (!apiKey) {
    return { sent: false, error: "missing RESEND_API_KEY secret" };
  }

  try {
    // Resend HTTP API — modern transactional email service. Handles UTF-8 (Thai)
    // natively, no RFC 2047 encoding tricks needed. Returns { id } on success,
    // structured error JSON on failure.
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: EMAIL_SUBJECT,
        text: buildWelcomeEmailText(username),
        html: buildWelcomeEmailHtml(username),
        // RFC 2369 / 8058 — signals to Gmail/Outlook this is a managed
        // sender that respects user opt-out. Lowers spam-filter risk
        // even for transactional welcome mail. mailto: form (no
        // List-Unsubscribe-Post) because we don't have a one-click
        // HTTP endpoint yet — admin processes opt-outs manually.
        headers: {
          "List-Unsubscribe": "<mailto:jptrustlearning@gmail.com?subject=Unsubscribe%20JP%20Trust%20Learning>",
          "List-ID": "JP Trust Learning Membership <members.jptrustlearning.com>",
        },
      }),
    });

    if (!res.ok) {
      let detail = "";
      try {
        const j = await res.json();
        detail = j.message || j.error || JSON.stringify(j);
      } catch (_) {
        detail = await res.text();
      }
      return { sent: false, error: `Resend ${res.status}: ${detail}` };
    }

    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============ Founder notification (internal) ============
// Fires on every successful new signup so the founders see who joined, which
// plan, how much is owed, and whether a slip was attached. Best-effort: never
// blocks the signup response. reply-to = the customer so founders can reply
// straight to them.
interface FounderInfo {
  username: string; email: string; age: number | null; plan: string;
  basePrice: number; amount: number; promoCode: string; promoApplied: boolean;
  refCode: string; slipName: string | null; expiresAt: string | null;
  slipBase64: string | null;   // raw base64 (no data: prefix) — attached to the email
}
async function sendFounderNotification(info: FounderInfo): Promise<EmailResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM") || `${EMAIL_FROM_NAME} <onboarding@resend.dev>`;
  const recipients = (Deno.env.get("FOUNDER_EMAILS") || FOUNDER_EMAILS_DEFAULT)
    .split(",").map((x) => x.trim()).filter(Boolean);
  if (!apiKey) return { sent: false, error: "missing RESEND_API_KEY secret" };
  if (recipients.length === 0) return { sent: false, error: "no founder recipients" };

  const planLabel = info.plan === "yearly" ? "รายปี (Yearly)" : info.plan === "monthly" ? "รายเดือน (Monthly)" : "—";
  const promoLine = info.promoApplied && info.promoCode ? `${info.promoCode} (ใช้งานแล้ว)` : "ไม่มี";
  const slipLine = info.slipBase64 ? (info.slipName ? info.slipName + " (แนบมาในอีเมลนี้)" : "แนบมาในอีเมลนี้") : "ไม่มีสลิปแนบ";
  const fmtBaht = (n: number) => "฿" + Number(n || 0).toLocaleString("en-US");
  const subject = `🔔 สมาชิกใหม่: ${info.username} · ${planLabel} · ${fmtBaht(info.amount)}`;

  const text = [
    "มีสมาชิกสมัครใหม่ใน JP Trust Learning",
    "",
    `ชื่อผู้ใช้: ${info.username}`,
    `อีเมล: ${info.email}`,
    `อายุ: ${info.age ?? "—"}`,
    `แพ็กเกจ: ${planLabel}`,
    `ราคาปกติ: ${fmtBaht(info.basePrice)}`,
    `ยอดที่ต้องชำระ: ${fmtBaht(info.amount)}`,
    `โปรโมชัน: ${promoLine}`,
    `สลิป: ${slipLine}`,
    `รหัสอ้างอิง: ${info.refCode}`,
    `สมาชิกหมดอายุ: ${info.expiresAt ?? "—"}`,
    "",
    "— ระบบแจ้งเตือนอัตโนมัติ JP Trust Learning",
  ].join("\n");

  const esc = (x: string) => escapeHtml(String(x ?? ""));
  const row = (k: string, v: string) =>
    `<tr><td style="padding:7px 14px;color:#7A6F62;font-size:13px;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:7px 14px;color:#1a0a0e;font-size:14px;font-weight:600">${v}</td></tr>`;
  const html = `<div style="font-family:'Sarabun',Arial,sans-serif;background:#FAF6ED;padding:24px">
    <div style="max-width:520px;margin:0 auto;background:#FFFEF8;border:1.5px solid rgba(212,175,55,0.4);border-radius:14px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#1a0a0e,#722F37);padding:18px 22px">
        <div style="color:#D4AF37;font-size:12px;letter-spacing:2px;text-transform:uppercase">JP Trust Learning</div>
        <div style="color:#F4E4BA;font-size:19px;font-weight:700;margin-top:3px">🔔 มีสมาชิกสมัครใหม่</div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin:8px 0">
        ${row("ชื่อผู้ใช้", esc(info.username))}
        ${row("อีเมล", esc(info.email))}
        ${row("อายุ", info.age != null ? String(info.age) : "—")}
        ${row("แพ็กเกจ", esc(planLabel))}
        ${row("ราคาปกติ", fmtBaht(info.basePrice))}
        ${row("ยอดที่ต้องชำระ", `<span style="color:#1F7D49">${fmtBaht(info.amount)}</span>`)}
        ${row("โปรโมชัน", esc(promoLine))}
        ${row("สลิป", esc(slipLine))}
        ${row("รหัสอ้างอิง", esc(info.refCode))}
        ${row("สมาชิกหมดอายุ", esc(info.expiresAt ?? "—"))}
      </table>
      <div style="padding:10px 22px 18px;color:#A09B92;font-size:11.5px;border-top:1px solid rgba(212,175,55,0.2)">ระบบแจ้งเตือนอัตโนมัติ — ตอบกลับอีเมลนี้เพื่อติดต่อสมาชิกได้โดยตรง</div>
    </div>
  </div>`;

  // Attach the payment slip image when present. Resend expects { content, filename }
  // where content is Base64 (no data: prefix) — exactly what slipBase64 already is.
  const attachments: Array<{ content: string; filename: string }> = [];
  if (info.slipBase64) {
    const ext = (info.slipName || "").split(".").pop() || "jpg";
    attachments.push({
      content: info.slipBase64,
      filename: `slip_${info.refCode || "member"}.${ext}`,
    });
  }

  const payload: Record<string, unknown> = { from, to: recipients, reply_to: info.email, subject, text, html };
  if (attachments.length > 0) payload.attachments = attachments;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let detail = "";
      try { const j = await res.json(); detail = j.message || j.error || JSON.stringify(j); }
      catch (_) { detail = await res.text(); }
      return { sent: false, error: `Resend ${res.status}: ${detail}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============ Promo reservation (atomic, via SECURITY DEFINER RPC) ============
type PromoResult = {
  ok: boolean;
  reason: string;
  discountType: string | null;
  discountValue: number;
  basePrice: number;
  finalPrice: number;
  slipRequired: boolean;
};

// Calls reserve_promo() which atomically re-validates AND consumes one quota
// slot. Service-role only. Returns the locked-in price + whether a slip is
// still required (free codes don't need one; discounted codes do).
async function reservePromo(code: string, plan: string): Promise<PromoResult | null> {
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !svcKey) return null;
  try {
    const admin = createClient(supaUrl, svcKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin.rpc("reserve_promo", { p_code: code, p_plan: plan });
    if (error) {
      console.error("[promo] reserve_promo RPC error:", error.message);
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    return {
      ok: !!row.reserved,
      reason: String(row.reason || ""),
      discountType: row.discount_type ?? null,
      discountValue: Number(row.discount_value || 0),
      basePrice: Number(row.base_price || 0),
      finalPrice: Number(row.final_price || 0),
      slipRequired: !!row.slip_required,
    };
  } catch (err) {
    console.error("[promo] reserve error:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ============ Handler ============
serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errResponse(405, "Method not allowed");
  }

  const GITHUB_PAT = Deno.env.get("GITHUB_PAT");
  if (!GITHUB_PAT) {
    console.error("GITHUB_PAT secret not set");
    return errResponse(500, "Server not configured (missing GITHUB_PAT)");
  }

  // ---------- Parse body ----------
  let body: {
    email?: string;
    username?: string;
    age?: number | string;
    promoCode?: string;
    plan?: string;
    amount?: number | string;
    slipBase64?: string | null;
    slipFilename?: string | null;
  };
  try {
    body = await req.json();
  } catch (_) {
    return errResponse(400, "Invalid JSON body");
  }

  const email = String(body.email || "").trim().toLowerCase();
  const username = String(body.username || "").trim();
  const ageRaw = body.age;
  const promoCode = String(body.promoCode || "").trim().toUpperCase();
  const slipBase64 = body.slipBase64 || null;
  const slipFilename = body.slipFilename || null;

  // Plan the member signed up for. The price ALWAYS comes from the server-side
  // table / promo RPC — never from the client.
  const planRaw = String(body.plan || "").trim().toLowerCase();
  const plan = planRaw === "yearly" ? "yearly" : planRaw === "monthly" ? "monthly" : "";
  const PLAN_PRICES: Record<string, number> = { monthly: 150, yearly: 1400 };
  const basePrice = plan ? PLAN_PRICES[plan] : 0;

  // ---------- Basic validation (before consuming any promo quota) ----------
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) return errResponse(400, "รูปแบบอีเมลไม่ถูกต้อง");
  if (!username) return errResponse(400, "กรุณากรอกชื่อผู้ใช้");
  if (username.length > 40) return errResponse(400, "ชื่อผู้ใช้ยาวเกินไป (สูงสุด 40 ตัวอักษร)");

  const ageNum = typeof ageRaw === "number" ? ageRaw : parseInt(String(ageRaw), 10);
  if (isNaN(ageNum) || ageNum < 10 || ageNum > 99) {
    return errResponse(400, "อายุไม่ถูกต้อง (10-99)");
  }

  if (slipBase64 && slipBase64.length > MAX_SLIP_BASE64) {
    return errResponse(413, "ไฟล์สลิปใหญ่เกิน 5MB");
  }

  // ---------- Resolve promo + price (ATOMIC quota consume) ----------
  // amount = what the member must actually pay. promoFree = code waives slip.
  let amount = basePrice;
  let promoApplied = false;
  let promoFree = false;
  let promoDiscountType: string | null = null;
  let promoDiscountValue = 0;

  if (promoCode) {
    const r = await reservePromo(promoCode, plan);
    if (r === null) {
      // RPC unreachable/misconfigured. Don't silently let people in free —
      // fail closed for promo, but allow the legacy beta code as a fallback so
      // we never hard-block during infra hiccups while the only code is free.
      if (promoCode === PROMO_CODE) {
        promoApplied = true; promoFree = true; amount = 0; promoDiscountType = "free";
      } else {
        return errResponse(503, "ระบบตรวจสอบรหัสโปรโมชันไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่");
      }
    } else if (!r.ok) {
      const map: Record<string, string> = {
        invalid: "รหัสโปรโมชันไม่ถูกต้อง",
        expired: "รหัสโปรโมชันหมดอายุแล้ว",
        not_started: "รหัสโปรโมชันยังไม่เริ่มใช้งาน",
        wrong_plan: "รหัสโปรโมชันใช้กับแพ็กเกจนี้ไม่ได้",
        sold_out: "รหัสโปรโมชันถูกใช้ครบจำนวนสิทธิ์แล้ว",
        empty: "กรุณากรอกรหัสโปรโมชัน",
      };
      return errResponse(409, map[r.reason] || "รหัสโปรโมชันใช้ไม่ได้");
    } else {
      promoApplied = true;
      amount = r.finalPrice;
      promoFree = !r.slipRequired; // free code → slip not required
      promoDiscountType = r.discountType;
      promoDiscountValue = r.discountValue;
    }
  }

  // Slip is required unless a FREE code was applied.
  if (!slipBase64 && !promoFree) {
    return errResponse(400, "กรุณาแนบสลิปการโอนเงิน");
  }

  // promoValid kept for downstream references (true for any successfully applied code)
  const promoValid = promoApplied;

  // ---------- Generate ref code ----------
  const now = new Date();
  const timestamp = now.toISOString();
  const dateStr = timestamp.slice(0, 10).replace(/-/g, "");
  const runNum = await ghNextRunningNumber(GITHUB_PAT);
  const runStr = String(runNum).padStart(4, "0");
  const refCode = `JPM-${dateStr}-${runStr}`;
  const safeEmail = email.replace(/[^a-zA-Z0-9@._-]/g, "_");

  // ---------- Write signup data to GitHub (hard requirement) ----------
  try {
    const slipName = slipFilename || (promoValid ? "PROMO_BYPASS" : "");

    // 1. Append CSV
    const csvQ = (v: unknown) => '"' + String(v).replace(/"/g, '""') + '"';
    const csvLine = [runStr, timestamp, email, username, ageNum, refCode, promoCode, slipName, "pending", plan, basePrice, amount]
      .map(csvQ)
      .join(",");
    const existingCSV = await ghGetFile("member-registration.csv", GITHUB_PAT);
    const csvContent = existingCSV
      ? existingCSV.content.trimEnd() + "\n" + csvLine
      : "id,timestamp,email,username,age,ref_code,promo_code,slip_filename,status,plan,base_price,amount_due\n" + csvLine;
    const csvOk = await ghPutText(
      "member-registration.csv",
      csvContent,
      `Member registration: ${refCode}`,
      GITHUB_PAT,
      existingCSV?.sha,
    );
    if (!csvOk) throw new Error("CSV write failed");

    // 2. Slip binary (if provided) — BEFORE grant so a slip failure aborts the whole signup
    if (slipBase64) {
      const ext = (slipFilename || "").split(".").pop() || "jpg";
      const slipOk = await ghPutBinary(
        `member-slips/slip_${runStr}_${safeEmail}.${ext}`,
        slipBase64,
        `Member slip: ${refCode}`,
        GITHUB_PAT,
      );
      if (!slipOk) throw new Error("Slip upload failed");
    }

    // ───────────────────────────────────────────────────────────────────────
    // 🔌 FUTURE HOOK — automatic slip amount / authenticity verification
    // ───────────────────────────────────────────────────────────────────────
    // Right now slips are reviewed MANUALLY by an admin against `amount` above
    // (the price for the chosen `plan`). When ready to automate, plug a Thai
    // slip-verify provider in HERE — verify BEFORE grantSupabaseUser() so a
    // failed / short / forged slip blocks the account grant.
    //
    // Recommended: SlipOK or EasySlip. They re-check the slip's QR against the
    // Bank of Thailand network and return the real amount + sender/receiver +
    // authenticity. Do NOT use generic AI-vision OCR: it can't detect forged
    // slips and is less exact on amounts. Keep the provider key in a Supabase
    // secret (e.g. SLIP_VERIFY_KEY) — never client-side.
    //
    // Sketch (uncomment + implement verifySlip() when ready):
    //   if (slipBase64 && !promoValid) {
    //     const v = await verifySlip(slipBase64);              // call provider
    //     if (!v.ok)             return errResponse(402, "ตรวจสอบสลิปไม่สำเร็จ");
    //     if (v.amount < amount) return errResponse(402, `ยอดโอนไม่ครบ (ได้ ${v.amount}/${amount} บาท)`);
    //     // optionally: check v.receiver === OUR_ACCOUNT and that v.ref is not reused
    //   }
    // ───────────────────────────────────────────────────────────────────────

    // ---------- Compute subscription window ----------
    // monthly = +30 days, yearly = +365 days. On RENEWAL the expiry EXTENDS from
    // the user's existing expiry (computed inside grantSupabaseUser via
    // max(now, existing_expiry) + durationDays) so remaining days aren't lost.
    // If the old sub already lapsed, it counts from now instead.
    const SUB_DAYS: Record<string, number> = { monthly: 30, yearly: 365 };
    const durationDays = plan ? SUB_DAYS[plan] : 0;
    const startedAt = timestamp;
    const baseMeta: Record<string, unknown> = {
      username,                   // registration name → used as the default member name in-app
      plan: plan || null,
      amount,                     // = amount_due (what they must actually pay)
      amount_due: amount,
      base_price: basePrice,
      promo_applied: promoValid,
      promo_code: promoCode || null,
      promo_discount_type: promoDiscountType,
      promo_discount_value: promoDiscountValue,
      ref_code: refCode,
      subscription_status: "active",
      subscription_started_at: startedAt,
    };

    // ---------- Auto-grant Supabase user (best-effort, never blocks signup) ----------
    const grant = await grantSupabaseUser(email, baseMeta, durationDays);
    // The authoritative expiry is whatever grant actually stored (extended on renewal)
    const expiresAt = grant.expiresAt ?? null;
    if (grant.granted) {
      console.log(`[grant] ${email} — ${grant.alreadyExisted ? "renewed" : "created"} · expires ${expiresAt ?? "—"}`);
    } else {
      console.error(`[grant] FAILED for ${email}: ${grant.error}`);
    }

    // ---------- Send welcome email (best-effort, never blocks signup) ----------
    const mail = await sendWelcomeEmail(email, username);
    if (mail.sent) {
      console.log(`[email] welcome sent to ${email}`);
    } else {
      console.error(`[email] FAILED for ${email}: ${mail.error}`);
    }

    // ---------- Notify founders (best-effort, never blocks signup) ----------
    const founderMail = await sendFounderNotification({
      username, email, age: ageNum, plan, basePrice, amount,
      promoCode, promoApplied: promoValid, refCode,
      slipName, expiresAt, slipBase64,
    });
    if (founderMail.sent) {
      console.log(`[email] founder notification sent for ${email}`);
    } else {
      console.error(`[email] founder notification FAILED for ${email}: ${founderMail.error}`);
    }

    // 3. JSON log — written LAST so it captures grant + email outcomes
    const logData = {
      id: runStr,
      ref_code: refCode,
      timestamp,
      username,
      age: ageNum,
      email,
      promo_code: promoCode,
      promo_applied: promoValid,
      plan: plan || null,
      amount,
      base_price: basePrice,
      amount_due: amount,
      promo_discount_type: promoDiscountType,
      promo_discount_value: promoDiscountValue,
      subscription: {
        status: "active",
        started_at: startedAt,
        expires_at: expiresAt,
        duration_days: durationDays,
      },
      slip_filename: slipName,
      status: "pending",
      confirmations: {
        slip_attached: !!slipBase64 || promoValid,
        payment_made: true,
      },
      auto_grant: {
        granted: grant.granted,
        already_existed: grant.alreadyExisted,
        error: grant.error || null,
      },
      welcome_email: {
        sent: mail.sent,
        error: mail.error || null,
      },
    };
    const logOk = await ghPutText(
      `member-logs/member_regis_${runStr}_${safeEmail}.json`,
      JSON.stringify(logData, null, 2),
      `Member log: ${refCode}`,
      GITHUB_PAT,
    );
    if (!logOk) {
      // Don't fail signup — user has already been created + email sent
      console.error(`[log] failed to write JSON log for ${refCode}`);
    }

    return jsonResponse(200, {
      ok: true,
      refCode,
      timestamp,
      granted: grant.granted,
      emailSent: mail.sent,
    });
  } catch (err) {
    console.error("Signup webhook error:", err);
    return errResponse(500, `บันทึกข้อมูลไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
  }
});
