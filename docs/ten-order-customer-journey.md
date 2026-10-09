# MG Express Customer Journey — 10 Completed Order Rule

The new **Customer Follow-Ups** dashboard lives at `/sales-followups.html` and is linked from `/leads.html`.

## Customer experience
1. New customers **do not receive a portal account** when they request a quote, receive their welcome packet or place their first order.
2. Dispatch links the delivery to the correct sales lead using its job number or ID; for safety, the lead email must exactly match the order's saved customer email. A mismatched order is not counted until staff reconcile records.
3. A job counts toward the milestone **only when its actual delivery status is completed/delivered**. Canceled jobs never count, even if stale workflow fields say delivered. Each real job has a unique link and can only count once.
4. The day after the business's first completed delivery (next Denver business day), dispatch sees a reminder to follow up. Thank-you emails are **never sent automatically**; staff attests customer requested an email and confirms the address. A one-time send receipt prevents duplicate mail.
5. After **10 completed linked deliveries**, the dashboard enables **Offer Account** for dispatch. A staff member confirms consent and sends an invitation **to apply**, not an activated login. Prior to 10, the server returns HTTP 409 regardless of client UI controls.
6. The customer may accept or decline the invitation. An actual login or biweekly billing account is only provisioned separately after the standard staff approval process. This workflow never calls Supabase Auth signup/invite, never inserts into customer_portal_accounts, and never turns on billing automatically.

## Implementation
- `supabase/sales-customer-journey.sql`: staff-read-only sales lead/order links and email outreach receipts. Service role can write only from authenticated server endpoints. RLS on; anon access removed.
- `netlify/functions/sales-journey.js`: authenticated GET stats and POST link/send actions; email proof, status, DNC/Not Interested guard; no Retell, Alex, Amanda or phone calls touched.
- `sales-followups.html` and `assets/js/sales-followups.js`: mobile dashboard, 0/10 through 10/10 progress, due follow-ups, trial thank-you, account offer controls.
- Existing `sales_leads` and `sales_welcome_packets` continue untouched except for a navigation shortcut.

## Operator steps
1. Open `/leads.html` and create or open a business lead with the same contact email used on dispatch orders.
2. Open **Customer Follow-Ups · 10 Orders**, choose **Link delivery**, verify its owner, enter its job number/ID and confirm.
3. When the linked job is marked completed, the count and first-delivery due reminder update when the page reloads.
4. Get permission for a thank-you email, choose how permission was obtained, review the recipient and approve it.
5. After 10 completed jobs, **Offer account** becomes available. An invitation email will invite the business to **apply**, not automatically create a login.

## Limits and safety
- This is a staff-facing, on-demand follow-up dashboard. It does **not** schedule an automatic email, or call prospects. Follow-up reminders update on refresh.
- All links are explicit; existing historical orders are not automatically mapped by email to avoid wrong-company matches.
- Email is approved manually and protected against duplicate sends. If provider status is unknown, staff must review before any resend.
- Large-account reporting currently rejects beyond 500 leads or 1,900 linked orders rather than silently undercount the 10-order requirement.
- For privacy, admin/dispatch staff can read the data, and only the authenticated server may write link/outreach records.
- Existing customer portal accounts and customer login eligibility are unchanged for current customers. New account invitations from this sales workflow are gated at ten completed orders.

## Testing completed
- JS syntax validation.
- Simulated 9 vs 10 threshold, canceled deliveries, wrong customer email, auth, email consent, duplicate sends, provider failure and staff approval.
- Live Supabase RLS check: anonymous denied, staff read-only, service role writes. Security advisors no new warnings for these tables.

