const crypto = require("crypto");
const {
  loadQuoteById,
  sendResendEmail,
  toJsonResponse,
  updateQuoteById
} = require("./_shared");

const ALLOWED_ORIGINS = new Set([
  "https://migenteexpress.com",
  "https://www.migenteexpress.com"
]);

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://migenteexpress.com",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

function response(statusCode, body, origin) {
  const base = toJsonResponse(statusCode, body);
  return { ...base, headers: { ...base.headers, ...corsHeaders(origin) } };
}

function expectedToken(quoteId) {
  return crypto
    .createHmac("sha256", String(process.env.SUPABASE_SERVICE_ROLE_KEY || ""))
    .update(String(quoteId || ""), "utf8")
    .digest("hex");
}

function validToken(quoteId, token) {
  const expected = Buffer.from(expectedToken(quoteId), "hex");
  const supplied = Buffer.from(String(token || ""), "hex");
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

exports.handler = async function handler(event) {
  const origin = String(event.headers?.origin || event.headers?.Origin || "");
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(origin), body: "" };
  if (event.httpMethod !== "POST") return response(405, { error: "Method not allowed." }, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return response(403, { error: "Origin not allowed." }, origin);

  try {
    const input = JSON.parse(event.body || "{}");
    const quoteId = String(input.quote_id || "").trim();
    if (!quoteId || !validToken(quoteId, input.review_token)) {
      return response(403, { error: "This quote review link is invalid." }, origin);
    }

    const quote = await loadQuoteById(quoteId, "id,job_number,customer_name,customer_email,customer_phone,customer_charge,approved_price,special_instructions");
    if (!quote) return response(404, { error: "Quote not found." }, origin);

    const reviewLine = `Customer requested a final price review on ${new Date().toISOString()}.`;
    const instructions = [String(quote.special_instructions || "").trim(), reviewLine].filter(Boolean).join("\n");
    await updateQuoteById(quote.id, {
      status: "new",
      payment_status: "review_requested",
      special_instructions: instructions
    });

    const amount = Number(quote.customer_charge ?? quote.approved_price);
    const amountLabel = Number.isFinite(amount)
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
      : "Not available";
    const quoteNumber = quote.job_number || quote.id;

    let dispatchEmailSent = false;
    let customerEmailSent = false;
    try {
      const dispatchEmail = await sendResendEmail({
        from: "MG Express Quotes <quotes@notify.migenteexpress.com>",
        to: ["info@migenteexpress.com"],
        subject: `Customer Requested Price Review – ${quoteNumber}`,
        html: `<h2>Customer Requested a Final Price Review</h2><p><strong>Quote:</strong> ${escapeHtml(quoteNumber)}<br><strong>Customer:</strong> ${escapeHtml(quote.customer_name)}<br><strong>Current quote:</strong> ${escapeHtml(amountLabel)}</p><p><a href="https://portal.migenteexpress.com/">Open Dispatch Portal</a></p>`
      });
      dispatchEmailSent = Boolean(dispatchEmail?.configured);
    } catch (emailError) {
      console.error("dispatch review email failed", { message: emailError?.message, statusCode: emailError?.statusCode });
    }

    if (quote.customer_email) {
      try {
        const customerEmail = await sendResendEmail({
          from: "MG Express Quotes <quotes@notify.migenteexpress.com>",
          to: [quote.customer_email],
          subject: `MG Express is reviewing quote ${quoteNumber}`,
          html: `<h2>Your price review request was received</h2><p>Our dispatch team will review quote <strong>${escapeHtml(quoteNumber)}</strong> and contact you with the final price.</p>`
        });
        customerEmailSent = Boolean(customerEmail?.configured);
      } catch (emailError) {
        console.error("customer review email failed", { message: emailError?.message, statusCode: emailError?.statusCode });
      }
    }

    return response(200, {
      ok: true,
      dispatch_email_sent: dispatchEmailSent,
      customer_email_sent: customerEmailSent,
      message: "Dispatch has been asked to review your final quote."
    }, origin);
  } catch (error) {
    console.error("request-quote-review failed", { message: error?.message, statusCode: error?.statusCode });
    return response(error.statusCode || 500, { error: "Unable to request a price review right now." }, origin);
  }
};
