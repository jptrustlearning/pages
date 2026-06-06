// Supabase Edge Function: expiry-reminder  (v1)
// Daily cron job that emails members whose membership is about to expire.
// Two reminder stages: 7-day (sent once when 2–7 days remain) and 1-day
// (sent once when 0–1 days remain). Thai email, branded, with a renew CTA
// that deep-links to the renewal flow (signup.html?email=…&renew=1).
//
// Idempotency (no spam): each stage stores the EXPIRY VALUE it was sent for in
// app_metadata (reminder_d14_for / reminder_d7_for / reminder_d1_for). A run only sends a stage if
// its stored value differs from the user's current subscription_expires_at.
// When a member renews, subscription_expires_at changes → the markers no longer
// match → reminders fire again for the new cycle. This means we DON'T need to
// touch signup-webhook to reset markers on renewal — it heals itself.
//
// Deploy:
//   supabase functions deploy expiry-reminder --no-verify-jwt
//   (--no-verify-jwt because the trigger is a cron, not a logged-in user;
//    the endpoint is instead protected by the REMINDER_CRON_SECRET below.)
//
// Required secrets (set via `supabase secrets set KEY=VALUE`):
//   • RESEND_API_KEY          Resend API key (reuse the one signup-webhook uses)
//   • RESEND_FROM             Sender, e.g. "JP Trust Learning <noreply@jptrustlearning.com>"
//   • REMINDER_CRON_SECRET    A long random string. Required in the x-cron-secret
//                             header (or ?secret=) once set. If UNSET the endpoint
//                             is open (handy for the first test) — set it after.
//
// Auto-provided by Supabase runtime (no need to set):
//   • SUPABASE_URL
//   • SUPABASE_SERVICE_ROLE_KEY
//
// Manual test (after deploy):
//   Dry run (no emails, just a report of who WOULD get one):
//     curl "https://<project>.supabase.co/functions/v1/expiry-reminder?dryRun=1" \
//          -H "x-cron-secret: <SECRET>"
//   Real run:
//     curl -X POST "https://<project>.supabase.co/functions/v1/expiry-reminder" \
//          -H "x-cron-secret: <SECRET>"
//
// Schedule it daily with pg_cron + pg_net (see SQL block at the bottom of this file).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============ Config ============
const APP_BASE = "https://app.jptrustlearning.com";
const EMAIL_FROM_NAME = "JP Trust Learning";
const MAX_SENDS_PER_RUN = 300; // safety cap so a misconfig can never mass-mail

// Reminder stages, most-urgent first. daysLeft uses the SAME formula as the app
// badge: Math.ceil((expiry - now) / 1 day). So 7 days out → 7, tomorrow → 1,
// today → 0. minDays/maxDays are inclusive integer bounds on daysLeft.
const STAGES = [
  { key: "d1",  minDays: 0, maxDays: 1,  marker: "reminder_d1_for" },
  { key: "d7",  minDays: 2, maxDays: 7,  marker: "reminder_d7_for" },
  { key: "d14", minDays: 8, maxDays: 14, marker: "reminder_d14_for" },
] as const;
type StageKey = (typeof STAGES)[number]["key"];

// ============ CORS ============
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ============ Date / days-left helpers ============
const DAY_MS = 86400000;

function daysLeftFrom(expiryISO: string, nowMs: number): number | null {
  const t = Date.parse(expiryISO);
  if (isNaN(t)) return null;
  return Math.ceil((t - nowMs) / DAY_MS); // matches member-dashboard badge math
}

function formatThaiDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("th-TH", {
      timeZone: "Asia/Bangkok",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(iso));
  } catch (_) {
    return (iso || "").slice(0, 10);
  }
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ============ Email body builders ============
interface ReminderInfo {
  email: string;
  username: string;
  plan: string;
  daysLeft: number;
  expiryISO: string;
}

const PLAN_LABEL: Record<string, string> = {
  monthly: "รายเดือน",
  yearly: "รายปี",
};

