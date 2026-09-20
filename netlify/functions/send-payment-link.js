const {
  createStripeCheckoutSession,
  getSiteUrl,
  loadQuoteById,
  parseAmountToCents,
  requireDispatchAccess,
  sendResendEmail,
  sendTwilioSms,
  toJsonResponse,
  updateQuoteById
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

function safeCheckoutUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "checkout.stripe.com" ? url.toString() : "";
  } catch (_error) {
    return "";
  }
}

exports.handler = async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return toJsonResponse(405, { error: "Method not allowed" });
    }

    await requireDispatchAccess(event);

    const body = event.body ? JSON.parse(event.body) : {};
    const quoteId = String(body.quote_id || body.quoteId || "").trim();
    const requestedCheckoutUrl = String(body.checkout_url || body.checkoutUrl || "").trim();
    const checkoutUrlFromRequest = safeCheckoutUrl(requestedCheckoutUrl);
    if (requestedCheckoutUrl && !checkoutUrlFromRequest) {
      return toJsonResponse(400, { error: "Invalid Stripe checkout URL" });
    }
    const mode = normalizeMode(body.mode || body.method);
    const requestedAmount = body.final_amount ?? body.approved_amount ?? body.amount;

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

    const isApprovalRequest = requestedAmount !== undefined && requestedAmount !== null && requestedAmount !== "";
    if (isApprovalRequest && (mode === "email" || mode === "both") && !quote.customer_email) {
      return toJsonResponse(400, { error: "Add the customer email before approving this quote." });
    }

    const paymentState = String(quote.payment_status || "").trim().toLowerCase();
    const jobStatus = String(quote.status || "").trim().toLowerCase();
    if (paymentState === "paid" || jobStatus === "ready_to_dispatch" || jobStatus === "ready") {
      return toJsonResponse(409, { error: "This job is already paid and ready for dispatch." });
    }

    let checkoutUrl = checkoutUrlFromRequest;
    let amountCents = requestedAmount !== undefined && requestedAmount !== null && requestedAmount !== ""
      ? parseAmountToCents(requestedAmount)
      : parseAmountToCents(quote.customer_charge ?? quote.approved_price);

    if (!amountCents || amountCents <= 0 || amountCents > 10000000) {
      return toJsonResponse(400, { error: "Enter a valid final customer price between $0.01 and $100,000." });
    }

    const finalAmount = amountCents / 100;
    const isApproval = isApprovalRequest;

    if (isApproval) {
      await updateQuoteById(quote.id, {
        approved_price: finalAmount,
        customer_charge: finalAmount,
        payment_status: "waiting_payment",
        status: "waiting_payment"
      });
      quote.approved_price = finalAmount;
      quote.customer_charge = finalAmount;
      quote.payment_status = "waiting_payment";
      quote.status = "waiting_payment";
      checkoutUrl = "";
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
          subject: `Your Final MG Express Quote — ${quote.job_number || quote.id}`,
          html: `
            <div style="font-family:Arial,sans-serif;line-height:1.5;color:#17221e">
              <p>MG Express</p>
              <p>Dispatch reviewed and approved your delivery quote ${quote.job_number || quote.id}.</p>
              <p><strong>Amount Due:</strong> ${amountLabel}</p>
              <p><a href="${checkoutUrl}">Pay Securely</a></p>
              <p>After payment is received, your delivery will be released to dispatch.</p>
              <p>Thank you for choosing MG Express.</p>
            </div>
          `,
          text: [
            "MG Express",
            `Dispatch reviewed and approved your delivery quote ${quote.job_number || quote.id}.`,
            `Amount Due: ${amountLabel}`,
            `Pay Securely: ${checkoutUrl}`,
            "After payment is received, your delivery will be released to dispatch.",
            "Thank you for choosing MG Express."
          ].join("\n\n")
        };

        const result = await sendResendEmail({
          from: "MG Express Quotes <quotes@notify.migenteexpress.com>",
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
      approved: isApproval,
      payment_status: "waiting_payment",
      job_status: "waiting_payment"
    });
  } catch (error) {
    console.error("send-payment-link failed", error);
    return toJsonResponse(error.statusCode || 500, {
      error: error.message || "Unable to send payment link"
    });
  }
};
