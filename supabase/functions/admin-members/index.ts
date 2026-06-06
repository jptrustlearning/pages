// Supabase Edge Function: admin-members  (v1)
// Returns a JSON list of all members with their subscription status, expiry,
// and computed days-left — so the founders can see who is expiring soon /
// already expired and decide who to follow up with. READ-ONLY (never mutates).
//
// Security: returns customer PII (emails), so it is FAIL-CLOSED — it refuses
// unless ADMIN_TOKEN is set AND the caller provides a matching token
// (x-admin-token header or ?token=). The service-role key never reaches the
// client; only this function (running server-side) uses it.
//
// Deploy:
//   supabase functions deploy admin-members --no-verify-jwt
//   (--no-verify-jwt so admin.html can call it with just the x-admin-token
//    header; ADMIN_TOKEN is the gate.)
//
// Required secret:
//   • ADMIN_TOKEN   A long random string. REQUIRED — if unset the function
//                   refuses every request.
//
// Auto-provided by the Supabase runtime:
//   • SUPABASE_URL
//   • SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const DAY_MS = 86400000;
function daysLeftFrom(expiryISO: string, nowMs: number): number | null {
  const t = Date.parse(expiryISO);
  if (isNaN(t)) return null;
  return Math.ceil((t - nowMs) / DAY_MS); // matches member-dashboard badge math
}

interface MemberRow {
  email: string;
  username: string;
  plan: string;
  started_at: string | null;
  renewed_at: string | null;
  expires_at: string | null;
  days_left: number | null;
  status: string;
  promo_code: string | null;
  promo_applied: boolean;
  amount_due: number | null;
  last_reminder_sent_at: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // ---- Auth: ADMIN_TOKEN required (fail-closed) ----
  const adminToken = Deno.env.get("ADMIN_TOKEN") || "";
  if (!adminToken) {
    return jsonResponse(500, { ok: false, error: "ADMIN_TOKEN is not configured on the server" });
  }
  const url = new URL(req.url);
  const provided = req.headers.get("x-admin-token") || url.searchParams.get("token") || "";
  if (provided !== adminToken) {
    return jsonResponse(401, { ok: false, error: "unauthorized" });
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
  const members: MemberRow[] = [];

  try {
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error || !data) {
        return jsonResponse(502, { ok: false, error: error?.message || "listUsers failed" });
      }
      const users = data.users || [];
      for (const u of users) {
        const email = String(u.email || "").trim();
        if (!email) continue;
        const m = (u.app_metadata || {}) as Record<string, unknown>;
        const expires = (m.subscription_expires_at as string) || null;
        members.push({
          email,
          username: (m.username as string) || "",
          plan: (m.plan as string) || "",
          started_at: (m.subscription_started_at as string) || null,
          renewed_at: (m.subscription_renewed_at as string) || null,
          expires_at: expires,
          days_left: expires ? daysLeftFrom(expires, nowMs) : null,
          status: (m.subscription_status as string) || "",
          promo_code: (m.promo_code as string) || null,
          promo_applied: !!m.promo_applied,
          amount_due: typeof m.amount_due === "number" ? (m.amount_due as number) : null,
          last_reminder_sent_at: (m.reminder_last_sent_at as string) || null,
          created_at: (u.created_at as string) || null,
          last_sign_in_at: (u.last_sign_in_at as string) || null,
        });
      }
      if (users.length < 200) break;
    }
  } catch (err) {
    return jsonResponse(500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }

  // Sort: soonest expiry first; members with no expiry go last.
  members.sort((a, b) => {
    const ax = a.expires_at ? Date.parse(a.expires_at) : Infinity;
    const bx = b.expires_at ? Date.parse(b.expires_at) : Infinity;
    return ax - bx;
  });

  // Headline counts the front-end can show without recomputing.
  const counts = {
    total: members.length,
    expiring_7d: members.filter((x) => x.status !== "revoked" && x.days_left !== null && x.days_left >= 0 && x.days_left <= 7).length,
    expiring_14d: members.filter((x) => x.status !== "revoked" && x.days_left !== null && x.days_left >= 0 && x.days_left <= 14).length,
    expired: members.filter((x) => x.status !== "revoked" && x.days_left !== null && x.days_left < 0).length,
    revoked: members.filter((x) => x.status === "revoked").length,
  };

  return jsonResponse(200, {
    ok: true,
    generated_at: new Date().toISOString(),
    counts,
    members,
  });
});