function renewUrl(email: string): string {
  return `${APP_BASE}/signup.html?email=${encodeURIComponent(email)}&renew=1`;
}

// Headline + lead copy differ by urgency.
function stageCopy(stage: StageKey, daysLeft: number): { subject: string; headline: string; lead: string } {
  if (stage === "d1") {
    const when = daysLeft <= 0 ? "วันนี้" : "ในวันพรุ่งนี้";
    return {
      subject:
        daysLeft <= 0
          ? "แจ้งเตือน: สมาชิก JP Trust Learning ของคุณหมดอายุวันนี้"
          : "แจ้งเตือน: สมาชิก JP Trust Learning ของคุณหมดอายุพรุ่งนี้",
      headline: `สมาชิกของคุณจะหมดอายุ${when}`,
      lead:
        `สมาชิก JP Trust Learning ของคุณจะหมดอายุ${when} ` +
        `หากต้องการใช้งานต่อเนื่อง สามารถต่ออายุได้เลยจากปุ่มด้านล่างค่ะ`,
    };
  }
  // d7 / d14 — generic copy; daysLeft in the text adapts on its own
  return {
    subject: `สมาชิก JP Trust Learning ของคุณใกล้หมดอายุ (เหลือ ${daysLeft} วัน)`,
    headline: `สมาชิกของคุณเหลืออีก ${daysLeft} วัน`,
    lead:
      `สมาชิก JP Trust Learning ของคุณจะหมดอายุในอีก ${daysLeft} วัน ` +
      `เพื่อไม่ให้การใช้งานสะดุด สามารถต่ออายุล่วงหน้าได้เลยค่ะ`,
  };
}

function buildReminderText(stage: StageKey, info: ReminderInfo): string {
  const who = (info.username || "สมาชิก").trim();
  const c = stageCopy(stage, info.daysLeft);
  const planTh = PLAN_LABEL[info.plan] || info.plan || "—";
  return `เรียน คุณ${who}

${c.lead}

── รายละเอียดสมาชิก ──
แพ็กเกจ: ${planTh}
วันหมดอายุ: ${formatThaiDate(info.expiryISO)}

ต่ออายุสมาชิก: ${renewUrl(info.email)}

หมายเหตุ: การต่ออายุจะนับต่อจากวันหมดอายุเดิม คุณจะไม่เสียวันที่เหลืออยู่ค่ะ

ด้วยความเคารพ
ทีมงาน JP Trust Learning
www.jptrustlearning.com
`;
}

