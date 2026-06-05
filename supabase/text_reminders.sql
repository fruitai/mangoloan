-- Run in Supabase SQL Editor or with:
-- supabase db query --linked -f supabase/text_reminders.sql
-- Adds SMS consent, monthly reminder settings, and payment receipt text tracking.

alter table public.borrowers
  add column if not exists text_opt_in boolean not null default false,
  add column if not exists text_opt_in_at timestamptz,
  add column if not exists text_opt_out_at timestamptz;

alter table public.loans
  add column if not exists monthly_due_day integer,
  add column if not exists text_reminders_enabled boolean not null default true,
  add column if not exists due_reminder_days_before integer not null default 3,
  add column if not exists late_reminder_days_after integer not null default 3,
  add column if not exists last_due_reminder_for date,
  add column if not exists last_late_reminder_for date;

update public.loans
set monthly_due_day = extract(day from due_date)::integer
where monthly_due_day is null and due_date is not null;

alter table public.payments
  add column if not exists receipt_text_sent_at timestamptz,
  add column if not exists receipt_text_status text,
  add column if not exists receipt_text_sid text,
  add column if not exists receipt_text_error text;

create index if not exists payments_loan_id_date_idx
  on public.payments (loan_id, date);

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'loans_monthly_due_day_range'
      and conrelid = 'public.loans'::regclass
  ) then
    alter table public.loans
      add constraint loans_monthly_due_day_range
      check (monthly_due_day is null or monthly_due_day between 1 and 31);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'loans_due_reminder_days_before_range'
      and conrelid = 'public.loans'::regclass
  ) then
    alter table public.loans
      add constraint loans_due_reminder_days_before_range
      check (due_reminder_days_before between 0 and 14);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'loans_late_reminder_days_after_range'
      and conrelid = 'public.loans'::regclass
  ) then
    alter table public.loans
      add constraint loans_late_reminder_days_after_range
      check (late_reminder_days_after between 1 and 30);
  end if;
end $$;
