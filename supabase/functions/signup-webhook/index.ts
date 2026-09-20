// Supabase Edge Function: signup-webhook  (v4 — approve-by-email, A129 · 20 ก.ย. 2026)
// Receives member signup / renewal data →
//   (1) writes CSV + slip + JSON log to the jptrustlearning/payment GitHub repo
//   (2) makes sure a Supabase auth user exists in a HELD state — NEVER grants access
//   (3) queues a row in public.signup_requests (one-time approval token, hashed)
//   (4) emails the customer "received, under review"
//   (5) emails the founders the slip + Approve / Reject buttons (→ approve.html)
// Access is granted ONLY when a founder confirms on approve.html, which calls the
// `approve-signup` function → SQL jpt_decide_request(). Requires migration
// supabase/migrations/jpt_signup_approval_v1.sql (if the table is missing the
// signup still succeeds, held, and the founders' email falls back to the SQL hint).
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
// RPC-down fallback hard deadline for PROMO_CODE (migration v7): 15 Jun 2569
// 23:59:59 BKK = 2026-06-15T16:59:59Z. After this the fallback never grants.
const PROMO_FALLBACK_UNTIL_MS = Date.parse("2026-06-15T16:59:59Z");
const MAX_SLIP_BASE64 = 7 * 1024 * 1024; // ~5MB binary → ~6.7MB base64; pad to 7MB
const APP_URL = "https://app.jptrustlearning.com/member-dashboard.html";
const APPROVE_URL = "https://app.jptrustlearning.com/approve.html";
const EMAIL_FROM_NAME = "JP Trust Learning";
const EMAIL_SUBJECT_RECEIVED = "JP Trust Learning — ได้รับใบสมัครแล้ว กำลังตรวจสอบการชำระเงิน";
// Founders who receive the approval email on every submit. Override via FOUNDER_EMAILS secret
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
// A129 (20 ก.ย. 2026): this function NO LONGER GRANTS ANYTHING.
// It only (a) makes sure an auth user exists in a HELD state so the customer can
// log in and see the "กำลังตรวจสอบการชำระเงิน" screen, and (b) stamps a small
// `jpt_pending` marker. Membership days are granted ONLY by the SQL function
// jpt_decide_request() when a founder presses Approve (approve-signup function).
type PendingResult = {
  ok: boolean;
  alreadyExisted: boolean;
  kind: "new" | "renew";
  currentExpiry: string | null;   // existing member's expiry (renewals) — shown to founders
  error?: string;
};

// Find an existing auth user id by email (paginated).
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

