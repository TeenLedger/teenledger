# TeenLedger

Automatic Apple Pay spending tracking and a Sunday money text for teens. $3 a month or $30 a year.

Live site: https://teenledger.app

## How it works

1. A teen signs up on the site (first name, mobile, weekly budget) and pays with Apple Pay through Stripe Checkout.
2. The welcome page gives them a private link and walks them through an iPhone Shortcuts "Transaction" automation that posts every Apple Pay tap to `/api/tx`.
3. Every tap is stored in Supabase and categorized. Texts go out through Twilio:
   - welcome text with their money page link
   - heads up at 80% and 100% of the weekly budget
   - Sunday 5 PM Eastern weekly report with top categories and one tip (Vercel cron)
4. Customers can text cash buys ("6 lunch"), TOTAL, BUDGET 60, or HELP.
5. `/u/<token>` is the customer's money page. `/admin` is the business dashboard (customers, revenue, sales reps, texts).

## Stack

Static pages in `public/`, Node serverless functions in `api/`, shared code in `lib/`. No framework.
Postgres through `pg` (tables are created automatically on first request, all prefixed `tl_`). Stripe and Twilio through their REST APIs.

## Setup on Vercel

1. Import this repo as a new Vercel project (Framework preset: Other). Deploy.
2. Storage tab: create a Supabase database and connect it (adds `POSTGRES_URL`), or paste `POSTGRES_URL` from an existing Supabase project (Transaction pooler string).
3. Environment variables: see `.env.example`.
4. Domains: add `teenledger.app` and `www.teenledger.app`. In Cloudflare DNS add `A @ 76.76.21.21` and `CNAME www cname.vercel-dns.com`, both DNS only (grey cloud).
5. Twilio: phone number > Messaging > A message comes in > Webhook `https://teenledger.app/api/sms` (HTTP POST).
6. Optional Stripe webhook: `https://teenledger.app/api/stripe-webhook` with events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
7. Redeploy, then open `https://teenledger.app/api/health`. Everything should say connected.

Without Stripe keys the site runs in test mode: signups skip payment and are marked test. Without Twilio keys texts are saved as previews in the admin page.

## Local development and tests

```
npm install
npm run dev     # http://localhost:3000 with in-memory Postgres and fake Stripe/Twilio
npm test        # 59 end to end checks: signup, payment, Shortcut taps, alerts, inbound texts, weekly report, admin, cancel, delete, webhook
```
