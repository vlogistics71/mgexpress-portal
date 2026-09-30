const crypto = require("crypto");
const {
  getStripeSecretKey,
  loadQuoteById,
  parseAmountToCents,
  requireDispatchAccess,
  sendResendEmail,
  toJsonResponse,
  updateQuoteById
} = require("./_shared");

async function stripeRequest(path, options = {}) {
  const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\//, "")}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getStripeSecretKey()}`,
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data?.error?.message || `Stripe request failed (${response.status})`);
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

async function findCompletedCheckoutSession(quoteId) {
  let startingAfter = "";
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ limit: "100" });
    if (startingAfter) params.set("starting_after", startingAfter);
    const result = await stripeRequest(`checkout/sessions?${params.toString()}`);
    const sessions = Array.isArray(result.data) ? result.data : [];
    const match = sessions.find(session =>
      String(session?.metadata?.quote_id || "") === String(quoteId) &&
      session?.payment_status === "paid" &&
      session?.payment_intent
    );
    if (match) return match;
    if (!result.has_more || !sessions.length) break;
    startingAfter = String(sessions[sessions.length - 1].id || "");
    if (!startingAfter) break;
  }
  return null;
}

function money(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

exports.handler = async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return toJsonResponse(405, { error: "Method not allowed" });
    const dispatch = await requireDispatchAccess(event);
    const body = event.body ? JSON.parse(event.body) : {};
    const quoteId = String(body.quote_id || "").trim();
    const refundType = String(body.refund_type || "partial").trim().toLowerCase();
    const reason = String(body.reason || "").trim().slice(0, 500);
    const requestId = String(body.request_id || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);

    if (!quoteId) return toJsonResponse(400, { error: "quote_id is required" });
    if (!reason) return toJsonResponse(400, { error: "A refund reason is required." });
    if (!["full", "partial"].includes(refundType)) return toJsonResponse(400, { error: "Choose a full or partial refund." });

    const quote = await loadQuoteById(quoteId, "id,job_number,customer_name,customer_email,approved_price,customer_charge,payment_status,status,special_instructions");
    if (!quote) return toJsonResponse(404, { error: "Job not found" });
    if (!["paid", "partially_refunded"].includes(String(quote.payment_status || "").toLowerCase())) {
      return toJsonResponse(409, { error: "Only paid Stripe jobs can be refunded." });
    }

    const session = await findCompletedCheckoutSession(quote.id);
    if (!session) {
      return toJsonResponse(404, { error: "No completed Stripe payment was found for this job. A manually marked-paid job must be refunded outside Stripe." });
    }

    const paymentIntent = await stripeRequest(`payment_intents/${encodeURIComponent(session.payment_intent)}`);
    const chargeId = String(paymentIntent.latest_charge || "");
    if (!chargeId) return toJsonResponse(409, { error: "Stripe did not return a refundable charge for this job." });
    const charge = await stripeRequest(`charges/${encodeURIComponent(chargeId)}`);
    const paidCents = Number(charge.amount || 0);
    const refundedBefore = Number(charge.amount_refunded || 0);
    const remainingCents = Math.max(0, paidCents - refundedBefore);
    if (!remainingCents) return toJsonResponse(409, { error: "This payment has already been fully refunded." });

    const requestedCents = refundType === "full" ? remainingCents : parseAmountToCents(body.amount);
    if (!requestedCents || requestedCents <= 0) return toJsonResponse(400, { error: "Enter a valid partial refund amount." });
    if (requestedCents > remainingCents) {
      return toJsonResponse(400, { error: `The maximum refundable amount is ${money(remainingCents)}.` });
    }

    const params = new URLSearchParams({
      payment_intent: String(session.payment_intent),
      amount: String(requestedCents),
      reason: "requested_by_customer",
      "metadata[quote_id]": String(quote.id),
      "metadata[job_number]": String(quote.job_number || ""),
      "metadata[dispatch_reason]": reason,
      "metadata[authorized_by]": String(dispatch.user?.email || dispatch.user?.id || "dispatch")
    });
    const refund = await stripeRequest("refunds", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `mg-refund-${quote.id}-${requestId}`
      },
      body: params.toString()
    });

    const totalRefunded = refundedBefore + Number(refund.amount || requestedCents);
    const fullyRefunded = totalRefunded >= paidCents;
    const timestamp = new Date().toISOString();
    const auditLine = `[REFUND ${timestamp}] ${money(Number(refund.amount || requestedCents))} ${fullyRefunded ? "full" : "partial"}; reason: ${reason}; Stripe refund: ${refund.id}; authorized by: ${dispatch.user?.email || dispatch.user?.id || "dispatch"}`;
    await updateQuoteById(quote.id, {
      payment_status: fullyRefunded ? "refunded" : "partially_refunded",
      special_instructions: [String(quote.special_instructions || "").trim(), auditLine].filter(Boolean).join("\n")
    });

    let customerEmailSent = false;
    if (quote.customer_email) {
      const email = await sendResendEmail({
        from: "MG Express Billing <billing@notify.migenteexpress.com>",
        to: quote.customer_email,
        subject: `MG Express Refund Issued — ${quote.job_number || quote.id}`,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#17221e"><h2>Your refund has been issued</h2><p>MG Express issued a refund of <strong>${money(Number(refund.amount || requestedCents))}</strong> for job ${quote.job_number || quote.id}.</p><p>The credit will return to the original payment method. Your bank controls when it appears on your account.</p><p><strong>Reason:</strong> ${reason.replace(/[&<>"']/g, value => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[value]))}</p></div>`,
        text: `MG Express issued a refund of ${money(Number(refund.amount || requestedCents))} for job ${quote.job_number || quote.id}. The credit will return to the original payment method. Reason: ${reason}`
      });
      customerEmailSent = Boolean(email.configured);
    }

    return toJsonResponse(200, {
      ok: true,
      refund_id: refund.id,
      refund_status: refund.status,
      amount_refunded: Number(refund.amount || requestedCents) / 100,
      amount_label: money(Number(refund.amount || requestedCents)),
      total_refunded: totalRefunded / 100,
      remaining_refundable: Math.max(0, paidCents - totalRefunded) / 100,
      payment_status: fullyRefunded ? "refunded" : "partially_refunded",
      customer_email_sent: customerEmailSent
    });
  } catch (error) {
    console.error("refund-payment failed", error);
    return toJsonResponse(error.statusCode || 500, { error: error.message || "Unable to issue refund" });
  }
};
