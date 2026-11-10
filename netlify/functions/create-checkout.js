const {
  createStripeCheckoutSession,
  getSiteUrl,
  loadQuoteById,
  parseAmountToCents,
  requireDispatchAccess,
  toJsonResponse
} = require("./_shared");

exports.handler = async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return toJsonResponse(405, { error: "Method not allowed" });
    }

    await requireDispatchAccess(event);

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

    // A route estimate is never payment approval. A staff-reviewed final price
    // must be recorded before creating any Stripe checkout session.
    if (!(Number(quote.approved_price) > 0)) {
      return toJsonResponse(409, { error: "Dispatch must approve the final price before creating a payment link." });
    }
    const amountValue = Number(quote.customer_charge) > 0 ? quote.customer_charge : quote.approved_price;
    const amountCents = parseAmountToCents(amountValue);

    if (!amountCents || amountCents <= 0) {
      return toJsonResponse(400, { error: "No valid customer amount is stored for this job." });
    }

    const paymentState = String(quote.payment_status || "").trim().toLowerCase();
    const jobStatus = String(quote.status || "").trim().toLowerCase();
    if (["cancelled", "canceled", "completed", "delivered"].includes(jobStatus)) {
      return toJsonResponse(409, { error: "Cancelled or completed jobs cannot receive a new checkout link." });
    }
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