function buildReminderHtml(stage: StageKey, info: ReminderInfo): string {
  const who = escapeHtml((info.username || "สมาชิก").trim());
  const c = stageCopy(stage, info.daysLeft);
  const planTh = escapeHtml(PLAN_LABEL[info.plan] || info.plan || "—");
  const expTh = escapeHtml(formatThaiDate(info.expiryISO));
  const url = renewUrl(info.email);
  const urgent = stage === "d1";
  // amber for d7, red-maroon for d1 — mirrors the in-app days-left badge palette
  const accent = urgent ? "#C14545" : "#B8860B";
  const badgeBg = urgent ? "rgba(193,69,69,0.12)" : "rgba(212,175,55,0.16)";

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(c.subject)}</title>
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
          <div style="display:inline-block;padding:6px 14px;border-radius:999px;background:${badgeBg};color:${accent};font-size:12px;font-weight:700;letter-spacing:0.5px;margin-bottom:16px;">${escapeHtml(c.headline)}</div>
          <h1 style="margin:0 0 16px;font-size:21px;color:#5A3D20;font-weight:700;line-height:1.4;">แจ้งเตือนการต่ออายุสมาชิก</h1>
          <p style="font-size:15px;line-height:1.75;color:#3D3228;margin:0 0 12px;">เรียน คุณ${who}</p>
          <p style="font-size:15px;line-height:1.75;color:#3D3228;margin:0 0 18px;">${escapeHtml(c.lead)}</p>

          <!-- Detail box -->
          <div style="margin:22px 0 20px;padding:18px 22px;background:linear-gradient(180deg,#FFFEF8 0%,#F5EDD8 100%);border:1.5px solid rgba(212,175,55,0.40);border-radius:10px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="font-size:14.5px;line-height:1.9;color:#3D3228;">
              <tr><td style="color:#7A6F62;">แพ็กเกจ</td><td align="right" style="font-weight:700;color:#5A3D20;">${planTh}</td></tr>
              <tr><td style="color:#7A6F62;">วันหมดอายุ</td><td align="right" style="font-weight:700;color:${accent};">${expTh}</td></tr>
            </table>
          </div>

          <!-- CTA -->
          <div style="text-align:center;margin:26px 0 18px;">
            <a href="${url}" style="display:inline-block;padding:14px 40px;background:linear-gradient(135deg,#D4AF37 0%,#B8860B 100%);color:#1a0a0e;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;letter-spacing:1px;font-family:'Sarabun','Segoe UI',sans-serif;">ต่ออายุสมาชิก →</a>
          </div>

          <p style="font-size:13px;line-height:1.7;color:#7A6F62;margin:18px 0 8px;">การต่ออายุจะนับต่อจากวันหมดอายุเดิม — คุณจะไม่เสียวันที่เหลืออยู่ค่ะ</p>
          <p style="font-size:13px;line-height:1.7;color:#7A6F62;margin:0 0 8px;">หากต่ออายุเรียบร้อยแล้ว สามารถมองข้ามอีเมลฉบับนี้ได้เลยค่ะ</p>
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

// ============ Resend send ============
type SendResult = { sent: boolean; error?: string };

