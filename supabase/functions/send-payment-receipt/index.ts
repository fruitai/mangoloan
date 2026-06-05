import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function appError(message: string, details?: Record<string, unknown>) {
  return json({ error: message, ...(details || {}) }, 200);
}

function jwtPayload(token: string) {
  try {
    const part = token.split(".")[1] || "";
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded));
  } catch (_err) {
    return {};
  }
}

function normalizePhone(phone: string) {
  const trimmed = String(phone || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return "+" + trimmed.slice(1).replace(/\D/g, "");

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return digits ? "+" + digits : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return appError("Method not allowed");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return appError("Missing Supabase Edge Function environment variables.");
  }

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return appError("Missing admin session. Sign out and sign back in as admin.");

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: callerData, error: callerError } = await userClient.auth.getUser(token);
  const caller = callerData?.user;
  if (callerError || !caller) return appError("Invalid admin session. Sign out and sign back in as admin.");

  const aal = jwtPayload(token)?.aal;
  if (aal !== "aal2") return appError("Please complete admin 2FA before sending receipt texts.");

  const { data: adminRows, error: adminError } = await adminClient
    .from("admin_users")
    .select("user_id")
    .eq("user_id", caller.id)
    .limit(1);
  if (adminError) return appError("Could not verify admin access.");
  if (!adminRows?.length) return appError("Admin access required.");

  let body: { phone?: string; message?: string; paymentId?: string } = {};
  try {
    body = await req.json();
  } catch (_err) {
    return appError("Invalid JSON body.");
  }

  const to = normalizePhone(body.phone || "");
  const message = String(body.message || "").trim();
  const paymentId = String(body.paymentId || "").trim();
  if (!to || to.length < 8) return appError("Enter a valid phone number.");
  if (!message) return appError("Enter a receipt text message.");
  if (message.length > 1500) return appError("Receipt text is too long.");

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER");
  const messagingServiceSid = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  if (!accountSid || !authToken || (!fromNumber && !messagingServiceSid)) {
    return appError("Twilio is not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER as Supabase secrets.");
  }

  const params = new URLSearchParams();
  params.set("To", to);
  params.set("Body", message);
  if (messagingServiceSid) {
    params.set("MessagingServiceSid", messagingServiceSid);
  } else {
    params.set("From", fromNumber || "");
  }

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${accountSid}:${authToken}`),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (paymentId) {
      await adminClient
        .from("payments")
        .update({
          receipt_text_status: "failed",
          receipt_text_error: result?.message || "Twilio could not send this receipt text."
        })
        .eq("id", paymentId);
    }
    return appError(result?.message || "Twilio could not send this receipt text.", {
      code: result?.code,
      status: response.status
    });
  }

  if (paymentId) {
    await adminClient
      .from("payments")
      .update({
        receipt_text_sent_at: new Date().toISOString(),
        receipt_text_status: result?.status || "sent",
        receipt_text_sid: result?.sid || null,
        receipt_text_error: null
      })
      .eq("id", paymentId);
  }

  return json({
    message: "Receipt text sent.",
    to,
    sid: result?.sid || null,
    status: result?.status || null
  });
});
