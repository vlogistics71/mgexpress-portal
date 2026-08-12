const {
  createStripeCheckoutSession,
  getSiteUrl,
  loadQuoteById,
  parseAmountToCents,
  toJsonResponse
} = require("./_shared");

exports.handler = async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return toJsonResponse(405, { error: "Method not allowed" });
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const quoteId = String(body.quote_id || body.quoteId || "").trim();

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

    const amountValue = quote.customer_charge ?? quote.approved_price;
    const amountCents = parseAmountToCents(amountValue);

    if (!amountCents || amountCents <= 0) {
      return toJsonResponse(400, { error: "No valid customer amount is stored for this job." });
    }

    const paymentState = String(quote.payment_status || "").trim().toLowerCase();
    const jobStatus = String(quote.status || "").trim().toLowerCase();
    if (paymentState === "paid" || jobStatus === "ready_to_dispatch") {
      return toJsonResponse(409, { error: "This job is already marked paid." });
    }

    const session = await createStripeCheckoutSession({
      quote,
      amountCents,
      siteUrl: getSiteUrl()
    });

    const amountLabel = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD"
    }).format(amountCents / 100);

    return toJsonResponse(200, {
      quote_id: quote.id,
      job_number: quote.job_number || "",
      amount_cents: amountCents,
      amount_label: amountLabel,
      customer_name: quote.customer_name || "",
      customer_email: quote.customer_email || "",
      customer_phone: quote.customer_phone || "",
      payment_status: quote.payment_status || "waiting_payment",
      job_status: quote.status || "waiting_payment",
      checkout_session_id: session.id,
      checkout_url: session.url
    });
  } catch (error) {
    console.error("create-checkout failed", error);
    return toJsonResponse(error.statusCode || 500, {
      error: error.message || "Unable to create Stripe checkout session"
    });
  }
};