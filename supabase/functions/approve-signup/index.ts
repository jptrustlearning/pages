// Supabase Edge Function: approve-signup  (A129 · 20 ก.ย. 2026)
// Backend of https://app.jptrustlearning.com/approve.html — the page the founders
// reach from the Approve / Reject buttons in the "รออนุมัติ" email.
//
// POST JSON { token, action, note? }
//   action = "info"    → request details (nothing changes)
//   action = "slip"    → the slip image as a data: URL (read from the payment repo)
//   action = "approve" → jpt_decide_request(hash,'approve') → grants days ONCE → welcome mail
//   action = "reject"  → jpt_decide_request(hash,'reject', note) → rejection mail
//
// Auth model: the 256-bit random token in the link IS the credential (only its
// SHA-256 is stored). The page also sends the public anon key so the default
// verify_jwt=true gate passes. All DB work is service-role, inside the function.
// Opening the link never approves anything: the page must POST "approve".
//
// Deploy:  supabase functions deploy approve-signup
// Secrets (already set for signup-webhook, shared project-wide):
//   GITHUB_PAT · RESEND_API_KEY · RESEND_FROM · (optional) FOUNDER_EMAILS
// Requires migration: supabase/migrations/jpt_signup_approval_v1.sql

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============ Config ============
const GITHUB_REPO = "jptrustlearning/payment";
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/contents`;
const APP_URL = "https://app.jptrustlearning.com/member-dashboard.html";
const SIGNUP_URL = "https://app.jptrustlearning.com/signup.html";
const EMAIL_FROM_NAME = "JP Trust Learning";
const SUBJECT_APPROVED = "ยินดีต้อนรับสู่ JP Trust Learning — บัญชีของคุณพร้อมใช้งานแล้ว";
const SUBJECT_RENEWED = "JP Trust Learning — ต่ออายุสมาชิกเรียบร้อยแล้ว";
const SUBJECT_REJECTED = "JP Trust Learning — ไม่สามารถยืนยันการชำระเงินได้";
const FOUNDER_EMAILS_DEFAULT = "Joonstinn@gmail.com,Watcharaphon0619@gmail.com";
const MAX_SLIP_BYTES = 6 * 1024 * 1024;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function errResponse(status: number, message: string) {
  return jsonResponse(status, { ok: false, error: message });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function fmtThaiDate(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (isNaN(t)) return "—";
  return new Date(t).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", year: "numeric", month: "long", day: "numeric" });
}

// ============ Email: approved / welcome (moved here from signup-webhook, A129) ============
type EmailResult = { sent: boolean; error?: string };

interface ApprovedInfo { username: string; kind: string; expiresAt: string | null }
function approvedLines(i: ApprovedInfo): { title: string; lead: string } {
  const until = i.expiresAt ? ` สมาชิกของคุณใช้งานได้ถึงวันที่ ${fmtThaiDate(i.expiresAt)}` : "";
  return i.kind === "renew"
    ? { title: "ต่ออายุสมาชิกเรียบร้อยแล้ว", lead: `ทีมงานตรวจสอบการชำระเงินของคุณเรียบร้อยแล้ว การต่ออายุสมาชิกมีผลทันที${until}` }
    : { title: "ยินดีต้อนรับสู่ JP Trust Learning", lead: `ทีมงานตรวจสอบการชำระเงินของคุณเรียบร้อยแล้ว บัญชีของคุณพร้อมใช้งาน${until}` };
}

function buildWelcomeEmailText(i: ApprovedInfo): string {
  const who = (i.username || "สมาชิก").trim();
  const L = approvedLines(i);
  return `เรียน คุณ${who}

${L.title}

ขอขอบพระคุณที่ไว้วางใจ JP Trust Learning ค่ะ
${L.lead}

── ขั้นตอนการเข้าใช้งาน ──

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