async function sendReminder(stage: StageKey, info: ReminderInfo): Promise<SendResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM") || `${EMAIL_FROM_NAME} <onboarding@resend.dev>`;
  if (!apiKey) return { sent: false, error: "missing RESEND_API_KEY secret" };

  const c = stageCopy(stage, info.daysLeft);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from,
        to: [info.email],
        subject: c.subject,
        text: buildReminderText(stage, info),
        html: buildReminderHtml(stage, info),
        headers: {
          "List-Unsubscribe":
            "<mailto:jptrustlearning@gmail.com?subject=Unsubscribe%20JP%20Trust%20Learning>",
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

// ============ Main ============
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1" || url.searchParams.get("dry") === "1";
  const limitParam = parseInt(url.searchParams.get("limit") || "0", 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 0;

  // ---- Auth: shared cron secret (optional but recommended) ----
  const cronSecret = Deno.env.get("REMINDER_CRON_SECRET") || "";
  const provided = req.headers.get("x-cron-secret") || url.searchParams.get("secret") || "";
  let secretWarning: string | undefined;
  if (cronSecret) {
    if (provided !== cronSecret) {
      return jsonResponse(401, { ok: false, error: "unauthorized — bad or missing x-cron-secret" });
    }
  } else {
    secretWarning = "REMINDER_CRON_SECRET is not set — this endpoint is currently UNPROTECTED. Set it after testing.";
  }

  const supaUrl = Deno.env.get("SUPABASE_URL");
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !svcKey) {
    return jsonResponse(500, { ok: false, error: "missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
  }

  const admin = createClient(supaUrl, svcKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const nowMs = Date.now();
  const summary = {
    ok: true,
    dryRun,
    scanned: 0,
    eligible: 0,
    sent: { d1: 0, d7: 0 } as Record<StageKey, number>,
    skipped_alreadySent: 0,
    skipped_revoked: 0,
    skipped_noExpiry: 0,
    skipped_outOfWindow: 0,
    errors: [] as Array<{ email: string; error: string }>,
    preview: [] as Array<{ email: string; stage: StageKey; daysLeft: number; expiry: string }>,
    warning: secretWarning,
  };

  let totalSends = 0;

  try {
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error || !data) {
        summary.ok = false;
        summary.errors.push({ email: "(listUsers)", error: error?.message || "no data" });
        break;
      }
      const users = data.users || [];
      for (const u of users) {
        summary.scanned++;
        const email = String(u.email || "").trim();
        if (!email) continue;
        const meta = (u.app_metadata || {}) as Record<string, unknown>;

        const status = String(meta.subscription_status || "");
        if (status === "revoked") {
          summary.skipped_revoked++;
          continue;
        }
        const expiry = (meta.subscription_expires_at as string) || "";
        if (!expiry) {
          summary.skipped_noExpiry++;
          continue;
        }
        const dLeft = daysLeftFrom(expiry, nowMs);
        if (dLeft === null) {
          summary.skipped_noExpiry++;
          continue;
        }

        // Pick the most-urgent stage whose window matches and that hasn't been
        // sent for THIS expiry value yet.
        let chosen: (typeof STAGES)[number] | null = null;
        for (const st of STAGES) {
          if (dLeft >= st.minDays && dLeft <= st.maxDays) {
            const sentFor = (meta[st.marker] as string) || "";
            if (sentFor !== expiry) chosen = st;
            else summary.skipped_alreadySent++;
            break; // only the first matching (most-urgent) window applies
          }
        }
        if (!chosen) {
          if (dLeft > 7 || dLeft < 0) summary.skipped_outOfWindow++;
          continue;
        }

        summary.eligible++;
        const username = (meta.username as string) || "";
        const plan = (meta.plan as string) || "";
        const info: ReminderInfo = { email, username, plan, daysLeft: dLeft, expiryISO: expiry };

        summary.preview.push({ email, stage: chosen.key, daysLeft: dLeft, expiry });

        if (dryRun) continue;
        if (totalSends >= MAX_SENDS_PER_RUN) {
          summary.errors.push({ email, error: "MAX_SENDS_PER_RUN reached — deferred to next run" });
          continue;
        }
        if (limit && totalSends >= limit) continue;

        const r = await sendReminder(chosen.key, info);
        if (!r.sent) {
          summary.errors.push({ email, error: r.error || "send failed" });
          continue; // do NOT mark on failure → retried next run
        }
        totalSends++;
        summary.sent[chosen.key]++;

        // Mark this stage as sent for this expiry. When sending the urgent d1
        // stage, also mark d7 for this expiry so a late d7 never fires.
        const markers: Record<string, unknown> = { reminder_last_sent_at: new Date().toISOString() };
        markers[chosen.marker] = expiry;
        if (chosen.key === "d1") markers["reminder_d7_for"] = expiry;

        try {
          await admin.auth.admin.updateUserById(u.id, {
            app_metadata: { ...meta, ...markers }, // spread existing → never lose other keys
          });
        } catch (e) {
          summary.errors.push({
            email,
            error: `sent but marker update failed: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
      if (users.length < 200) break; // last page
    }
  } catch (err) {
    summary.ok = false;
    summary.errors.push({ email: "(loop)", error: err instanceof Error ? err.message : String(err) });
  }

  return jsonResponse(200, summary);
});

/*  ─────────────────────────────────────────────────────────────────────────
    SCHEDULE THIS DAILY (run once in the Supabase SQL Editor)

    Enable the two extensions first (Dashboard → Database → Extensions):
        pg_cron   and   pg_net

    Then schedule a daily call. 02:00 UTC = 09:00 Asia/Bangkok:

      select cron.schedule(
        'expiry-reminder-daily',
        '0 2 * * *',
        $$
        select net.http_post(
          url     := 'https://rcdukwwcbyryauhqlzmx.supabase.co/functions/v1/expiry-reminder',
          headers := jsonb_build_object(
                       'Content-Type', 'application/json',
                       'x-cron-secret', '<PUT_REMINDER_CRON_SECRET_HERE>'
                     ),
          body    := '{}'::jsonb
        );
        $$
      );

    Inspect / manage the schedule:
        select * from cron.job;                       -- list
        select cron.unschedule('expiry-reminder-daily'); -- remove
    ───────────────────────────────────────────────────────────────────────── */
