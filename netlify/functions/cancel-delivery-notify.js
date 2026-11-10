"use strict";

const {
  loadQuoteById,
  requireDispatchAccess,
  sendResendEmail,
  supabaseRequest,
  toJsonResponse,
  updateQuoteById
} = require("./_shared");

const REASONS = Object.freeze({
  out_of_service_area: "The pickup or delivery location is outside our current service area.",
  no_driver_available: "We do not have an available driver for this delivery.",
  schedule_unavailable: "We cannot meet the requested pickup or delivery time.",
  address_cannot_be_verified: "We were unable to verify the pickup or delivery address.",
  vehicle_unavailable: "We cannot provide the required vehicle for this delivery.",
  unable_to_accommodate: "Unfortunately, we are unable to accommodate this delivery request."
});

function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function reply(status, data) {
  return toJsonResponse(status, data);
}

function validId(text) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(text || ""));
}

function getStoredReason(quote) {
  const match = String(quote.exception_notes || "").match(/^Cancellation reason: ([a-z_]+)/);
  return match && Object.prototype.hasOwnProperty.call(REASONS, match[1]) ? match[1] : null;
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return reply(405, { error: "Method not allowed." });
  try {
    const actor = await requireDispatchAccess(event);
    const data = JSON.parse(event.body || "{}");
    const id = String(data.quote_id || "").trim();
    if (!validId(id)) return reply(400, { error: "Invalid delivery ID." });

    // Always get the recipient from the trusted quote, never from the browser's address fields.
    const quote = await loadQuoteById(id);
    if (!quote) return reply(404, { error: "Delivery not found." });
    const email = String(quote.customer_email || "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply(409, { error: "This order has no valid customer email. Add or verify it before cancelling and notifying." });
    }
    if (String(data.confirmed_job_number || "").trim() !== String(quote.job_number || "").trim() ||
        String(data.confirmed_customer_email || "").trim().toLowerCase() !== email ||
        data.confirm_customer_verified !== true) {
      return reply(409, { error: "Customer verification failed. Confirm the job number and customer email shown in the order." });
    }

    if (!process.env.RESEND_API_KEY) {
      return reply(503, { error: "Customer notifications are not configured. No cancellation was made." });
    }

    const retry = data.resend_only === true;
    let reason = retry ? getStoredReason(quote) : String(data.reason || "").trim();
    if (!Object.prototype.hasOwnProperty.call(REASONS, reason)) {
      return reply(400, { error: "Select a cancellation reason." });
    }

    const status = String(quote.status || "").toLowerCase();
    if (retry) {
      if (!["cancelled", "canceled"].includes(status) || quote.exception_type !== "service_cancellation" || !getStoredReason(quote)) {
        return reply(409, { error: "This is not a cancellation eligible for email retry." });
      }
      if (String(quote.exception_notes || "").includes("Email sent")) {
        return reply(409, { error: "The customer has already been notified. No duplicate email was sent." });
      }
    } else {
      if (["cancelled", "canceled", "completed", "delivered"].includes(status) || quote.completed_at) {
        return reply(409, { error: "This job can no longer be cancelled from this screen." });
      }
      if (quote.assigned_driver_id || (quote.driver_workflow_status && quote.driver_workflow_status !== "unassigned")) {
        return reply(409, { error: "A driver is already involved. Unassign and resolve the driver workflow before cancelling." });
      }
      if (quote.payment_status && !["unpaid"].includes(String(quote.payment_status).toLowerCase())) {
        return reply(409, { error: "Payment is pending or has been collected. Resolve the payment/refund first before cancelling." });
      }
      const payments = await supabaseRequest("payments?select=payment_status&quote_id=eq." + encodeURIComponent(id));
      if (Array.isArray(payments) && payments.some(p => !["unpaid", "failed", "cancelled", "canceled"].includes(String(p.payment_status || "").toLowerCase()))) {
        return reply(409, { error: "A related payment needs review before cancellation." });
      }

      const now = new Date().toISOString();
      const internal = [quote.internal_dispatch_notes, "Cancelled by dispatch (" + actor.user.id + ") " + now + ": " + reason]
        .filter(Boolean).join("\n").slice(0, 6000);
      // Conditional update prevents a second cancellation after another staff member changes status.
      const update = await supabaseRequest("quotes?id=eq." + encodeURIComponent(id) + "&status=eq." + encodeURIComponent(quote.status), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "cancelled",
          exception_type: "service_cancellation",
          exception_notes: "Cancellation reason: " + reason + " | Email pending",
          customer_visible_notes: "MG Express cancellation: " + REASONS[reason],
          internal_dispatch_notes: internal,
          closed_at: now
        })
      });
      if (!Array.isArray(update) || update.length !== 1) {
        return reply(409, { error: "Job changed while cancelling. Refresh and try again." });
      }
    }

    const number = String(quote.job_number || "delivery");
    const customer = String(quote.customer_name || "Customer");
    const subject = "MG Express delivery request cancelled – " + number;
    const plain = "Hello " + customer + ",\n\nThank you for choosing MG Express. Unfortunately, we cannot complete delivery request " + number + ".\n\nReason: " + REASONS[reason] + "\n\nNo payment has been collected for this request.\n\nIf you have questions or a future delivery request, please contact info@migenteexpress.com or 720-640-1160.\n\nMG Express";
    let emailSent = false;
    let notificationError = "";
    try {
      const delivered = await sendResendEmail({
        from: "MG Express Quotes <quotes@notify.migenteexpress.com>",
        to: [email],
        subject,
        text: plain,
        html: "<p>Hello " + escapeHtml(customer) + ",</p><p>Thank you for choosing MG Express. Unfortunately, we cannot complete delivery request <strong>" + escapeHtml(number) + "</strong>.</p><p><strong>Reason:</strong> " + escapeHtml(REASONS[reason]) + "</p><p>No payment has been collected for this request.</p><p>For questions or future deliveries, contact <a href=\"mailto:info@migenteexpress.com\">info@migenteexpress.com</a> or 720-640-1160.</p><p>MG Express</p>"
      });
      emailSent = delivered.configured === true;
      if (!emailSent) notificationError = "Email provider is not configured.";
    } catch (error) {
      notificationError = "The email provider could not send the message.";
      console.error("cancellation email failed", { job_id: id, message: error.message });
    }

    const outcome = "Cancellation reason: " + reason + " | " + (emailSent ? "Email sent " + new Date().toISOString() : "Email pending retry");
    try {
      await updateQuoteById(id, { exception_notes: outcome });
    } catch (error) {
      console.error("cancellation notification status could not be saved", { job_id: id, message: error.message });
      // The order and email may have already changed. Report actual email outcome.
    }
    return reply(200, {
      ok: true,
      cancelled: true,
      email_sent: emailSent,
      notification_pending: !emailSent,
      message: emailSent
        ? "Delivery cancelled. A cancellation email was sent to the verified customer."
        : "Delivery cancelled, but the customer email was not sent. Retry the notification or contact the customer directly.",
      ...(notificationError ? { notification_error: notificationError } : {})
    });
  } catch (error) {
    console.error("cancel-delivery-notify failed", { message: error.message, statusCode: error.statusCode });
    return reply(error.statusCode || 500, { error: error.statusCode ? error.message : "Unable to process cancellation right now." });
  }
};