function buildWelcomeEmailHtml(i: ApprovedInfo): string {
  const who = escapeHtml((i.username || "สมาชิก").trim());
  const L = approvedLines(i);
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(L.title)}</title>
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
          <h1 style="margin:0 0 20px;font-size:22px;color:#5A3D20;font-weight:700;line-height:1.35;">${escapeHtml(L.title)}</h1>
          <p style="font-size:15px;line-height:1.75;color:#3D3228;margin:0 0 12px;">เรียน คุณ${who}</p>
          <p style="font-size:15px;line-height:1.75;color:#3D3228;margin:0 0 18px;">ขอขอบพระคุณที่ไว้วางใจ JP Trust Learning ค่ะ<br>${escapeHtml(L.lead)}</p>

          <!-- Steps section -->
          <div style="margin:24px 0 20px;padding:20px 22px;background:linear-gradient(180deg,#FFFEF8 0%,#F5EDD8 100%);border:1.5px solid rgba(212,175,55,0.40);border-radius:10px;">
            <div style="font-size:11px;letter-spacing:2px;color:#8B6914;text-transform:uppercase;margin-bottom:12px;font-weight:600;">ขั้นตอนการเข้าใช้งาน</div>
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

async function sendWelcomeEmail(email: string, i: ApprovedInfo): Promise<EmailResult> {
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
        reply_to: "jptrustlearning@gmail.com",
        subject: i.kind === "renew" ? SUBJECT_RENEWED : SUBJECT_APPROVED,
        text: buildWelcomeEmailText(i),
        html: buildWelcomeEmailHtml(i),
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

// ============ Email: rejected ============
interface RejectedInfo { username: string; email: string; refCode: string; kind: string; note: string | null; stillActive: boolean }
function resubmitUrl(i: RejectedInfo): string {
  return `${SIGNUP_URL}?email=${encodeURIComponent(i.email)}${i.kind === "renew" ? "&renew=1" : ""}`;
}
function rejectedBody(i: RejectedInfo): { lead: string; keep: string } {
  return {
    lead: "ทีมงานได้ตรวจสอบหลักฐานการชำระเงินที่แนบมากับ" + (i.kind === "renew" ? "คำขอต่ออายุ" : "ใบสมัคร") + "ของคุณแล้ว แต่ยังไม่สามารถยืนยันยอดโอนได้ จึงยังไม่ได้เปิดสิทธิ์" + (i.kind === "renew" ? "ต่ออายุ" : "ใช้งาน") + "ให้ในรอบนี้",
    keep: i.stillActive ? "สมาชิกเดิมของคุณยังใช้งานได้ตามปกติจนถึงวันหมดอายุเดิม" : "",
  };
}
function buildRejectedText(i: RejectedInfo): string {
  const who = (i.username || "สมาชิก").trim();
  const B = rejectedBody(i);
  return [
    `เรียน คุณ${who}`, "",
    B.lead,
    i.note ? `\nหมายเหตุจากทีมงาน: ${i.note}` : "",
    B.keep ? `\n${B.keep}` : "",
    "", `รหัสอ้างอิง: ${i.refCode}`, "",
    "หากคุณโอนเงินแล้ว กรุณาส่งสลิปที่ถูกต้องอีกครั้งได้ที่:", resubmitUrl(i),
    "หรือตอบกลับอีเมลฉบับนี้พร้อมแนบหลักฐานการโอน ทีมงานยินดีตรวจสอบให้อีกครั้ง", "",
    "ขออภัยในความไม่สะดวก", "ทีมงาน JP Trust Learning", "www.jptrustlearning.com", "",
  ].filter((x) => x !== "").join("\n");
}
function buildRejectedHtml(i: RejectedInfo): string {
  const who = escapeHtml((i.username || "สมาชิก").trim());
  const B = rejectedBody(i);
  return `<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(SUBJECT_REJECTED)}</title></head>
<body style="margin:0;padding:0;font-family:'Sarabun','Segoe UI',Arial,sans-serif;background:#FAF6ED;color:#3D3228;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#FAF6ED;padding:24px 0;"><tr><td align="center">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;width:100%;">
      <tr><td align="center" style="padding:28px 24px 24px;border-bottom:1.5px solid rgba(212,175,55,0.35);">
        <div style="display:inline-block;width:64px;height:64px;background:linear-gradient(135deg,#722F37 0%,#5A1F26 100%);border-radius:50%;line-height:64px;color:#D4AF37;font-size:20px;font-weight:700;letter-spacing:2px;font-family:'Times New Roman',serif;">JPT</div>
        <div style="margin-top:12px;font-size:11px;letter-spacing:3px;color:#8B6914;text-transform:uppercase;font-family:'Times New Roman',serif;">JP Trust Learning</div>
      </td></tr>
      <tr><td style="padding:32px 28px 12px;background:#FFFEF8;">
        <h1 style="margin:0 0 18px;font-size:21px;color:#5A3D20;font-weight:700;line-height:1.35;">ไม่สามารถยืนยันการชำระเงินได้</h1>
        <p style="font-size:15px;line-height:1.75;margin:0 0 12px;">เรียน คุณ${who}</p>
        <p style="font-size:15px;line-height:1.75;margin:0 0 16px;">${escapeHtml(B.lead)}</p>
        ${i.note ? `<div style="margin:0 0 16px;padding:14px 18px;background:#FAF6ED;border-left:3px solid #D4AF37;border-radius:6px;font-size:14px;line-height:1.7;"><strong style="color:#8B6914;">หมายเหตุจากทีมงาน:</strong> ${escapeHtml(i.note)}</div>` : ""}
        ${B.keep ? `<p style="font-size:14.5px;line-height:1.75;color:#1F7D49;margin:0 0 16px;">${escapeHtml(B.keep)}</p>` : ""}
        <p style="font-size:13.5px;color:#7A6F62;margin:0 0 20px;">รหัสอ้างอิง: <strong style="color:#3D3228;">${escapeHtml(i.refCode)}</strong></p>
        <p style="font-size:14.5px;line-height:1.75;margin:0 0 8px;">หากคุณโอนเงินแล้ว กรุณาส่งสลิปที่ถูกต้องอีกครั้ง หรือตอบกลับอีเมลฉบับนี้พร้อมแนบหลักฐานการโอน ทีมงานยินดีตรวจสอบให้อีกครั้ง</p>
        <div style="text-align:center;margin:24px 0 18px;">
          <a href="${resubmitUrl(i)}" style="display:inline-block;padding:13px 34px;background:linear-gradient(135deg,#722F37 0%,#5A1F26 100%);color:#E8D48B;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;letter-spacing:1px;">ส่งสลิปใหม่ →</a>
        </div>
      </td></tr>
      <tr><td style="padding:20px 24px 28px;background:#FFFEF8;border-top:1px solid rgba(212,175,55,0.25);text-align:center;">
        <div style="font-size:13px;color:#5A3D20;font-weight:600;">ขออภัยในความไม่สะดวก<br>ทีมงาน JP Trust Learning</div>
        <div style="font-size:11px;color:#8B6914;margin-top:8px;letter-spacing:1.5px;font-family:'Times New Roman',serif;">www.jptrustlearning.com</div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

async function resendSend(payload: Record<string, unknown>): Promise<EmailResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { sent: false, error: "missing RESEND_API_KEY secret" };
  const from = Deno.env.get("RESEND_FROM") || `${EMAIL_FROM_NAME} <onboarding@resend.dev>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ from, ...payload }),
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

