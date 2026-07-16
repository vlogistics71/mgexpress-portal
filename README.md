# Mi Gente Express Portal

A working production MVP for:
- Public quote requests
- Admin/dispatcher dashboard
- Customer portal
- Driver portal
- Stripe Checkout
- Automatic paid status through Stripe webhook
- Printable Bill of Lading page
- Supabase authentication and Row Level Security

## 1. Upload to GitHub
Extract the ZIP and upload **all files and folders inside this project** directly to the repository root. Do not upload the ZIP itself.

## 2. Supabase
Run `sql/FULL_SETUP.sql` in Supabase SQL Editor.

## 3. Netlify environment variables
Add these in Netlify → Project configuration → Environment variables:

- `SUPABASE_URL` = your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` = Supabase secret/service-role key (private)
- `STRIPE_SECRET_KEY` = Stripe test secret key first
- `STRIPE_WEBHOOK_SECRET` = webhook signing secret
- `SITE_URL` = `https://portal.migenteexpress.com`

Never put private keys in `config.js`.

## 4. Stripe webhook
Create a Stripe webhook endpoint:

`https://portal.migenteexpress.com/api/stripe-webhook`

Subscribe to:
- `checkout.session.completed`

Copy its signing secret into Netlify as `STRIPE_WEBHOOK_SECRET`.

## 5. Deploy
Connect the GitHub repository to the existing Netlify portal project. No build command is required. Publish directory: `.`

## Current scope
This is a functional MVP, not yet a full commercial dispatch suite. Live GPS tracking, automated Gmail messages, signature drawing, route optimization, AI phone answering, and payroll are future modules.
