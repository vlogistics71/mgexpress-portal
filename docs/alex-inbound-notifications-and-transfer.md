# Alex inbound customer calls — notifications, follow-ups and live-person handoff

## Deployment status
- Webhook receiver, database schema, call-history page, and authenticated follow-up API are committed.
- **Retell Alex agent setup and Netlify environment secrets must be configured before any live event can arrive.**
- **The owner provided the private destination number; it is now stored in the restricted Supabase `inbound_call_settings` table for SMS routing and internal reference. The live transfer is NOT activated until this destination is entered in the Retell Alex Transfer Call tool and tested. Never publish it in source code or website HTML.**
- Do not change the outbound sales agent, its webhook or its phone number. Do not replace an account-level webhook shared with other agents.

## Server URL for Alex only

`https://portal.migenteexpress.com/.netlify/functions/alex-inbound-webhook`

The endpoint responds 503 if signing credentials/agent ID are missing; rejects invalid signatures; filters all non-Alex events; records no full transcripts or recordings.

## Netlify environment variables on the portal site

| Name | Value |
| --- | --- |
| `RETELL_ALEX_WEBHOOK_KEY` | Secret Retell API key with **webhook** badge, NEVER put into GitHub or client-side JS |
| `RETELL_ALEX_AGENT_ID` | Exact inbound "MG Express Quote Line" (Alex) agent ID |
| `RESEND_API_KEY` | Existing email provider key; required for email alerts |
| `MG_INBOUND_ALERT_EMAIL` | Optional override. Default: `info@migenteexpress.com` |
| `MG_INBOUND_ALERT_PHONE` | Optional environment override; otherwise the private Supabase `inbound_call_settings.sms_alert_phone_e164` value is used. SMS also requires working Twilio credentials. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | Existing Twilio alert transport if you want SMS |

**Do not set the owner's personal cell as the public website number.** Transfer destinations and SMS recipients are internal settings. Don't point Retell back to the same number answered by Alex, or the transferred call will loop. Redeploy Netlify after secrets are configured.

## Retell Alex settings — only on the inbound Alex agent

1. In Retell, open the inbound agent currently called "MG Express Quote Line" / Alex, not Amanda/Eddie or any outbound sales agent.
2. Confirm agent ID and that its inbound number is the published MG Express number. Leave number associations unchanged.
3. In **Agent Level Webhook URL**, enter the webhook URL above. If another Alex webhook is already present, reconcile its behavior before replacing it; agent-level webhooks override account-level delivery for that agent.
4. Select these webhook events: `call_started`, `call_ended`, `call_analyzed`, `transfer_started`, `transfer_bridged`, `transfer_cancelled`, `transfer_ended`. Retell retries failures; our endpoint deduplicates by call ID and event kind.
5. Set **Post Call Analysis** custom fields:
   - `human_requested` — Boolean; true whenever the caller asked for a live person, manager or owner, even if no transfer was possible.
   - `quote_submitted` — Boolean; true only if the quote tool confirmed a successful saved submission. Not just if a quote was discussed.
   - `call_outcome` — Short text or selector such as `quote_created`, `question_only`, `early_hangup`, `transfer_connected`, `transfer_failed`, `callback_requested`.
6. For any event, the dispatch call log will retain the call ID, callback number when provided by the phone network, times, and outcome. The endpoint emails an alert on call start and end, plus escalations for human requests/failed transfers. An optional SMS can be added privately.

## Real-person transfer from Alex (needs Retell configuration + destination)

1. In Alex's tools/flow, create a **Transfer Call** tool directed to the owner's verified personal cell number in international **E.164** format. Retrieve this number from the restricted `public.inbound_call_settings` configuration; enter it in the private Retell dashboard, not in a GitHub file. The owner's number was provided in the management conversation.
2. Prefer **Warm Transfer** with human-answer detection and a short private summary ("MG Express caller requested a live person; here is the reason"). If your Retell version supports **Agentic Warm Transfer**, use `Cancel Transfer` on no answer to return caller to Alex.
3. In the transfer tool's trigger/agent instruction:
   > If a caller asks for a real person, owner, manager or dispatcher, stop collecting quote details and say, "Absolutely. I'll try to connect you with our team now." Use the live-person transfer tool immediately. Don't claim the transfer succeeded until it actually connects. If the owner cannot take the call, apologize once, offer to take their callback number and what they need, and flag the call for urgent follow-up.
4. Do not require the caller to finish a quote, provide an email, or explain why they need a human before attempting the transfer. Do not give out the owner's private cell phone number.
5. Test on a real phone call (not only an audio simulation): ask for a live person, verify the owner's phone actually rings, the call bridges, and a failed transfer returns to Alex or triggers a callback. Set caller ID appropriately for your telephony provider.

## Test matrix

- One completed quote: **start email**, **end email**, and a call-history record (whether or not the quote flow succeeded).
- One caller hangs up within a few seconds: end event still creates the call log, even if start event was missing.
- One caller asks for a human: transfer starts; a staff alert is sent; post-call extraction sets `human_requested`.
- A call where destination does not answer: caller is not abandoned; urgent follow-up log and transfer failure notification.
- Invalid webhook signature, wrong agent, wrong call ID: rejected/ignored, no fake leads.
- Retell retries event: no duplicate successful email for the same call/event.
- Webhook email provider down: call persisted, Retell receives retryable error, alert is retried.

## October 30, 2026 caller

The historical call cannot be recovered from the new database log because inbound call events were not stored at that time. In Retell Dashboard > Call History, filter October 30 and the Alex agent. Open the call to review summary, caller ID, any request to transfer, and exact disconnection outcome. Call the customer back if appropriate. Do not change the historical record or fabricate a call log.

## References

- https://docs.retellai.com/features/webhook-overview
- https://docs.retellai.com/features/secure-webhook
- https://www.retellai.com/learn/how-call-transfers-work-between-ai-voice-agents-and-human-teams
