"use strict";

const { requireDispatchAccess, sendResendEmail, supabaseRequest, toJsonResponse } = require("./_shared");
const { buildWelcomePacket } = require("./_welcome-packet-pdf");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCES = new Set(["phone", "email", "in_person", "website", "other"]);
const INTERESTED = new Set(["Contacted", "Follow-Up", "Quote Requested", "Customer"]);
const FROM = "MG Express Welcome <documents@notify.migenteexpress.com>";

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

function emailIsValid(value) {
  const email = String(value || "").trim();
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
}

function emailContent(lead) {
  const person = String(lead.contact || "").trim().split(/\s+/)[0] || "there";
  const greeting = escapeHtml(person);
  const business = escapeHtml(lead.business || "your business");
  const subject = "Welcome to Mi Gente Express - " + String(lead.business || "").slice(0, 80);
  const text = [
    "Hi " + person + ",",
    "",
    "Thank you for giving Mi Gente Express an opportunity to earn " + (lead.business || "your company") + "'s business!",
    "",
    "We help Denver, Aurora and nearby businesses coordinate local courier deliveries, including auto parts, legal documents, print shop orders and everyday business packages.",
    "",
    "Attached is our two-page welcome packet with an overview and instructions for your first delivery.",
    "",
    "Ready to try us? Reply with your pickup and drop-off details, or request a quote at https://www.migenteexpress.com.",
    "Dispatch will review availability and pricing before your delivery is confirmed.",
    "Initial payment instructions follow dispatch approval. Approved recurring accounts may qualify for biweekly billing.",
    "",
    "We're looking forward to working with you!",
    "Mi Gente Express Team",
    "www.migenteexpress.com",
    "",
    "If you no longer want introductory sales emails from MG Express, reply 'no more emails'."
  ].join("\n");
  const html = '<div style="max-width:620px;margin:auto;color:#20332a;font:15px/1.65 Arial,sans-serif">' +
    '<div style="padding:20px 24px;background:#073d30;color:#fff;border-bottom:4px solid #e45a50;font-weight:800;font-size:18px">MI GENTE EXPRESS</div>' +
    '<div style="padding:26px 24px">' +
    '<h2 style="margin:0 0 16px;color:#073d30">Welcome to Mi Gente Express!</h2>' +
    '<p>Hi ' + greeting + ',</p><p>Thank you for giving us the opportunity to earn <strong>' + business + '</strong>\'s business.</p>' +
    '<p>We help Denver, Aurora, and surrounding-area businesses coordinate local courier deliveries - from auto parts and legal documents to print shop orders and everyday business packages.</p>' +
    '<p>Our <strong>two-page welcome packet</strong> is attached, along with simple instructions for your first delivery.</p>' +
    '<p><strong>Ready to try us?</strong> Reply with pickup and delivery details, or request a quote at <a href="https://www.migenteexpress.com">migenteexpress.com</a>.</p>' +
    '<p>Dispatch will review availability and final pricing before confirming your delivery. First-order payment instructions follow dispatch approval. Eligible recurring accounts can apply for approved biweekly billing.</p>' +
    '<p>We look forward to working together!<br><strong>Mi Gente Express Team</strong></p>' +
    '<p style="font-size:12px;color:#5b6e63">If you prefer not to receive introductory sales emails from us, reply "no more emails".</p>' +
    '</div></div>';
  return { subject, text, html };
}

