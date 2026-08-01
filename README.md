# Mango Loan

Mango Loan is a private loan tracking app for managing borrowers, loans, payments, balances, borrower portal access, and SMS-related workflows.

## Project

- Local path: `/Users/dev/Projects/mangoloan`
- Git remote: `git@github.com:fruitai/mangoloan.git`
- Production site: `https://mangoloan.vercel.app/`
- Supabase project ref: `ensuvkedfzepbpipivgp`

## Main Files

- `index.html` - public landing page and reset-link router
- `admin.html` - admin dashboard, MFA flow, borrower/loan/payment management
- `borrower.html` - borrower portal
- `reset-password.html` - password reset page
- `sms-consent.html` - public SMS consent/support page for Twilio review
- `MANGOLOAN_NOTES.md` - detailed project history and operational notes

## Supabase

The frontend uses the Supabase publishable key in static HTML. Keep RLS policies strict and never place service-role keys or private secrets in frontend files.

Important Supabase files:

- `supabase/rls_policies_admin.sql`
- `supabase/borrowers_auth_user_id_no_default.sql`
- `supabase/loan_advances.sql`
- `supabase/text_reminders.sql`
- `supabase/functions/create-borrower-user/index.ts`
- `supabase/functions/send-payment-receipt/index.ts`
- `supabase/functions/send-loan-reminders/index.ts`

## Admin Security

Admin access requires:

1. Supabase Auth sign-in.
2. A matching row in `public.admin_users`.
3. Supabase MFA/TOTP so the session reaches AAL2.

Do not rely on email alone for admin authorization. Use the Supabase Auth user UUID.

## Development Notes

- This is a static frontend app with Supabase backend services.
- Keep borrower portal repair tools visible on borrower cards.
- Keep Add Borrower, Add Loan, and Add Payment forms collapsed until requested.
- Always check mobile layouts before pushing UI changes.
- Always ask Lawrence before pushing to GitHub or deploying.

## Open Items

- Resubmit Twilio toll-free verification using `https://mangoloan.vercel.app/` and `https://mangoloan.vercel.app/sms-consent.html`.
- Add borrower phone numbers, text consent, and due day/date before reminders can send.
- Configure or verify Twilio sender details in Supabase secrets without exposing values.
