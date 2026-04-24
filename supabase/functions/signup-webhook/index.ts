// Supabase Edge Function: signup-webhook
// Receives member signup data + forwards to jptrustlearning/payment GitHub repo
// PAT is stored server-side as GITHUB_PAT secret — never exposed to client
//
// Deploy: supabase functions deploy signup-webhook
// Set secret: supabase secrets set GITHUB_PAT=<your_github_pat>
// Invoke: POST https://<project>.supabase.co/functions/v1/signup-webhook

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ============ Config ============
const GITHUB_REPO = "jptrustlearning/payment";
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/contents`;
const PROMO_CODE = "JPTGOLD2026";
const MAX_SLIP_BASE64 = 7 * 1024 * 1024; // ~5MB binary → ~6.7MB base64; pad to 7MB

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

  // ---------- Write to GitHub ----------
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

    // 2. JSON log
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
    };
    const logOk = await ghPutText(
      `member-logs/member_regis_${runStr}_${safeEmail}.json`,
      JSON.stringify(logData, null, 2),
      `Member log: ${refCode}`,
      GITHUB_PAT,
    );
    if (!logOk) throw new Error("JSON log write failed");

    // 3. Slip binary (if provided)
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

    return jsonResponse(200, { ok: true, refCode, timestamp });
  } catch (err) {
    console.error("Signup webhook error:", err);
    return errResponse(500, `บันทึกข้อมูลไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
  }
});