// Short audit note to both founders so the other one knows it's handled.
async function sendFounderDecisionNote(d: Record<string, unknown>, mailSent: boolean): Promise<EmailResult> {
  const recipients = (Deno.env.get("FOUNDER_EMAILS") || FOUNDER_EMAILS_DEFAULT)
    .split(",").map((x) => x.trim()).filter(Boolean);
  if (recipients.length === 0) return { sent: false, error: "no founder recipients" };
  const approved = d.status === "approved";
  const head = approved ? "✅ อนุมัติแล้ว" : "⛔ ปฏิเสธแล้ว";
  const lines = [
    `${head}: ${d.username || "—"} <${d.email}>`,
    `รหัสอ้างอิง: ${d.ref_code}`,
    `ประเภท: ${d.kind === "renew" ? "ต่ออายุ" : "สมัครใหม่"} · แพ็กเกจ: ${d.plan || "—"} · ยอด: ฿${Number(d.amount_due || 0).toLocaleString("en-US")}`,
    approved ? `สมาชิกถึง: ${fmtThaiDate((d.expires_at as string) || null)}` : `เหตุผล: ${d.decided_note || "—"}`,
    `อีเมลแจ้งลูกค้า: ${mailSent ? "ส่งแล้ว" : "ส่งไม่สำเร็จ — กรุณาแจ้งลูกค้าเอง"}`,
    Number(d.other_pending || 0) > 0 ? `⚠️ อีเมลนี้ยังมีคำขอค้างอีก ${d.other_pending} รายการ` : "",
  ].filter(Boolean);
  return await resendSend({
    to: recipients,
    subject: `${head} · ${d.username || d.email} · ${d.ref_code}`,
    text: lines.join("\n") + "\n\n— ระบบแจ้งเตือนอัตโนมัติ JP Trust Learning",
  });
}

