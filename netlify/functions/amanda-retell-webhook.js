"use strict";

// Amanda only. Authenticated Retell -> sanitized call results -> dispatch review.
// No dial-out integration, no customer emails, no automatic account creation.
// Does not modify Alex's inbound receptionist route or quote endpoint.
const crypto = require("crypto");
const { supabaseRequest, toJsonResponse } = require("./_shared");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const E164 = /^\+[1-9]\d{7,14}$/;
const CALL_ID = /^[A-Za-z0-9_-]{8,128}$/;

function verifyRetellSignature(rawBody, signature, key, now = Date.now()) {
  if (!key || !signature || typeof signature !== "string") return false;
  const match = /^v=(\d{13}),d=([a-fA-F0-9]{64})$/.exec(signature.trim());
  if (!match) return false;
  const when = Number(match[1]);
  if (!Number.isSafeInteger(when) || Math.abs(now - when) > 300000) return false;
  const actual = Buffer.from(match[2], "hex");
  const expected = crypto.createHmac("sha256", key).update(rawBody + match[1], "utf8").digest();
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function plain(value, length = 180) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, length);
}
function truthy(value) { return value === true || String(value).toLowerCase().trim() === "true"; }
function phoneE164(raw) {
  const text = plain(raw, 32);
  const digits = text.replace(/\D/g, "");
  if (text.startsWith("+") && E164.test("+" + digits)) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}
function callDetails(call) {
  const custom = call.call_analysis?.custom_analysis_data;
  const analysis = custom && typeof custom === "object" && !Array.isArray(custom) ? custom : {};
  const metadata = call.metadata && typeof call.metadata === "object" ? call.metadata : {};
  return {
    business: plain(analysis.business_name || metadata.business_name, 120),
    contact: plain(analysis.decision_maker_name, 120),
    email: plain(analysis.email, 254),
    delivery_need: plain(analysis.delivery_need_type, 220),
    callback_time: plain(analysis.best_callback_time, 120),
    outcome: plain(analysis.call_outcome, 90),
    notes_for_dispatch: plain(analysis.notes_for_andre || analysis.notes_for_dispatch, 600),
    summary: plain(call.call_analysis?.call_summary, 600),
    user_sentiment: plain(call.call_analysis?.user_sentiment, 40),
    trial_delivery_interest: truthy(analysis.trial_delivery_interest),
    email_permission_claimed: truthy(analysis.email_permission),
    do_not_call: truthy(analysis.do_not_call),
    proposed_email: plain(analysis.email, 254)
  };
}
async function matchLeadByMetadata(call, destinationPhone) {
  const id = String(call.metadata?.mg_express_lead_id || "").trim();
  if (!UUID.test(id)) return null;
  const data = await supabaseRequest(
    "sales_leads?select=id,phone,status&id=eq." + encodeURIComponent(id) + "&limit=1"
  );
  const lead = Array.isArray(data) ? data[0] : null;
  if (!lead || !destinationPhone || phoneE164(lead.phone) !== destinationPhone) return null;
  return lead.id;
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") return toJsonResponse(405, { error: "POST required" });
  const key = String(process.env.RETELL_AMANDA_WEBHOOK_KEY || "").trim();
  const id = String(process.env.RETELL_AMANDA_AGENT_ID || "").trim();
  // Fail closed until both secrets and an exact agent ID are configured in Netlify.
  if (!key || !id) return toJsonResponse(503, { error: "Amanda webhook not configured" });
  const body = event.isBase64Encoded
    ? Buffer.from(String(event.body || ""), "base64").toString("utf8")
    : String(event.body || "");
  if (!body || Buffer.byteLength(body, "utf8") > 262144) {
    return toJsonResponse(413, { error: "Invalid payload size" });
  }
  const signature = event.headers?.["x-retell-signature"] || event.headers?.["X-Retell-Signature"];
  if (!verifyRetellSignature(body, signature, key))
    return toJsonResponse(401, { error: "Unauthorized" });

  let payload;
  try { payload = JSON.parse(body); }
  catch (_) { return toJsonResponse(400, { error: "Invalid JSON" }); }

  const call = payload?.call;
  if (!call || typeof call !== "object" || String(call.agent_id) !== id)
    return { statusCode: 204, body: "" };
  if (payload.event !== "call_analyzed") return { statusCode: 204, body: "" };
  const callId = String(call.call_id || "");
  if (!CALL_ID.test(callId)) return toJsonResponse(400, { error: "Invalid call ID" });

  // Browser audio tests can be admitted separately for controlled smoke testing, but
  // browser calls have no verified prospect telephone number and cannot set DNC.
  const webTest = call.call_type === "web_call";
  if (webTest) {
    if (process.env.AMANDA_WEBHOOK_ALLOW_WEB_TESTS !== "true") return { statusCode: 204, body: "" };
  } else if (call.direction !== "outbound" || call.call_type !== "phone_call") {
    return { statusCode: 204, body: "" };
  }
  if (process.env.AMANDA_WEBHOOK_ENABLED !== "true") return { statusCode: 204, body: "" };

  const destinationPhone = webTest ? null : phoneE164(call.to_number);
  const details = callDetails(call);

  // DNC is a higher priority than generic analysis. It is written *before*
  // the idempotent call log so a Retell retry can recover a transient failure.
  if (details.do_not_call && !webTest && !destinationPhone)
    return toJsonResponse(503, { error: "Cannot persist DNC without destination number" });

  try {
    let leadId = null;
    if (!webTest) leadId = await matchLeadByMetadata(call, destinationPhone);
    if (details.do_not_call && destinationPhone) {
      await supabaseRequest("sales_ai_dnc?on_conflict=phone_e164", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "resolution=ignore-duplicates,return=minimal"
        },
        body: JSON.stringify({
          phone_e164: destinationPhone,
          reason: "Retell post-call opt-out",
          source: "Amanda - Retell verified webhook"
        })
      });
    }

    // Do not store recordings or raw transcript content. This is a staff-facing
    // review record. Retell can retry: unique provider_call_id prevents duplicates.
    await supabaseRequest("sales_ai_call_events?on_conflict=provider_call_id", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal"
      },
      body: JSON.stringify({
        provider_call_id: callId,
        event_kind: "amanda_call_analyzed",
        phone_e164: destinationPhone,
        lead_id: leadId,
        details: {
          ...details,
          tested_in_browser: webTest,
          needs_staff_review: true,
          linked_to_lead: Boolean(leadId)
        }
      })
    });
    return { statusCode: 204, body: "" };
  } catch (error) {
    // Retell retries on 5xx. Do not acknowledge failed opt-out/sales event writes.
    console.error("Amanda webhook save failed", { code: error.statusCode || 500, message: error.message });
    return toJsonResponse(503, { error: "Unable to persist Amanda call event" });
  }
};

exports._test = { verifyRetellSignature, phoneE164, callDetails, truthy };
