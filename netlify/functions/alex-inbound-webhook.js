"use strict";

// Alex inbound-only Retell webhook. Records every call even if no quote is created.
// Configured independently from the outbound sales webhook and agent.
const crypto = require("crypto");
const { supabaseRequest, toJsonResponse, sendResendEmail, sendTwilioSms } = require("./_shared");

const EVENTS = new Set([
  "call_started", "call_ended", "call_analyzed",
  "transfer_started", "transfer_bridged", "transfer_cancelled", "transfer_ended"
]);
const CALL_ID = /^[A-Za-z0-9_-]{6,128}$/;
const PHONE = /^\+[1-9]\d{7,14}$/;

function shortText(value, limit = 300) {
  return (typeof value === "string" || typeof value === "number" ? String(value) : "")
    .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}
function asPhone(value) {
  const v = shortText(value, 32);
  const digits = v.replace(/\D/g, "");
  if (v.startsWith("+") && PHONE.test("+" + digits)) return "+" + digits;
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}
function boolField(obj, field) {
  return Object.prototype.hasOwnProperty.call(obj, field)
    ? (obj[field] === true || String(obj[field]).trim().toLowerCase() === "true") : null;
}
function occurredAt(value) {
  const time = Number(value);
  if (!Number.isFinite(time) || time <= 0) return null;
  const date = new Date(time < 100000000000 ? time * 1000 : time);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function verifySignature(body, signature, secret, now = Date.now()) {
  if (!secret || typeof signature !== "string") return false;
  const match = /^v=(\d{13}),d=([0-9a-f]{64})$/i.exec(signature.trim());
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 300000) return false;
  const expected = crypto.createHmac("sha256", secret).update(body + match[1], "utf8").digest();
  const supplied = Buffer.from(match[2], "hex");
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
function encodeQuery(value) { return encodeURIComponent(value); }
function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
async function rows(path) {
  const result = await supabaseRequest(path);
  return Array.isArray(result) ? result : [];
}
async function saveCall(doc) {
  await supabaseRequest("inbound_calls?on_conflict=provider_call_id", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(doc)
  });
}
async function eventRecord(id, kind) {
  const result = await rows("inbound_call_events?select=provider_call_id,event_type,notification_sent_at&provider_call_id=eq." +
    encodeQuery(id) + "&event_type=eq." + encodeQuery(kind) + "&limit=1");
  if (result.length) return result[0];
  await supabaseRequest("inbound_call_events?on_conflict=provider_call_id,event_type", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ provider_call_id: id, event_type: kind })
  });
  return (await rows("inbound_call_events?select=provider_call_id,event_type,notification_sent_at&provider_call_id=eq." +
    encodeQuery(id) + "&event_type=eq." + encodeQuery(kind) + "&limit=1"))[0] || {};
}
async function markNotified(id, kind, error) {
  await supabaseRequest("inbound_call_events?provider_call_id=eq." + encodeQuery(id) + "&event_type=eq." + encodeQuery(kind), {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      notification_sent_at: error ? null : new Date().toISOString(),
      last_notification_error: error ? shortText(error, 220) : null
    })
  });
}
function shouldAlert(kind, record) {
  return kind === "call_started" || kind === "call_ended" ||
    kind === "transfer_started" || kind === "transfer_cancelled" ||
    (kind === "call_analyzed" && record.requested_human && record.human_request_known);
}
function alertTitle(kind, call) {
  if (kind === "call_started") return "Incoming call from " + (call.caller_phone || "Unknown number");
  if (kind === "call_ended") return "Call ended: " + (call.caller_phone || "Unknown number");
  if (kind === "transfer_started") return "LIVE PERSON REQUEST: transfer initiated";
  if (kind === "transfer_cancelled") return "URGENT: live transfer did not connect";
  return "Follow-up needed: caller requested a real person";
}
async function sendAlert(kind, record) {
  const email = String(process.env.MG_INBOUND_ALERT_EMAIL || "info@migenteexpress.com").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Invalid inbound alert email configuration");
  }
  const title = alertTitle(kind, record);
  const details = [
    "Caller: " + (record.caller_phone || "Unknown / blocked"),
    "Business line: " + (record.called_number || "Unknown"),
    "Outcome: " + (record.end_reason || (kind === "call_started" ? "Call in progress" : "Awaiting post-call analysis")),
    "Requested live person: " + (record.human_request_known ? (record.requested_human ? "Yes" : "No") : "Not yet determined"),
    "Quote submitted: " + (record.quote_status === "submitted" ? "Yes (reported)" : record.quote_status === "not_submitted" ? "No (reported)" : "Not verified"),
    "Transfer status: " + (record.transfer_state || "Not reported"),
    "Summary: " + (record.summary || "Awaiting post-call details"),
    "Call ID: " + record.provider_call_id
  ];
  const body = title + "\n\n" + details.join("\n") +
    "\n\nReview: https://portal.migenteexpress.com/inbound-calls.html\n" +
    "Follow up if the caller did not complete an order, disconnected, or requested a live person.";
  const outcome = await sendResendEmail({
    from: "MG Express Calls <quotes@notify.migenteexpress.com>",
    to: [email],
    subject: "[MG Express Calls] " + title,
    text: body,
    html: "<h2>" + escapeHtml(title) + "</h2><p>" +
      details.map(item => escapeHtml(item)).join("<br>") +
      '</p><p><a href="https://portal.migenteexpress.com/inbound-calls.html">Review incoming calls in Dispatch</a></p>'
  });
  if (!outcome.configured) throw new Error("RESEND_API_KEY is not configured");

  // Optional second channel, only when a verified personal alert number is set.
  const phone = asPhone(process.env.MG_INBOUND_ALERT_PHONE);
  if (phone) {
    try {
      const text = "[MG Express] " + title + ". Caller: " +
        (record.caller_phone || "Unknown") + ". Review inbound calls in dispatch.";
      await sendTwilioSms({ to: phone, body: text });
    } catch (error) {
      console.error("Alex inbound SMS alert failed", { message: error.message });
      // Email already succeeded; do not trigger a duplicate email retry.
    }
  }
}
exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return toJsonResponse(405, { error: "POST required" });
  const key = String(process.env.RETELL_ALEX_WEBHOOK_KEY || "").trim();
  const agentId = String(process.env.RETELL_ALEX_AGENT_ID || "").trim();
  if (!key || !agentId) return toJsonResponse(503, { error: "Alex inbound webhook not configured" });

  const raw = event.isBase64Encoded
    ? Buffer.from(String(event.body || ""), "base64").toString("utf8")
    : String(event.body || "");
  if (!raw || Buffer.byteLength(raw, "utf8") > 262144)
    return toJsonResponse(413, { error: "Webhook payload too large" });
  const signature = event.headers?.["x-retell-signature"] || event.headers?.["X-Retell-Signature"];
  if (!verifySignature(raw, signature, key)) return toJsonResponse(401, { error: "Unauthorized" });

  let packet;
  try { packet = JSON.parse(raw); } catch (_) { return toJsonResponse(400, { error: "Invalid JSON" }); }
  const call = packet?.call;
  const kind = String(packet?.event || "");
  if (!EVENTS.has(kind) || !call || String(call.agent_id || "") !== agentId)
    return { statusCode: 204, body: "" };
  if (call.call_type && call.call_type !== "phone_call") return { statusCode: 204, body: "" };
  if (call.direction && call.direction !== "inbound") return { statusCode: 204, body: "" };
  const id = String(call.call_id || "");
  if (!CALL_ID.test(id)) return toJsonResponse(400, { error: "Invalid call identifier" });

  try {
    const existing = (await rows("inbound_calls?select=*&provider_call_id=eq." + encodeQuery(id) + "&limit=1"))[0] || {};
    const custom = call.call_analysis?.custom_analysis_data || {};
    const reportedHuman = boolField(custom, "human_requested") ??
      boolField(custom, "requested_live_person") ?? boolField(custom, "wants_human");
    const reportedQuote = boolField(custom, "quote_submitted");
    const requestedHuman = existing.requested_human === true ||
      reportedHuman === true || ["transfer_started", "transfer_bridged", "transfer_cancelled"].includes(kind);
    const record = {
      provider_call_id: id,
      agent_id: agentId,
      caller_phone: asPhone(call.from_number) || existing.caller_phone || null,
      called_number: asPhone(call.to_number) || existing.called_number || null,
      started_at: occurredAt(call.start_timestamp) || existing.started_at || null,
      ended_at: occurredAt(call.end_timestamp) || existing.ended_at || (kind === "call_ended" ? new Date().toISOString() : null),
      last_event: kind,
      end_reason: shortText(call.disconnection_reason || existing.end_reason, 100) || null,
      summary: shortText(call.call_analysis?.call_summary || existing.summary, 600) || null,
      call_outcome: shortText(custom.call_outcome || existing.call_outcome, 100) || null,
      requested_human: requestedHuman,
      human_request_known: existing.human_request_known === true || reportedHuman !== null ||
        ["transfer_started", "transfer_bridged", "transfer_cancelled"].includes(kind),
      transfer_state: kind.startsWith("transfer_") ? kind.replace("transfer_", "") : existing.transfer_state || null,
      quote_status: reportedQuote === true ? "submitted" :
        reportedQuote === false ? "not_submitted" : existing.quote_status || "unknown",
      follow_up_status: existing.follow_up_status || "needs_follow_up",
      updated_at: new Date().toISOString()
    };
    await saveCall(record);
    const item = await eventRecord(id, kind);
    if (!shouldAlert(kind, record) || item.notification_sent_at) return { statusCode: 204, body: "" };
    try {
      await sendAlert(kind, record);
      await markNotified(id, kind, null);
      return { statusCode: 204, body: "" };
    } catch (error) {
      await markNotified(id, kind, error.message).catch(() => {});
      console.error("Alex call alert not sent", { id, kind, message: error.message });
      return toJsonResponse(503, { error: "Call recorded, notification pending retry" });
    }
  } catch (error) {
    console.error("Alex call webhook persistence failed", { kind, message: error.message });
    return toJsonResponse(503, { error: "Could not save inbound call event" });
  }
};
exports._test = { verifySignature, asPhone, boolField, shouldAlert, shortText };
