const {
  createStripeCheckoutSession,
  getSiteUrl,
  loadQuoteById,
  parseAmountToCents,
  sendResendEmail,
  sendTwilioSms,
  toJsonResponse
} = require("./_shared");

function normalizeMode(value) {
  const mode = String(value || "email").trim().toLowerCase();
  if (["email", "text", "both"].includes(mode)) {
    return mode;
  }

  return "email";
}

function formatAmount(amountCents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(amountCents / 100);
}

exports.handler = async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return toJsonResponse(405, { error: "Method not allowed" });
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const quoteId = String(body.quote_id || body.quoteId || "").trim();
    const checkoutUrlFromRequest = String(body.checkout_url || body.checkoutUrl || "").trim();
    const mode = normalizeMode(body.mode || body.method);

    if (!quoteId) {
      return toJsonResponse(400, { error: "quote_id is required" });
    }

    const quote = await loadQuoteById(
      quoteId,
      "id,job_number,customer_name,customer_email,customer_phone,approved_price,customer_charge,payment_status,status"
    );

    if (!quote) {
      return toJsonResponse(404, { error: "Job not found" });
    }

    let checkoutUrl = checkoutUrlFromRequest;
    let amountCents = parseAmountToCents(quote.customer_charge ?? quote.approved_price);

    if (!amountCents || amountCents <= 0) {
      return toJsonResponse(400, { error: "No valid customer amount is stored for this job." });
    }

    if (!checkoutUrl) {
      const checkoutSession = await createStripeCheckoutSession({
        quote,
        amountCents,
        siteUrl: getSiteUrl()
      });

      checkoutUrl = checkoutSession.url;
    }

    if (!checkoutUrl) {
      return toJsonResponse(400, { error: "A checkout URL is required." });
    }

    const amountLabel = formatAmount(amountCents);
    const responses = [];
    const errors = [];

    if (mode === "email" || mode === "both") {
      if (!quote.customer_email) {
        errors.push("No customer email is stored for this job.");
      } else {
        const email = {
          subject: `MG Express Payment — ${quote.job_number || quote.id}`,
          html: `
            <div style="font-family:Arial,sans-serif;line-height:1.5;color:#17221e">
              <p>MG Express</p>
              <p>Your delivery ${quote.job_number || quote.id} is ready for payment.</p>
              <p><strong>Amount Due:</strong> ${amountLabel}</p>
              <p><a href="${checkoutUrl}">Pay Securely</a></p>
              <p>After payment is received, your delivery will be released to dispatch.</p>
              <p>Thank you for choosing MG Express.</p>
            </div>
          `,
          text: [
            "MG Express",
            `Your delivery ${quote.job_number || quote.id} is ready for payment.`,
            `Amount Due: ${amountLabel}`,
            `Pay Securely: ${checkoutUrl}`,
            "After payment is received, your delivery will be released to dispatch.",
            "Thank you for choosing MG Express."
          ].join("\n\n")
        };

        const result = await sendResendEmail({
          from: "MG Express <billing@mignexpress.com>",
          to: quote.customer_email,
          subject: email.subject,
          html: email.html,
          text: email.text
        });

        if (!result.configured) {
          errors.push("Email sending is not configured.");
        } else {
          responses.push("email");
        }
      }
    }

    if (mode === "text" || mode === "both") {
      if (!quote.customer_phone) {
        errors.push("No customer phone number is stored for this job.");
      } else {
        const result = await sendTwilioSms({
          to: quote.customer_phone,
          body: `MG Express: Payment for delivery ${quote.job_number || quote.id} is ready. Amount due: ${amountLabel}. Pay securely: ${checkoutUrl}`
        });

        if (!result.configured) {
          errors.push("SMS sending is not configured.");
        } else {
          responses.push("text");
        }
      }
    }

    const sent = responses.length > 0;

    return toJsonResponse(200, {
      ok: true,
      sent,
      sent_via: responses,
      errors,
      quote_id: quote.id,
      job_number: quote.job_number || "",
      checkout_url: checkoutUrl,
      amount_cents: amountCents,
      amount_label: amountLabel,
      payment_status: quote.payment_status || "waiting_payment",
      job_status: quote.status || "waiting_payment"
    });
  } catch (error) {
    console.error("send-payment-link failed", error);
    return toJsonResponse(error.statusCode || 500, {
      error: error.message || "Unable to send payment link"
    });
  }
};