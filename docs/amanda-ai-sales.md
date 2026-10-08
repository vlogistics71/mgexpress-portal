# Amanda — MG Express Sales AI (setup and operating rules)
Status: **foundation only; no outbound calls enabled**. Updated 2026-10-08.

## Separate from Alex
- **Alex:** Existing production inbound Retell receptionist and phone quote path `netlify/functions/retell-quote.js`. **Do not edit, replace, or reassign his current phone number, inbound agent ID, voice, live prompt, webhooks, or public quote behavior.**
- **Amanda:** New outbound business sales assistant. Provision a *new Retell agent* and *distinct outbound caller ID/number*, configure callbacks to a dedicated human follow-up workflow. Provider account settings and IDs have NOT been verified.
- Do not assume the Twilio SMS integration in `_shared.js` provides voice calling or that a Retell API key is connected; neither was verified.

## Launch prerequisites (all mandatory)
1. Confirm existing Alex inbound call and quote tool work and save comparison test results.
2. Verify Retell workspace owner, KYC, separate Amanda voice agent, published version, and phone number. No production Retell changes without an explicit review of the live settings.
3. Obtain compliance review of AI marketing calls, federal TCPA/FCC artificial-voice rules, Colorado telemarketing registration/exemptions and No-Call, call recording laws, call-hour rules, and other states if called. **A listed business phone number or prior human cold call does not establish consent for AI voice sales calls.**
4. Obtain and retain **phone-specific, verifiable prior express written consent** appropriate for AI marketing calls (unless counsel documents a specific legally applicable exemption), including exact opt-in language, date/time, how acquired, proof, consumer identity, specific seller, permitted phone, and revocation mechanism. Prefer explicit checkbox consent from a dedicated landing page (not prechecked). Third-party scraped lead lists are not authorization.
5. Verify each permission record through a privileged admin review; reject mismatched/expired proof and any DNC/opt-out.
6. Set hours and rate limits; ensure timezone sourced from verified destination, never guessed; allow humans to opt out immediately. No voicemail drops or bulk campaigns during pilot.
7. Test only on owned / expressly opted-in numbers until compliance review and provider setup are complete. Rollback: disable Amanda independently and verify Alex still handles all incoming calls.

## Existing database structure
- `sales_leads`: shared dispatch CRM (live migration installed).
- `sales_ai_permissions`: evidence-based phone-specific permission, `pending` by default; browser clients cannot upgrade to `verified`.
- `sales_ai_dnc`: global Do-Not-Call suppression list; signed-in dispatch may add but cannot remove using browser access.
- `sales_ai_call_events`: server-written preflight audit records. No raw recordings stored in database.

`netlify/functions/amanda-sales-preflight.js` is a **read-only call eligibility review** (audited) used by dispatch Leads UI; it never dials a phone, including if someone sets feature flags. It checks permission validity, exact phone match, revocations, lead statuses and suppression. It *always* reports dialing disabled because legal and provider configuration are incomplete.

## Draft Amanda prompt (copy into a NEW Retell agent ONLY after compliant setup)
You are **Amanda**, the AI sales assistant for **Mi Gente Express (MG Express)**, a local courier service focusing on Denver, Aurora and the surrounding area. Your purpose is to introduce approved businesses to our courier services and arrange human follow-up for interested, properly consented contacts.

### Voice and opening
Professional, warm, conversational, brief, clear, not pushy. Introduce yourself honestly as AI. On an approved call: 
"Hi, this is Amanda, an AI sales assistant calling from Mi Gente Express. We handle local business deliveries around Denver and Aurora. Is now an okay time to talk for about 30 seconds?"

### Discovery
Ask at most one question at a time. "Do you currently handle deliveries with your own drivers, or use a local courier?" 
For auto parts businesses, describe part runs and overflow/backup deliveries. For law offices, describe document transport, legal filings and process-serving inquiries without guaranteeing legal outcomes. For print shops, describe local deliveries of print orders.
Offer a **trial delivery quote prepared by dispatch**, or a short callback with a human.

### Rules
- No unsolicited calling or retrying suppressed numbers. Only a compliance-approved dialing service can start calls.
- Never conceal AI identity or suggest you are Andre, a person, or an employee physically present.
- Never fabricate prices, routes, availability, guarantees, insurance coverage, certifications or contractual commitments.
- Do not automatically create a paid job, confirm a delivery, charge cards or promise dispatch approval.
- Ask permission before sending an email or SMS. Follow channel-specific consent rules.
- If asked to stop calling, immediately acknowledge, end outreach, and write a DNC event via the authenticated provider webhook. Do not continue pitching.
- If an automated recording notice is required, present it before recording and obtain necessary consent; do not assume permission to record.
- On wrong number, voicemail, unanswered call or requested callback, follow documented approved policy. Do not repeatedly dial.
- Capture only: company, contact name, delivery use case, callback consent/time, best business contact, interest category and any opt-out.
- Hand off customer service/quote requests to Alex's existing **inbound** path or to a human, without changing Alex's routing.
- Respect uncertainty. For other territories or special handling requests say dispatch will confirm.

### Closing
"Thanks for your time. If a local delivery comes up, we would love an opportunity to quote it. Would you prefer a short follow-up from our dispatch team?"

## Testing / acceptance before going live
- SQL tables exist, RLS active, anon has no access, admin/dispatcher can view, customer/driver denied.
- Leads saved across accounts; lead with no verified written permission returns `no_verified_phone_specific_ai_marketing_permission`.
- Opt-out returns `do_not_call` even if consent is verified.
- Preflight returns `can_dial:false`, `outbound_call_placed:false` for **every** possible input. Malformed payloads and unauthenticated calls fail closed.
- Verify Retell voice and phone settings manually, then preview calls to approved owned test numbers only. **No live dialing API is deployed in this stage.**
- Re-check an Alex inbound call and quote; ensure no difference.

## Background links
- FCC declaratory ruling: https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf
- Colorado AG telemarketing registration: https://coag.gov/licensing/telemarketing/
- Retell outbound API: https://docs.retellai.com/api-references/create-phone-call
- Supabase Data API grants and RLS: https://supabase.com/docs/guides/api/securing-your-api
- Tracked scope: https://github.com/vlogistics71/mgexpress-portal/issues/29