// ============ GitHub (payment repo) ============
async function ghFetchSlip(path: string, pat: string): Promise<{ dataUrl: string; bytes: number } | null> {
  try {
    const url = `${GITHUB_API}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${pat}`, "User-Agent": "jpt-approve-signup", Accept: "application/vnd.github.raw" },
    });
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_SLIP_BYTES) return null;
    let bin = "";
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
    const ext = (path.split(".").pop() || "jpg").toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : ext === "pdf" ? "application/pdf" : "image/jpeg";
    return { dataUrl: `data:${mime};base64,${btoa(bin)}`, bytes: bytes.length };
  } catch (_) {
    return null;
  }
}
async function ghWriteDecisionLog(d: Record<string, unknown>, pat: string): Promise<boolean> {
  try {
    const ref = String(d.ref_code || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
    const bytes = new TextEncoder().encode(JSON.stringify({ ...d, logged_at: new Date().toISOString() }, null, 2));
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    const r = await fetch(`${GITHUB_API}/member-decisions/decision_${ref}.json`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json", "User-Agent": "jpt-approve-signup" },
      body: JSON.stringify({ message: `Decision ${d.status}: ${d.ref_code}`, content: btoa(bin) }),
    });
    return r.ok;
  } catch (_) {
    return false;
  }
}

