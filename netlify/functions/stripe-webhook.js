const {
  getStripeWebhookSecret,
  loadQuoteById,
  sendResendEmail,
  sendTwilioSms,
  signaturePayload,
  toJsonResponse,
  updateQuoteById,
  verifyStripeWebhookSignature
} = require("./_shared");

function parseEvent(rawBody) {
  try {
    return JSON.parse(rawBody);
  } catch (_error) {
    return null;
  }
}

async function maybeSendCustomerConfirmation({ quote, amountLabel, checkoutUrl }) {
  const confirmations = [];

  if (quote.customer_email) {
    const emailResult = await sendResendEmail({
      from: "MG Express <billing@mignexpress.com>",
      to: quote.customer_email,
      subject: `MG Express Payment Received — ${quote.job_number || quote.id}`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#17221e">
          <p>MG Express</p>
          <p>Payment received for ${quote.job_number || quote.id}.</p>
          <p><strong>Amount Paid:</strong> ${amountLabel}</p>
          <p>Your delivery has been released to dispatch.</p>
          <p>Thank you.</p>
        </div>
      `,
      text: [
        "MG Express",
        `Payment received for ${quote.job_number || quote.id}.`,
        `Amount Paid: ${amountLabel}`,
        "Your delivery has been released to dispatch.",
        "Thank you."
      ].join("\n\n")
    });

    if (emailResult.configured) {
      confirmations.push("email");
    }
  }

  if (quote.customer_phone) {
    const smsResult = await sendTwilioSms({
      to: quote.customer_phone,
      body: `MG Express: Payment received for ${quote.job_number || quote.id}. Amount paid: ${amountLabel}. Your delivery has been released to dispatch.`
    });

    if (smsResult.configured) {
      confirmations.push("text");
    }
  }

  return confirmations;
}

exports.handler = async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return toJsonResponse(405, { error: "Method not allowed" });
    }

    const rawBody = event.body || "";
    const signatureHeader = event.headers["stripe-signature"] || event.headers["Stripe-Signature"] || event.headers["STRIPE-SIGNATURE"] || "";
    const webhookSecret = getStripeWebhookSecret();

    if (!verifyStripeWebhookSignature(rawBody, signatureHeader, webhookSecret)) {
      return toJsonResponse(400, { error: "Invalid Stripe signature" });
    }

    const stripeEvent = parseEvent(rawBody);
    if (!stripeEvent) {
      return toJsonResponse(400, { error: "Invalid webhook payload" });
    }

    if (stripeEvent.type !== "checkout.session.completed") {
      return toJsonResponse(200, { received: true, ignored: true, type: stripeEvent.type });
    }

    const session = stripeEvent.data && stripeEvent.data.object ? stripeEvent.data.object : null;
    const quoteId = String(session?.metadata?.quote_id || "").trim();
    const jobNumber = String(session?.metadata?.job_number || "").trim();

    if (!quoteId) {
      return toJsonResponse(200, { received: true, ignored: true, reason: "missing_quote_id" });
    }

    const quote = await loadQuoteById(
      quoteId,
      "id,job_number,customer_name,customer_email,customer_phone,approved_price,customer_charge,payment_status,status"
    );

    if (!quote) {
      return toJsonResponse(200, { received: true, ignored: true, reason: "quote_not_found", quote_id: quoteId, job_number: jobNumber });
    }

    const paymentStatus = String(quote.payment_status || "").trim().toLowerCase();
    const status = String(quote.status || "").trim().toLowerCase();
    if (paymentStatus === "paid" && (status === "ready_to_dispatch" || status === "ready")) {
      return toJsonResponse(200, { received: true, ignored: true, reason: "already_processed", quote_id: quote.id, job_number: quote.job_number || jobNumber });
    }

    const amountValue = quote.approved_price ?? quote.customer_charge ?? Number(session?.amount_total || 0) / 100;
    const amountLabel = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD"
    }).format(Number(amountValue || 0));

    const updateResult = await updateQuoteById(quote.id, {
      payment_status: "paid",
      status: "ready_to_dispatch"
    });

    const confirmations = await maybeSendCustomerConfirmation({
      quote,
      amountLabel,
      checkoutUrl: String(session?.url || "")
    });

    return toJsonResponse(200, {
      received: true,
      processed: true,
      quote_id: quote.id,
      job_number: quote.job_number || jobNumber,
      updated: Boolean(updateResult),
      payment_status: "paid",
      job_status: "ready_to_dispatch",
      confirmations
    });
  } catch (error) {
    console.error("stripe-webhook failed", error);
    return toJsonResponse(error.statusCode || 500, {
      error: error.message || "Stripe webhook processing failed"
    });
  }
};