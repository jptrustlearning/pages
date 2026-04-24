// Supabase Edge Function: signup-webhook  (v2)
// Receives member signup data → (1) writes to jptrustlearning/payment GitHub repo,
// (2) auto-creates Supabase auth user (email_confirm=true), (3) sends welcome email
// via Gmail SMTP.
//
// Deploy:      supabase functions deploy signup-webhook
// Invoke:      POST https://<project>.supabase.co/functions/v1/signup-webhook
//
// Required secrets (set via `supabase secrets set KEY=VALUE`):
//   • GITHUB_PAT            GitHub fine-grained PAT with Contents R/W on jptrustlearning/payment
//   • SMTP_HOST             e.g. smtp.gmail.com
//   • SMTP_PORT             e.g. 465   (465 = implicit TLS, 587 = STARTTLS)
//   • SMTP_USER             e.g. jptrustlearning@gmail.com
//   • SMTP_PASS             Gmail App Password (16 chars, no spaces)
//
// Auto-provided by Supabase runtime (no need to set):
//   • SUPABASE_URL
//   • SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

// ============ Config ============
const GITHUB_REPO = "jptrustlearning/payment";
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/contents`;
const PROMO_CODE = "JPTGOLD2026";
const MAX_SLIP_BASE64 = 7 * 1024 * 1024; // ~5MB binary → ~6.7MB base64; pad to 7MB
const APP_URL = "https://jptrustlearning.github.io/pages/member-dashboard.html";
const EMAIL_FROM_NAME = "JP Trust Learning";
const EMAIL_SUBJECT = "ยินดีต้อนรับสู่ JP Trust Learning — เริ่มต้นใช้งานได้ทันที";

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
type GrantResult = { granted: boolean; alreadyExisted: boolean; error?: string };

async function grantSupabaseUser(email: string): Promise<GrantResult> {
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !svcKey) {
    return { granted: false, alreadyExisted: false, error: "missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" };
  }
  try {
    const admin = createClient(supaUrl, svcKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
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
        return { granted: true, alreadyExisted: true };
      }
      return { granted: false, alreadyExisted: false, error: error.message };
    }
    return { granted: !!data?.user, alreadyExisted: false };
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
jptrustlearning.github.io
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
          <div style="font-size:11px;color:#8B6914;margin-top:8px;letter-spacing:1.5px;font-family:'Times New Roman',serif;">jptrustlearning.github.io</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendWelcomeEmail(email: string, username: string): Promise<EmailResult> {
  const host = Deno.env.get("SMTP_HOST");
  const portStr = Deno.env.get("SMTP_PORT");
  const user = Deno.env.get("SMTP_USER");
  const pass = Deno.env.get("SMTP_PASS");
  if (!host || !portStr || !user || !pass) {
    return { sent: false, error: "missing SMTP_HOST/PORT/USER/PASS secret(s)" };
  }
  const port = parseInt(portStr, 10);
  if (isNaN(port)) return { sent: false, error: "SMTP_PORT is not a number" };

  const client = new SMTPClient({
    connection: {
      hostname: host,
      port,
      tls: port === 465, // implicit TLS for 465; denomailer auto-STARTTLS on 587
      auth: { username: user, password: pass },
    },
  });

  try {
    await client.send({
      from: `${EMAIL_FROM_NAME} <${user}>`,
      to: email,
      subject: EMAIL_SUBJECT,
      content: buildWelcomeEmailText(username),
      html: buildWelcomeEmailHtml(username),
    });
    await client.close();
    return { sent: true };
  } catch (err) {
    try { await client.close(); } catch (_) { /* ignore */ }
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
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

  // ---------- Validation ----------
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) return errResponse(400, "รูปแบบอีเมลไม่ถูกต้อง");
  if (!username) return errResponse(400, "กรุณากรอกชื่อผู้ใช้");
  if (username.length > 40) return errResponse(400, "ชื่อผู้ใช้ยาวเกินไป (สูงสุด 40 ตัวอักษร)");

  const ageNum = typeof ageRaw === "number" ? ageRaw : parseInt(String(ageRaw), 10);
  if (isNaN(ageNum) || ageNum < 10 || ageNum > 99) {
    return errResponse(400, "อายุไม่ถูกต้อง (10-99)");
  }

  const promoValid = promoCode === PROMO_CODE;
  if (!slipBase64 && !promoValid) {
    return errResponse(400, "กรุณาแนบสลิปหรือกรอกรหัสโปรโมชันที่ถูกต้อง");
  }

  if (slipBase64 && slipBase64.length > MAX_SLIP_BASE64) {
    return errResponse(413, "ไฟล์สลิปใหญ่เกิน 5MB");
  }

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
    const csvLine = [runStr, timestamp, email, username, ageNum, refCode, promoCode, slipName, "pending"]
      .map(csvQ)
      .join(",");
    const existingCSV = await ghGetFile("member-registration.csv", GITHUB_PAT);
    const csvContent = existingCSV
      ? existingCSV.content.trimEnd() + "\n" + csvLine
      : "id,timestamp,email,username,age,ref_code,promo_code,slip_filename,status\n" + csvLine;
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

    // ---------- Auto-grant Supabase user (best-effort, never blocks signup) ----------
    const grant = await grantSupabaseUser(email);
    if (grant.granted) {
      console.log(`[grant] ${email} — ${grant.alreadyExisted ? "already existed" : "created"}`);
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