async function updateDelivery(id, updates) {
  await supabaseRequest("sales_welcome_packets?id=eq." + encodeURIComponent(id), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() })
  });
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") return toJsonResponse(405, { error: "POST required." });

  let dispatch;
  try {
    dispatch = await requireDispatchAccess(event);
  } catch (error) {
    return toJsonResponse(error.statusCode === 403 ? 403 : 401, { error: "Dispatch authentication required." });
  }

  let data;
  try { data = JSON.parse(event.body || "{}"); }
  catch (_) { return toJsonResponse(400, { error: "Invalid request." }); }

  const id = String(data?.lead_id || "");
  const action = String(data?.action || "");
  if (!UUID.test(id) || !["preview", "send"].includes(action)) {
    return toJsonResponse(400, { error: "A valid lead and action are required." });
  }

  let lead;
  try {
    const found = await supabaseRequest("sales_leads?select=id,business,contact,email,status&id=eq." + encodeURIComponent(id) + "&limit=1");
    lead = Array.isArray(found) ? found[0] : null;
  } catch (error) {
    console.error("Welcome lead lookup failed", { message: error.message });
    return toJsonResponse(503, { error: "Unable to load this lead." });
  }
  if (!lead) return toJsonResponse(404, { error: "Lead not found." });
  if (lead.status === "Not Interested") return toJsonResponse(409, { error: "This lead opted out. No welcome email can be sent." });

  if (action === "preview") {
    try {
      const buffer = await buildWelcomePacket(lead);
      return {
        statusCode: 200,
        isBase64Encoded: true,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": "attachment; filename=\"MG-Express-Welcome-Packet.pdf\"",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        },
        body: buffer.toString("base64")
      };
    } catch (error) {
      console.error("Welcome preview generation failed", { message: error.message });
      return toJsonResponse(503, { error: "Could not generate the welcome PDF." });
    }
  }

  // Sending is solely initiated by an authenticated staff member after email consent and explicit approval.
  if (!INTERESTED.has(String(lead.status || ""))) {
    return toJsonResponse(409, { error: "Mark the lead Contacted, Follow-Up or Quote Requested before sending a welcome email." });
  }
  if (!emailIsValid(lead.email)) return toJsonResponse(409, { error: "Save a valid customer email on the lead first." });
  if (data.confirmed_customer_requested_email !== true || !SOURCES.has(data.approval_source)) {
    return toJsonResponse(400, { error: "Confirm the customer's request and how permission was obtained." });
  }
  if (!String(process.env.RESEND_API_KEY || "").trim()) {
    return toJsonResponse(503, { error: "The MG Express email service is not configured." });
  }

  let reservationId;
  try {
    // UNIQUE(lead_id) means double-clicks and competing staff requests cannot duplicate mail.
    const record = await supabaseRequest("sales_welcome_packets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lead_id: lead.id,
        recipient_email: String(lead.email).trim(),
        business_name: String(lead.business || ""),
        contact_name: String(lead.contact || "") || null,
        approval_source: data.approval_source,
        approved_by: dispatch.user.id,
        status: "sending"
      })
    });
    reservationId = Array.isArray(record) && record[0]?.id;
    if (!reservationId) throw Error("Unable to reserve welcome packet delivery");
  } catch (error) {
    // No retry on uncertain delivery outcomes. This is deliberate to avoid double-sending.
    if (error.statusCode === 409 || error.statusCode === 23505 || error.data?.code === "23505") {
      return toJsonResponse(409, { error: "A welcome email was already attempted for this lead. Review its delivery status before any resend." });
    }
    console.error("Welcome packet reservation failed", { message: error.message });
    return toJsonResponse(503, { error: "Could not reserve this welcome email. No message was sent." });
  }

  try {
    const pdf = await buildWelcomePacket(lead);
    const content = emailContent(lead);
    const response = await sendResendEmail({
      from: FROM,
      to: String(lead.email).trim(),
      subject: content.subject,
      html: content.html,
      text: content.text,
      attachments: [{ filename: "MG-Express-Welcome-Packet.pdf", content: pdf.toString("base64") }]
    });
    if (!response?.configured) throw Error("Email provider is not configured");
    await updateDelivery(reservationId, {
      status: "sent",
      sent_at: new Date().toISOString(),
      provider_message_id: String(response.data?.id || "").slice(0, 250) || null
    });
    return toJsonResponse(200, { ok: true, sent_to: String(lead.email).trim(), attachment: "MG-Express-Welcome-Packet.pdf" });
  } catch (error) {
    console.error("Welcome email send or receipt failed", { message: error.message });
    try {
      await updateDelivery(reservationId, { status: "needs_review", last_error: String(error.message || "Provider error").slice(0, 250) });
    } catch (writeError) {
      console.error("Could not update welcome delivery receipt", { message: writeError.message });
    }
    return toJsonResponse(503, {
      error: "Welcome email status could not be confirmed. Check Resend and the lead record before attempting another send."
    });
  }
};

exports._test = { emailContent, emailIsValid };
