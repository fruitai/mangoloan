import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type Borrower = {
  id: string;
  name: string | null;
  phone: string | null;
  text_opt_in: boolean | null;
};

type Loan = {
  id: string;
  principal: number | string | null;
  due_date: string | null;
  monthly_due_day: number | null;
  text_reminders_enabled: boolean | null;
  due_reminder_days_before: number | null;
  late_reminder_days_after: number | null;
  last_due_reminder_for: string | null;
  last_late_reminder_for: string | null;
  borrower: Borrower | null;
};

type Payment = {
  amount: number | string | null;
  date: string | null;
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

function normalizePhone(phone: string) {
  const trimmed = String(phone || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return "+" + trimmed.slice(1).replace(/\D/g, "");

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return digits ? "+" + digits : "";
}

function currency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number(part));
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function monthlyDueDate(base: Date, dueDay: number) {
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const day = Math.min(Math.max(1, dueDay), daysInMonth(year, month));
  return new Date(Date.UTC(year, month, day));
}

function relevantDueDate(today: Date, loan: Loan) {
  const dueDay = Number(loan.monthly_due_day || 0);
  if (dueDay > 0) {
    const thisMonth = monthlyDueDate(today, dueDay);
    const lateDays = Number(loan.late_reminder_days_after || 3);
    if (today.getTime() <= addDays(thisMonth, lateDays).getTime()) return thisMonth;

    const nextMonthBase = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    return monthlyDueDate(nextMonthBase, dueDay);
  }
  return loan.due_date ? parseDate(loan.due_date) : null;
}

async function sendTwilioText(to: string, message: string) {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const fromNumber = Deno.env.get("TWILIO_FROM_NUMBER");
  const messagingServiceSid = Deno.env.get("TWILIO_MESSAGING_SERVICE_SID");
  if (!accountSid || !authToken || (!fromNumber && !messagingServiceSid)) {
    throw new Error("Twilio is not configured.");
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
  if (!response.ok) throw new Error(result?.message || "Twilio could not send this text.");
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return appError("Method not allowed");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return appError("Missing Supabase Edge Function environment variables.");
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let configuredSecret = Deno.env.get("REMINDER_CRON_SECRET") || "";
  if (!configuredSecret) {
    const { data: setting } = await adminClient
      .from("app_settings")
      .select("value")
      .eq("key", "reminder_cron_secret")
      .maybeSingle();
    configuredSecret = setting?.value || "";
  }
  if (configuredSecret) {
    const providedSecret = req.headers.get("x-cron-secret") || "";
    if (providedSecret !== configuredSecret) return appError("Unauthorized", {}, 401);
  }

  const today = new Date();
  const todayText = dateKey(today);

  const { data: loans, error: loanError } = await adminClient
    .from("loans")
    .select("id, principal, due_date, monthly_due_day, text_reminders_enabled, due_reminder_days_before, late_reminder_days_after, last_due_reminder_for, last_late_reminder_for, borrower:borrowers(id, name, phone, text_opt_in)")
    .eq("text_reminders_enabled", true);
  if (loanError) return appError("Could not load loans.", { details: loanError.message });

  const sent: Array<Record<string, unknown>> = [];
  const skipped: Array<Record<string, unknown>> = [];

  for (const loan of (loans || []) as Loan[]) {
    const borrower = loan.borrower;
    const phone = normalizePhone(borrower?.phone || "");
    if (!borrower?.text_opt_in || !phone) {
      skipped.push({ loanId: loan.id, reason: "No text opt-in or phone." });
      continue;
    }

    const dueDate = relevantDueDate(today, loan);
    if (!dueDate) {
      skipped.push({ loanId: loan.id, reason: "No due date or monthly due day." });
      continue;
    }

    const dueDateText = dateKey(dueDate);
    const dueReminderDate = addDays(dueDate, -Number(loan.due_reminder_days_before || 3));
    const lateReminderDate = addDays(dueDate, Number(loan.late_reminder_days_after || 3));

    const { data: payments, error: paymentError } = await adminClient
      .from("payments")
      .select("amount, date")
      .eq("loan_id", loan.id)
      .gte("date", dueDateText);
    if (paymentError) {
      skipped.push({ loanId: loan.id, reason: paymentError.message });
      continue;
    }

    const paidThisCycle = ((payments || []) as Payment[]).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const principal = Number(loan.principal || 0);
    const shouldSendDue = todayText === dateKey(dueReminderDate) && loan.last_due_reminder_for !== dueDateText;
    const shouldSendLate = todayText === dateKey(lateReminderDate) && paidThisCycle <= 0 && loan.last_late_reminder_for !== dueDateText;

    if (!shouldSendDue && !shouldSendLate) {
      skipped.push({ loanId: loan.id, reason: "No reminder due today." });
      continue;
    }

    const reminderType = shouldSendLate ? "late" : "due";
    const message = shouldSendLate
      ? `Mango Loan reminder: we have not received your payment due ${dueDateText}. Please contact us if already paid. Reply STOP to opt out.`
      : `Mango Loan reminder: your payment is due on ${dueDateText}. Current loan amount: ${currency(principal)}. Reply STOP to opt out.`;

    try {
      const result = await sendTwilioText(phone, message);
      const updatePayload = shouldSendLate
        ? { last_late_reminder_for: dueDateText }
        : { last_due_reminder_for: dueDateText };
      await adminClient.from("loans").update(updatePayload).eq("id", loan.id);
      sent.push({ loanId: loan.id, borrowerId: borrower.id, type: reminderType, dueDate: dueDateText, sid: result?.sid || null });
    } catch (error) {
      skipped.push({ loanId: loan.id, reason: (error as Error).message || "Could not send text." });
    }
  }

  return json({ message: "Reminder run complete.", date: todayText, sent, skipped });
});