// ============ Handler ============
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errResponse(405, "Method not allowed");

  let body: { token?: string; action?: string; note?: string };
  try { body = await req.json(); } catch (_) { return errResponse(400, "Invalid JSON body"); }

  const token = String(body.token || "").trim();
  const action = String(body.action || "info").trim().toLowerCase();
  const note = String(body.note || "").trim().slice(0, 500);
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) return errResponse(400, "ลิงก์ไม่ถูกต้อง");
  if (!["info", "slip", "approve", "reject"].includes(action)) return errResponse(400, "Unknown action");

  const supaUrl = Deno.env.get("SUPABASE_URL");
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !svcKey) return errResponse(500, "Server not configured");
  const admin = createClient(supaUrl, svcKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const tokenHash = await sha256Hex(token);

  // ---------- Look the request up ----------
  const { data: reqRow, error: reqErr } = await admin
    .from("signup_requests").select("*").eq("token_hash", tokenHash).maybeSingle();
  if (reqErr) {
    console.error("[approve] lookup error:", reqErr.message);
    return errResponse(500, "อ่านคิวคำขอไม่สำเร็จ (ตรวจว่ารัน jpt_signup_approval_v1.sql แล้ว)");
  }
  if (!reqRow) return errResponse(404, "ไม่พบคำขอนี้ — ลิงก์อาจไม่ถูกต้อง");

  // ---------- slip ----------
  if (action === "slip") {
    if (!reqRow.slip_path) return jsonResponse(200, { ok: true, slip: null });
    const pat = Deno.env.get("GITHUB_PAT");
    if (!pat) return errResponse(500, "missing GITHUB_PAT");
    const slip = await ghFetchSlip(String(reqRow.slip_path), pat);
    return jsonResponse(200, { ok: true, slip: slip ? slip.dataUrl : null, bytes: slip ? slip.bytes : null });
  }

  // ---------- info ----------
  if (action === "info") {
    let otherPending = 0;
    let currentExpiry: string | null = null;
    let userStatus: string | null = null;
    try {
      const { count } = await admin.from("signup_requests")
        .select("id", { count: "exact", head: true })
        .ilike("email", String(reqRow.email).replace(/([%_\\])/g, "\\$1"))
        .eq("status", "pending").neq("id", reqRow.id);
      otherPending = count || 0;
    } catch (_) { /* best-effort */ }
    try {
      for (let page = 1; page <= 10 && currentExpiry === null && userStatus === null; page++) {
        const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        const users = (data?.users || []) as Array<{ email?: string; app_metadata?: Record<string, unknown> }>;
        const u = users.find((x) => String(x.email || "").toLowerCase() === String(reqRow.email).toLowerCase());
        if (u) {
          const m = u.app_metadata || {};
          currentExpiry = (m.subscription_expires_at as string) || null;
          userStatus = (m.subscription_status as string) || "";
        }
        if (users.length < 200) break;
      }
    } catch (_) { /* best-effort */ }
    return jsonResponse(200, {
      ok: true,
      request: {
        ref_code: reqRow.ref_code, email: reqRow.email, username: reqRow.username, kind: reqRow.kind,
        plan: reqRow.plan, duration_days: reqRow.duration_days, base_price: reqRow.base_price,
        amount_due: reqRow.amount_due, promo_code: reqRow.promo_code,
        has_slip: !!reqRow.slip_path, slip_bytes: reqRow.slip_bytes,
        status: reqRow.status, created_at: reqRow.created_at, decided_at: reqRow.decided_at,
        decided_note: reqRow.decided_note, granted_expires_at: reqRow.granted_expires_at,
      },
      other_pending: otherPending,
      current_expiry: currentExpiry,
      user_status: userStatus,
    });
  }

  // ---------- approve / reject (atomic in SQL) ----------
  const { data: decided, error: decErr } = await admin.rpc("jpt_decide_request", {
    p_token_hash: tokenHash, p_action: action, p_note: note || null,
  });
  if (decErr) {
    console.error("[approve] jpt_decide_request error:", decErr.message);
    return errResponse(500, decErr.message || "ดำเนินการไม่สำเร็จ");
  }
  const d = (decided || {}) as Record<string, unknown>;

  // Someone already decided this request → report, send nothing, change nothing.
  if (!d.changed) {
    return jsonResponse(200, { ok: true, changed: false, decision: d });
  }

  const email = String(d.email || reqRow.email);
  const username = String(d.username || reqRow.username || "");
  let mail: EmailResult;
  if (d.status === "approved") {
    mail = await sendWelcomeEmail(email, { username, kind: String(d.kind || "new"), expiresAt: (d.expires_at as string) || null });
  } else {
    // stillActive: a renewer whose existing membership is still running
    let stillActive = false;
    try {
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const users = (data?.users || []) as Array<{ email?: string; app_metadata?: Record<string, unknown> }>;
      const u = users.find((x) => String(x.email || "").toLowerCase() === email.toLowerCase());
      const m = (u?.app_metadata || {}) as Record<string, unknown>;
      const t = Date.parse(String(m.subscription_expires_at || ""));
      stillActive = m.subscription_status === "active" && !isNaN(t) && t > Date.now();
    } catch (_) { /* best-effort */ }
    const info: RejectedInfo = { username, email, refCode: String(d.ref_code || ""), kind: String(d.kind || "new"), note: (d.decided_note as string) || null, stillActive };
    mail = await resendSend({
      to: [email], reply_to: "jptrustlearning@gmail.com", subject: SUBJECT_REJECTED,
      text: buildRejectedText(info), html: buildRejectedHtml(info),
    });
  }
  if (!mail.sent) console.error(`[approve] customer mail FAILED for ${email}: ${mail.error}`);

  const founderNote = await sendFounderDecisionNote(d, mail.sent);
  if (!founderNote.sent) console.error(`[approve] founder note FAILED: ${founderNote.error}`);

  const pat = Deno.env.get("GITHUB_PAT");
  if (pat) {
    const logged = await ghWriteDecisionLog({ ...d, customer_email_sent: mail.sent }, pat);
    if (!logged) console.error(`[approve] decision log write failed for ${d.ref_code}`);
  }

  console.log(`[approve] ${d.status} ${d.ref_code} <${email}> expires ${d.expires_at ?? "—"}`);
  return jsonResponse(200, { ok: true, changed: true, decision: d, emailSent: mail.sent, emailError: mail.error || null });
});
