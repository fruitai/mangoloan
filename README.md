# Mango Loan

Mango Loan is a private loan tracker for managing personal borrower loans in one secure place. It helps keep loan balances, payment history, borrower access, and reminder workflows organized without relying on spreadsheets or manual notes.

## What It Does

- Tracks each borrower and their contact information.
- Records loan amounts, advances, and payments.
- Calculates current balances from loan activity.
- Gives borrowers a private portal to review their own loan summary and payment history.
- Lets the admin create or repair borrower portal logins.
- Supports password reset and borrower password changes.
- Includes SMS consent and reminder/receipt workflows for future text messaging.

## Main Screens

- Public home page: introduces the app and links to the portals.
- Admin dashboard: manage borrowers, loans, payments, balances, imports, and portal users.
- Borrower portal: lets each borrower view their own balance and activity.
- Reset password page: lets users set a new password from Supabase recovery links.
- SMS consent page: public consent/support page for text-message compliance.

## Security

Admin access is protected by Supabase login, an approved admin user record, and MFA/TOTP. Borrowers can only see their own loan information through row-level security.

Private service keys and secrets should never be stored in the frontend or committed to GitHub.

## Project Details

- Production site: `https://mangoloan.vercel.app/`
- GitHub repo: `git@github.com:fruitai/mangoloan.git`
- Local path: `/Users/dev/Projects/mangoloan`
- Supabase project ref: `ensuvkedfzepbpipivgp`

## Main Files

- `index.html` - public home page and reset-link router
- `admin.html` - admin dashboard
- `borrower.html` - borrower portal
- `reset-password.html` - password reset page
- `sms-consent.html` - SMS consent/support page
- `MANGOLOAN_NOTES.md` - deeper project notes and history

## Current Priorities

- Resubmit Twilio toll-free verification using the public website and SMS consent page.
- Add borrower phone numbers, text consent, and due dates before reminders can send.
- Keep the admin and borrower portal layouts clean and mobile-friendly.