// deno-lint-ignore no-explicit-any
function adminClient(): any | null {
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !svcKey) return null;
  return createClient(supaUrl, svcKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function registerPendingUser(
  email: string,
  profile: { username: string; age: number },
  pending: Record<string, unknown>,          // { ref_code, plan, amount_due, submitted_at }
): Promise<PendingResult> {
  const admin = adminClient();
  if (!admin) {
    return { ok: false, alreadyExisted: false, kind: "new", currentExpiry: null, error: "missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" };
  }
  const holdAt = new Date().toISOString();
  try {
    // ---- New user: created HELD. No subscription_expires_at at all → nothing to
    // double-count later, and the app gate (status=revoked + jpt_hold) shows the
    // "payment under review" screen. plan/amount are mirrored top-level only so
    // that screen can display them.
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      app_metadata: {
        username: profile.username,
        age: profile.age,
        plan: pending.plan ?? null,
        amount_due: pending.amount_due ?? null,
        subscription_status: "revoked",
        jpt_hold: true,
        jpt_hold_at: holdAt,
        jpt_pending: { ...pending, kind: "new" },
      },
    });
    if (!error) {
      return { ok: !!data?.user, alreadyExisted: false, kind: "new", currentExpiry: null };
    }

    const msg = String(error.message || "").toLowerCase();
    const exists = msg.includes("already") || msg.includes("registered") || msg.includes("duplicate") || msg.includes("exists");
    if (!exists) {
      return { ok: false, alreadyExisted: false, kind: "new", currentExpiry: null, error: error.message };
    }

    // ---- Existing account (renewal / re-submission): DO NOT touch status, plan
    // or expiry. A member who still has days left keeps using the app while the
    // slip is reviewed. We only flag the pending request (merge-based update).
    const id = await findUserIdByEmail(admin, email);
    if (!id) {
      return { ok: false, alreadyExisted: true, kind: "renew", currentExpiry: null, error: "existing user not found by email" };
    }
    let currentExpiry: string | null = null;
    let everMember = false;
    try {
      const { data: got } = await admin.auth.admin.getUserById(id);
      const m = (got?.user?.app_metadata || {}) as Record<string, unknown>;
      currentExpiry = (m.subscription_expires_at as string) || null;
      everMember = !!(m.subscription_expires_at || m.subscription_started_at);
    } catch (_) { /* best-effort */ }
    const kind: "new" | "renew" = everMember ? "renew" : "new";
    const { error: upErr } = await admin.auth.admin.updateUserById(id, {
      app_metadata: {
        jpt_hold: true,
        jpt_hold_at: holdAt,
        jpt_pending: { ...pending, kind },
        jpt_rejected_at: null,      // null = delete key (GoTrue merge semantics)
        jpt_reject_note: null,
      },
    });
    if (upErr) {
      return { ok: false, alreadyExisted: true, kind, currentExpiry, error: `metadata update failed: ${upErr.message}` };
    }
    return { ok: true, alreadyExisted: true, kind, currentExpiry };
  } catch (err) {
    return { ok: false, alreadyExisted: false, kind: "new", currentExpiry: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============ Approval queue ============
function b64url(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type QueueResult = { ok: boolean; token: string | null; error?: string };

// Inserts one row into public.signup_requests (service-role only table) and
// returns the raw one-time token that goes into the founders' email link. Only
// its SHA-256 is stored, so a DB leak can't be used to approve anything.
async function queueApprovalRequest(row: Record<string, unknown>): Promise<QueueResult> {
  const admin = adminClient();
  if (!admin) return { ok: false, token: null, error: "missing service role" };
  try {
    const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const token_hash = await sha256Hex(token);
    const { error } = await admin.from("signup_requests").insert({ ...row, token_hash });
    if (error) return { ok: false, token: null, error: error.message };
    return { ok: true, token };
  } catch (err) {
    return { ok: false, token: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============ Email helpers ============
type EmailResult = { sent: boolean; error?: string };

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// "We received your application" — sent to the CUSTOMER right after submit.
// The real welcome mail ("บัญชีพร้อมใช้งาน") is sent by approve-signup AFTER a
// founder approves the slip.
interface ReceivedInfo { username: string; refCode: string; planLabel: string; amount: number; kind: "new" | "renew"; stillActive: boolean }

function receivedLines(i: ReceivedInfo): { head: string; body: string; note: string } {
  const head = i.kind === "renew" ? "ได้รับคำขอต่ออายุสมาชิกแล้ว" : "ได้รับใบสมัครสมาชิกแล้ว";
  const body = i.amount > 0
    ? "เราได้รับข้อมูลและสลิปการโอนเงินของคุณเรียบร้อยแล้ว ขณะนี้ทีมงานกำลังตรวจสอบการชำระเงิน โดยปกติใช้เวลาไม่เกิน 24 ชั่วโมง"
    : "เราได้รับข้อมูลการสมัครของคุณเรียบร้อยแล้ว ขณะนี้ทีมงานกำลังตรวจสอบสิทธิ์ โดยปกติใช้เวลาไม่เกิน 24 ชั่วโมง";
  const note = i.stillActive
    ? "ระหว่างนี้คุณยังใช้งานแอปได้ตามปกติ เมื่ออนุมัติแล้ววันสมาชิกจะถูกต่อจากวันหมดอายุเดิมให้อัตโนมัติ ไม่เสียวันที่เหลือ"
    : "เมื่ออนุมัติแล้ว เราจะส่งอีเมลแจ้งอีกครั้งพร้อมขั้นตอนเข้าใช้งาน โดยวันสมาชิกจะเริ่มนับตั้งแต่วันที่อนุมัติ ไม่ต้องสมัครใหม่และไม่ต้องชำระเงินซ้ำ";
  return { head, body, note };
}

function buildReceivedEmailText(i: ReceivedInfo): string {
  const who = (i.username || "สมาชิก").trim();
  const L = receivedLines(i);
  return `เรียน คุณ${who}

${L.head}
${L.body}

รหัสอ้างอิง: ${i.refCode}
แพ็กเกจ: ${i.planLabel}
ยอดชำระ: ฿${Number(i.amount || 0).toLocaleString("en-US")}

${L.note}

ตรวจสอบสถานะได้ที่: ${APP_URL}
หากเกิน 24 ชั่วโมงแล้วยังไม่ได้รับอีเมลยืนยัน กรุณาตอบกลับอีเมลฉบับนี้พร้อมแจ้งรหัสอ้างอิง

ด้วยความเคารพ
ทีมงาน JP Trust Learning
www.jptrustlearning.com
`;
}

function buildReceivedEmailHtml(i: ReceivedInfo): string {
  const who = escapeHtml((i.username || "สมาชิก").trim());
  const L = receivedLines(i);
  const row = (k: string, v: string) =>
    `<tr><td style="padding:6px 0;color:#7A6F62;font-size:13.5px;">${k}</td><td style="padding:6px 0;color:#3D3228;font-size:14px;font-weight:600;text-align:right;">${v}</td></tr>`;
  return `<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(EMAIL_SUBJECT_RECEIVED)}</title></head>
<body style="margin:0;padding:0;font-family:'Sarabun','Segoe UI',Arial,sans-serif;background:#FAF6ED;color:#3D3228;-webkit-text-size-adjust:100%;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#FAF6ED;padding:24px 0;"><tr><td align="center">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="max-width:600px;width:100%;">
      <tr><td align="center" style="padding:28px 24px 24px;border-bottom:1.5px solid rgba(212,175,55,0.35);">
        <div style="display:inline-block;width:64px;height:64px;background:linear-gradient(135deg,#722F37 0%,#5A1F26 100%);border-radius:50%;line-height:64px;color:#D4AF37;font-size:20px;font-weight:700;letter-spacing:2px;font-family:'Times New Roman',serif;">JPT</div>
        <div style="margin-top:12px;font-size:11px;letter-spacing:3px;color:#8B6914;text-transform:uppercase;font-family:'Times New Roman',serif;">JP Trust Learning</div>
      </td></tr>
      <tr><td style="padding:32px 28px 12px;background:#FFFEF8;">
        <div style="font-size:11px;letter-spacing:2.5px;color:#8B6914;text-transform:uppercase;font-weight:600;margin-bottom:8px;">Payment Under Review</div>
        <h1 style="margin:0 0 18px;font-size:22px;color:#5A3D20;font-weight:700;line-height:1.35;">${escapeHtml(L.head)}</h1>
        <p style="font-size:15px;line-height:1.75;margin:0 0 12px;">เรียน คุณ${who}</p>
        <p style="font-size:15px;line-height:1.75;margin:0 0 18px;">${escapeHtml(L.body)}</p>
        <div style="margin:20px 0;padding:16px 20px;background:linear-gradient(180deg,#FFFEF8 0%,#F5EDD8 100%);border:1.5px solid rgba(212,175,55,0.40);border-radius:10px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            ${row("รหัสอ้างอิง", escapeHtml(i.refCode))}
            ${row("แพ็กเกจ", escapeHtml(i.planLabel))}
            ${row("ยอดชำระ", "฿" + Number(i.amount || 0).toLocaleString("en-US"))}
            ${row("สถานะ", '<span style="color:#8B6914;">รอตรวจสอบการชำระเงิน</span>')}
          </table>
        </div>
        <p style="font-size:14px;line-height:1.75;color:#5A3D20;margin:0 0 22px;">${escapeHtml(L.note)}</p>
        <div style="text-align:center;margin:24px 0 18px;">
          <a href="${APP_URL}" style="display:inline-block;padding:13px 34px;background:linear-gradient(135deg,#722F37 0%,#5A1F26 100%);color:#E8D48B;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;letter-spacing:1px;">ตรวจสอบสถานะในแอป →</a>
        </div>
        <p style="font-size:13px;line-height:1.7;color:#7A6F62;margin:18px 0 12px;">หากเกิน 24 ชั่วโมงแล้วยังไม่ได้รับอีเมลยืนยัน กรุณาตอบกลับอีเมลฉบับนี้พร้อมแจ้งรหัสอ้างอิง</p>
      </td></tr>
      <tr><td style="padding:20px 24px 28px;background:#FFFEF8;border-top:1px solid rgba(212,175,55,0.25);text-align:center;">
        <div style="font-size:13px;color:#5A3D20;font-weight:600;">ด้วยความเคารพ<br>ทีมงาน JP Trust Learning</div>
        <div style="font-size:11px;color:#8B6914;margin-top:8px;letter-spacing:1.5px;font-family:'Times New Roman',serif;">www.jptrustlearning.com</div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

async function sendReceivedEmail(email: string, info: ReceivedInfo): Promise<EmailResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM") || `${EMAIL_FROM_NAME} <onboarding@resend.dev>`;
  if (!apiKey) return { sent: false, error: "missing RESEND_API_KEY secret" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to: [email],
        reply_to: "jptrustlearning@gmail.com",
        subject: EMAIL_SUBJECT_RECEIVED,
        text: buildReceivedEmailText(info),
        html: buildReceivedEmailHtml(info),
        headers: {
          "List-Unsubscribe": "<mailto:jptrustlearning@gmail.com?subject=Unsubscribe%20JP%20Trust%20Learning>",
          "List-ID": "JP Trust Learning Membership <members.jptrustlearning.com>",
        },
      }),
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

// ============ Founder notification (internal) — now the APPROVAL email ============
// Fires on every submit (new signup AND renewal). Carries the slip as an
// attachment + two buttons that open the approval page (approve.html). Opening
// the link does NOTHING by itself — the founder must press the confirm button on
// that page (mail scanners / link prefetchers open links on their own, so a
// one-click GET approve would let bots through unreviewed).
interface FounderInfo {
  username: string; email: string; age: number | null; plan: string;
  basePrice: number; amount: number; promoCode: string; promoApplied: boolean;
  refCode: string; slipName: string | null;
  slipBase64: string | null;   // raw base64 (no data: prefix) — attached to the email
  kind: "new" | "renew";
  currentExpiry: string | null;
  token: string | null;        // null = queue insert failed → no buttons, SQL fallback note
  queueError: string | null;
}
function fmtBkk(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (isNaN(t)) return "—";
  return new Date(t).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", year: "numeric", month: "short", day: "numeric" });
}
async function sendFounderNotification(info: FounderInfo): Promise<EmailResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM") || `${EMAIL_FROM_NAME} <onboarding@resend.dev>`;
  const recipients = (Deno.env.get("FOUNDER_EMAILS") || FOUNDER_EMAILS_DEFAULT)
    .split(",").map((x) => x.trim()).filter(Boolean);
  if (!apiKey) return { sent: false, error: "missing RESEND_API_KEY secret" };
  if (recipients.length === 0) return { sent: false, error: "no founder recipients" };

  const planLabel = info.plan === "yearly" ? "รายปี (Yearly)" : info.plan === "monthly" ? "รายเดือน (Monthly)" : "—";
  const kindLabel = info.kind === "renew" ? "ต่ออายุ" : "สมัครใหม่";
  const promoLine = info.promoApplied && info.promoCode ? `${info.promoCode} (ใช้งานแล้ว)` : "ไม่มี";
  const slipBytes = info.slipBase64 ? Math.floor(info.slipBase64.length * 3 / 4) : 0;
  const slipKb = Math.max(1, Math.round(slipBytes / 1024));
  // Real bank slips seen so far are 121KB–3.2MB; the Aug-2026 bot sent 4–11 byte
  // and ~32KB files. Flag anything small — a hint for the reviewer, not a verdict.
  const slipSuspicious = !!info.slipBase64 && slipBytes < 60 * 1024;
  const slipLine = info.slipBase64
    ? `${info.slipName || "slip"} · ${slipKb} KB (แนบมาในอีเมลนี้)`
    : "ไม่มีสลิปแนบ (โค้ดโปรโมชันฟรี)";
  const fmtBaht = (n: number) => "฿" + Number(n || 0).toLocaleString("en-US");
  const subject = `🔔 รออนุมัติ · ${kindLabel}: ${info.username} · ${planLabel} · ${fmtBaht(info.amount)}`;
  const approveUrl = info.token ? `${APPROVE_URL}?t=${info.token}` : "";
  const rejectUrl = info.token ? `${APPROVE_URL}?t=${info.token}&a=reject` : "";
  const fallbackLine = `อนุมัติผ่าน SQL Editor: SELECT * FROM jpt_approve('${info.email}');`;

  const text = [
    `มีคำขอ${kindLabel}รออนุมัติ — JP Trust Learning`,
    "",
    `ประเภท: ${kindLabel}`,
    `ชื่อผู้ใช้: ${info.username}`,
    `อีเมล: ${info.email}`,
    `อายุ: ${info.age ?? "—"}`,
    `แพ็กเกจ: ${planLabel}`,
    `ราคาปกติ: ${fmtBaht(info.basePrice)}`,
    `ยอดที่ต้องได้รับ: ${fmtBaht(info.amount)}`,
    `โปรโมชัน: ${promoLine}`,
    `สลิป: ${slipLine}${slipSuspicious ? "  [โปรดระวัง] ไฟล์เล็กผิดปกติ ตรวจให้ละเอียด" : ""}`,
    `รหัสอ้างอิง: ${info.refCode}`,
    info.kind === "renew" ? `วันหมดอายุปัจจุบัน: ${fmtBkk(info.currentExpiry)}` : "",
    "",
    "ยังไม่มีการให้สิทธิ์ใดๆ — ตรวจสลิปที่แนบมา แล้วเปิดลิงก์เพื่อกดยืนยัน:",
    info.token ? `อนุมัติ: ${approveUrl}` : `[ข้อผิดพลาด] สร้างลิงก์อนุมัติไม่สำเร็จ (${info.queueError || "unknown"})`,
    info.token ? `ปฏิเสธ: ${rejectUrl}` : fallbackLine,
    "",
    "— ระบบแจ้งเตือนอัตโนมัติ JP Trust Learning",
  ].filter((x) => x !== "").join("\n");

  const esc = (x: string) => escapeHtml(String(x ?? ""));
  const row = (k: string, v: string) =>
    `<tr><td style="padding:7px 14px;color:#7A6F62;font-size:13px;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:7px 14px;color:#1a0a0e;font-size:14px;font-weight:600">${v}</td></tr>`;
  const kindBadge = info.kind === "renew"
    ? `<span style="display:inline-block;padding:2px 10px;border-radius:20px;background:#E8F0FA;color:#2C5E9E;font-size:12px;">ต่ออายุ</span>`
    : `<span style="display:inline-block;padding:2px 10px;border-radius:20px;background:#E9F5EC;color:#1F7D49;font-size:12px;">สมัครใหม่</span>`;
  const buttons = info.token
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:6px 0 4px"><tr>
         <td style="padding:0 6px 0 22px" width="62%"><a href="${approveUrl}" style="display:block;text-align:center;padding:14px 10px;background:#1F7D49;color:#FFFFFF;text-decoration:none;border-radius:10px;font-size:15px;font-weight:700">ตรวจสลิปแล้ว — อนุมัติ</a></td>
         <td style="padding:0 22px 0 6px"><a href="${rejectUrl}" style="display:block;text-align:center;padding:14px 10px;background:#FFFEF8;color:#A83232;text-decoration:none;border-radius:10px;font-size:15px;font-weight:700;border:1.5px solid #A83232">ปฏิเสธ</a></td>
       </tr></table>
       <div style="padding:8px 22px 4px;color:#7A6F62;font-size:12px;line-height:1.6">กดแล้วจะเปิดหน้ายืนยันอีกชั้น — ยังไม่มีการให้สิทธิ์จนกว่าจะกดยืนยันในหน้านั้น · คนใดคนหนึ่งกดก็พอ กดซ้ำไม่บวกวันเพิ่ม</div>`
    : `<div style="margin:6px 22px;padding:12px 14px;background:#FDF0EE;border:1px solid #E3B4AE;border-radius:10px;color:#8A2C22;font-size:13px;line-height:1.6"><strong>สร้างลิงก์อนุมัติไม่สำเร็จ</strong> (${esc(info.queueError || "unknown")})<br>${esc(fallbackLine)}</div>`;

  const html = `<div style="font-family:'Sarabun',Arial,sans-serif;background:#FAF6ED;padding:24px">
    <div style="max-width:520px;margin:0 auto;background:#FFFEF8;border:1.5px solid rgba(212,175,55,0.4);border-radius:14px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#1a0a0e,#722F37);padding:18px 22px">
        <div style="color:#D4AF37;font-size:12px;letter-spacing:2px;text-transform:uppercase">JP Trust Learning · รออนุมัติ</div>
        <div style="color:#F4E4BA;font-size:19px;font-weight:700;margin-top:3px">🔔 มีคำขอ${kindLabel}รอตรวจสลิป</div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin:8px 0">
        ${row("ประเภท", kindBadge)}
        ${row("ชื่อผู้ใช้", esc(info.username))}
        ${row("อีเมล", esc(info.email))}
        ${row("อายุ", info.age != null ? String(info.age) : "—")}
        ${row("แพ็กเกจ", esc(planLabel))}
        ${row("ราคาปกติ", fmtBaht(info.basePrice))}
        ${row("ยอดที่ต้องได้รับ", `<span style="color:#1F7D49;font-size:16px">${fmtBaht(info.amount)}</span>`)}
        ${row("โปรโมชัน", esc(promoLine))}
        ${row("สลิป", esc(slipLine) + (slipSuspicious ? `<div style="color:#A83232;font-size:12.5px;margin-top:3px"><strong>โปรดระวัง:</strong> ไฟล์เล็กผิดปกติ (สลิปจริงมัก &gt; 100 KB) ตรวจให้ละเอียด</div>` : ""))}
        ${row("รหัสอ้างอิง", esc(info.refCode))}
        ${info.kind === "renew" ? row("วันหมดอายุปัจจุบัน", esc(fmtBkk(info.currentExpiry))) : ""}
      </table>
      ${buttons}
      <div style="padding:10px 22px 18px;margin-top:8px;color:#A09B92;font-size:11.5px;border-top:1px solid rgba(212,175,55,0.2)">ระบบแจ้งเตือนอัตโนมัติ — ตอบกลับอีเมลนี้เพื่อติดต่อผู้สมัครได้โดยตรง</div>
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
async function reservePromo(code: string, plan: string, email: string): Promise<PromoResult | null> {
  const supaUrl = Deno.env.get("SUPABASE_URL");
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !svcKey) return null;
  try {
    const admin = createClient(supaUrl, svcKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await admin.rpc("reserve_promo", { p_code: code, p_plan: plan, p_email: email });
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
    const r = await reservePromo(promoCode, plan, email);
    if (r === null) {
      // RPC unreachable/misconfigured. Don't silently let people in free —
      // fail closed for promo, but allow the legacy beta code as a fallback so
      // we never hard-block during infra hiccups. The fallback must honour the
      // same rules as the table row (migrations v4 + v7): monthly-only, dead
      // after 15 Jun 2569, and NEW USERS ONLY — an existing account renewing
      // free during an RPC blip would violate the new-user gate.
      const fallbackOk = promoCode === PROMO_CODE && plan === "monthly" &&
        Date.now() <= PROMO_FALLBACK_UNTIL_MS;
      if (fallbackOk) {
        // New-user gate even while the RPC is down: GoTrue admin API is a
        // separate service from PostgREST, so it is often still reachable. If
        // we can positively see the email already exists → reject. A lookup
        // failure falls through (same residual risk as before, now capped by
        // the 15 Jun deadline).
        const supaUrl = Deno.env.get("SUPABASE_URL");
        const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (supaUrl && svcKey) {
          const admin = createClient(supaUrl, svcKey, {
            auth: { autoRefreshToken: false, persistSession: false },
          });
          const existingId = await findUserIdByEmail(admin, email);
          if (existingId) {
            return errResponse(409, "รหัสนี้ใช้ได้เฉพาะสมาชิกสมัครใหม่เท่านั้น");
          }
        }
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
        members_only: "รหัสนี้ใช้ได้เฉพาะสมาชิกที่ยังไม่หมดอายุ (ต่ออายุก่อนหมด)",
        new_only: "รหัสนี้ใช้ได้เฉพาะสมาชิกสมัครใหม่เท่านั้น",
        existing_only: "รหัสนี้ใช้ได้เฉพาะลูกค้าที่เคยสมัครสมาชิกเท่านั้น",
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

    // 2. Slip binary (if provided) — BEFORE the account/queue step so a slip failure aborts the whole signup
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
    // slip-verify provider in HERE — verify BEFORE registerPendingUser() so a
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

    // ---------- Subscription window (NOT applied here) ----------
    // monthly = +30 days, yearly = +365 days. A129: the webhook only RECORDS the
    // duration. jpt_decide_request() applies it when a founder approves:
    //   new expiry = max(approval time, existing expiry) + durationDays
    // so renewals never lose remaining days and nothing is granted before review.
    const SUB_DAYS: Record<string, number> = { monthly: 30, yearly: 365 };
    const durationDays = plan ? SUB_DAYS[plan] : 0;
    const slipExt = (slipFilename || "").split(".").pop() || "jpg";
    const slipPath = slipBase64 ? `member-slips/slip_${runStr}_${safeEmail}.${slipExt}` : null;
    const slipBytes = slipBase64 ? Math.floor(slipBase64.length * 3 / 4) : null;

    // ---------- Create/flag the account in HELD state (never grants) ----------
    const reg = await registerPendingUser(
      email,
      { username, age: ageNum },
      { ref_code: refCode, plan: plan || null, amount_due: amount, submitted_at: timestamp },
    );
    if (reg.ok) {
      console.log(`[pending] ${email} — ${reg.kind}${reg.alreadyExisted ? " (existing account)" : ""} · awaiting approval`);
    } else {
      console.error(`[pending] FAILED for ${email}: ${reg.error}`);
    }

    // ---------- Queue the approval request (token goes into the founders' email) ----------
    const queued = await queueApprovalRequest({
      ref_code: refCode,
      email,
      username,
      kind: reg.kind,
      plan: plan || null,
      duration_days: durationDays,
      base_price: basePrice,
      amount_due: amount,
      promo_code: promoValid ? (promoCode || null) : null,
      promo_discount_type: promoDiscountType,
      promo_discount_value: promoDiscountValue,
      slip_path: slipPath,
      slip_bytes: slipBytes,
    });
    if (!queued.ok) console.error(`[queue] FAILED for ${refCode}: ${queued.error}`);

    const stillActive = reg.kind === "renew" && !!reg.currentExpiry && Date.parse(reg.currentExpiry) > Date.now();
    const planLabelTh = plan === "yearly" ? "รายปี" : plan === "monthly" ? "รายเดือน" : "—";

    // ---------- Tell the customer we received it (best-effort) ----------
    const mail = await sendReceivedEmail(email, {
      username, refCode, planLabel: planLabelTh, amount, kind: reg.kind, stillActive,
    });
    if (mail.sent) {
      console.log(`[email] received-notice sent to ${email}`);
    } else {
      console.error(`[email] FAILED for ${email}: ${mail.error}`);
    }

    // ---------- Ask the founders to approve (best-effort) ----------
    const founderMail = await sendFounderNotification({
      username, email, age: ageNum, plan, basePrice, amount,
      promoCode, promoApplied: promoValid, refCode,
      slipName, slipBase64,
      kind: reg.kind, currentExpiry: reg.currentExpiry,
      token: queued.token, queueError: queued.error || null,
    });
    if (founderMail.sent) {
      console.log(`[email] approval request sent to founders for ${email}`);
    } else {
      console.error(`[email] founder notification FAILED for ${email}: ${founderMail.error}`);
    }

    // 3. JSON log — written LAST so it captures queue + email outcomes
    const logData = {
      id: runStr,
      ref_code: refCode,
      timestamp,
      username,
      age: ageNum,
      email,
      kind: reg.kind,
      promo_code: promoCode,
      promo_applied: promoValid,
      plan: plan || null,
      amount,
      base_price: basePrice,
      amount_due: amount,
      promo_discount_type: promoDiscountType,
      promo_discount_value: promoDiscountValue,
      subscription: {
        status: "pending_approval",
        submitted_at: timestamp,
        expires_at: null,               // decided at approval time
        duration_days: durationDays,
        current_expiry_at_submit: reg.currentExpiry,
      },
      slip_filename: slipName,
      slip_path: slipPath,
      status: "pending",
      confirmations: {
        slip_attached: !!slipBase64 || promoValid,
        payment_made: true,
      },
      pending_account: {
        ok: reg.ok,
        already_existed: reg.alreadyExisted,
        error: reg.error || null,
      },
      approval_request: {
        queued: queued.ok,
        error: queued.error || null,
      },
      received_email: { sent: mail.sent, error: mail.error || null },
      founder_email: { sent: founderMail.sent, error: founderMail.error || null },
    };
    const logOk = await ghPutText(
      `member-logs/member_regis_${runStr}_${safeEmail}.json`,
      JSON.stringify(logData, null, 2),
      `Member log: ${refCode}`,
      GITHUB_PAT,
    );
    if (!logOk) {
      console.error(`[log] failed to write JSON log for ${refCode}`);
    }

    return jsonResponse(200, {
      ok: true,
      refCode,
      timestamp,
      pending: true,          // A129: nothing is granted until a founder approves
      granted: false,
      kind: reg.kind,
      stillActive,
      emailSent: mail.sent,
      plan: plan || null,
      startedAt: timestamp,
      expiresAt: null,
      currentExpiry: reg.currentExpiry,
      promoCode: promoValid ? (promoCode || null) : null,
      promoApplied: promoValid,
    });
  } catch (err) {
    console.error("Signup webhook error:", err);
    return errResponse(500, `บันทึกข้อมูลไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
  }
});
