# Amanda Retell webhook — secure MG Express integration

Status: **RECEIVER CODE PREPARED; PROVIDER CONFIG NOT CONNECTED**. Outbound AI dialing remains disabled. Existing Alex Quote Line agent, quote function, inbound number, and inbound routing are not changed.

## What we confirmed on October 8, 2026
The live Retell workspace contains two agents: **MG Express Quote Line** (inbound, associated with Alex) and **Mia - MG Express Outbound Sales** (the planned Amanda agent). Both currently show the same phone number association; do not change either assignment during onboarding. Mia has \`end_call\` and \`transfer_to_andre\`, plus post-call extraction fields \`call_outcome\`, \`decision_maker_name\`, \`business_name\`, \`phone_number\`, \`email\`, \`delivery_need_type\`, \`best_callback_time\`, \`do_not_call\`, and \`notes_for_andre\`. A warm transfer destination exists, but its live routing is untested. The sales agent's **Agent Level Webhook URL was blank** in the user's screenshot.

## New MG Express receiver

Endpoint:
\`https://portal.migenteexpress.com/.netlify/functions/amanda-retell-webhook\`

- Uses Retell documented **HMAC-SHA256** \`X-Retell-Signature\`, timestamp within five minutes, exact raw body and constant-time digest comparison.
- Requires \`RETELL_AMANDA_AGENT_ID\` matching the sending agent; ignores every other agent and all inbound calls.
- Processes only the \`call_analyzed\` event; ignores \`call_started\` / \`call_ended\` and transcript streams.
- Extracts whitelisted business contact, outcome, callback, delivery need and DNC fields into \`public.sales_ai_call_events\` as \`event_kind='amanda_call_analyzed'\`.
- For genuine **outbound** telephone calls, uses \`call.to_number\` as verified prospect destination for DNC, never a phone number inferred by the AI.
- Writes flagged DNC requests to \`public.sales_ai_dnc\` **before** persisting the call report. A write failure returns a retryable error. Replayed calls use \`provider_call_id\` as the unique key to avoid duplicate reports.
- No raw transcript or audio recording is saved. No lead is automatically created and no customer is contacted or emailed.
- The separate \`amanda-call-reviews.html\` page lets authenticated dispatch users inspect received results. It is linked from the existing Leads page.
- Calls with a known \`call.metadata.mg_express_lead_id\` and matching phone number can be linked back to that lead automatically. Other calls are marked \`Needs matching\` and must be reviewed by dispatch. Never silently match only by an AI-suggested contact name.

## BEFORE entering the URL in Retell

1. In Retell, open Mia (rename to Amanda once prompt/tests are ready) → click **ID** near the agent editor. Copy the *agent ID*, not any API key. Do not use Alex's ID.
2. In Retell Settings → API Keys, identify an API key with the **webhook** badge. Never paste it into ChatGPT, GitHub, or any frontend/browser JavaScript.
3. In Netlify, open your **mgexportal** site → Site configuration → Environment variables. Add:
   - \`RETELL_AMANDA_WEBHOOK_KEY\` = that **webhook-badged Retell API key** (secret).
   - \`RETELL_AMANDA_AGENT_ID\` = exact agent ID for Mia/Amanda.
   - \`AMANDA_WEBHOOK_ENABLED\` = \`true\` **only after** the server-side secret and agent ID are correctly set and the Netlify deployment succeeded.
   - \`AMANDA_WEBHOOK_ALLOW_WEB_TESTS\` = \`true\` temporarily if testing via Retell Test Audio; return to \`false\` after browser testing.
   The endpoint stays disabled by default; outbound dialing is never enabled by this flag.
4. Redeploy the Netlify site to load environment changes.
5. In Retell's **Mia/Amanda agent only**, expand Webhook settings → Agent Level Webhook URL. Paste the endpoint above, then configure **Webhook Events → Set Up → call_analyzed** (select that event alone when available). Save the draft. **Never enter this as an account-level webhook**; doing so could affect Alex or another agent. Retell agent-level webhooks supersede the account-level webhook for that agent, so confirm whether any other sales webhook exists before replacement.
6. Browser test: play one call in Retell Test Audio (not a telephone dial), with \`AMANDA_WEBHOOK_ALLOW_WEB_TESTS=true\`, and say "We have a print shop; I'm interested in a first delivery" then another with a do-not-call request. Confirm a **browser test** record is visible in the staff review page, and that no real-number DNC record is created for a browser-only test.
7. Configure post-call extraction \`trial_delivery_interest\` (boolean) and \`email_permission\` (boolean) when desired; the current extraction setup may not have these. Keep existing fields. The review page labels email permission as **claimed**, never as staff-verified marketing consent. Do not auto-send an email.
8. Independently test Alex by calling the inbound business number and requesting a quote. Compare with prior behavior.
9. **No outbound AI sales calls** without legal review of artificial/prerecorded-voice telemarketing, Colorado registration/no-call rules, consent collection/verification, DNC procedures, carrier requirements, times of day, and human transfer readiness. Retell call-analysis webhooks are *post-call only*, not a pre-call authorization system.

## Important diagnostic notes
- \`AMANDA_WEBHOOK_ENABLED\` defaults OFF. If the webhook receives a correctly signed event while disabled, it acknowledges without storing anything, so only set the Retell URL after Netlify config is verified.
- A missing signing key or agent ID fails closed. Invalid signatures get HTTP 401. Verify a key with the webhook badge, not a different project API key.
- Webhook responses need to finish in ten seconds or Retell retries up to three times; the upsert event log prevents duplicates.
- DNC processing via post-call extraction is **not enough for mid-call real-time suppression**. Before dialing is enabled, configure Retell's real-time DNC function and an authenticated callback integration to ensure suppression happens as soon as the prospect opts out. Until then, outbound calls must stay disabled.
- If a call record has no metadata linking to a lead, staff may review details and manually enter a corresponding sales lead. No new account is made, and the ten-delivery customer-login policy remains intact.

## References

- https://docs.retellai.com/features/webhook-overview
- https://docs.retellai.com/features/secure-webhook
- https://docs.retellai.com/build/do-not-call
- https://github.com/vlogistics71/mgexpress-portal/blob/main/docs/amanda-retell-v1-build-kit.md
