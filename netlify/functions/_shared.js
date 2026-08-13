const crypto = require("crypto");

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getSiteUrl() {
  return String(process.env.SITE_URL || "https://portal.migenteexpress.com").trim().replace(/\/$/, "");
}

function getSupabaseConfig() {
  return {
    url: requireEnv("SUPABASE_URL"),
    serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY")
  };
}

function getStripeSecretKey() {
  return requireEnv("STRIPE_SECRET_KEY");
}

function getStripeWebhookSecret() {
  return requireEnv("STRIPE_WEBHOOK_SECRET");
}

function toJsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

async function supabaseRequest(path, options = {}) {
  const { url, serviceRoleKey } = getSupabaseConfig();
  const response = await fetch(`${url}/rest/v1/${path.replace(/^\//, "")}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "return=representation",
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") || "";
  let data = null;

  if (text) {
    if (contentType.includes("application/json")) {
      try {
        data = JSON.parse(text);
      } catch (_error) {
        data = text;
      }
    } else {
      data = text;
    }
  }

  if (!response.ok) {
    const message = data && typeof data === "object" && data.message ? data.message : text || `Supabase request failed (${response.status})`;
    const error = new Error(message);
    error.statusCode = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function loadQuoteById(quoteId, fields = "*") {
  const encodedId = encodeURIComponent(`eq.${quoteId}`);
  const data = await supabaseRequest(`quotes?select=${encodeURIComponent(fields)}&id=${encodedId}`);
  return Array.isArray(data) ? data[0] || null : null;
}

async function updateQuoteById(quoteId, payload) {
  return supabaseRequest(`quotes?id=eq.${encodeURIComponent(quoteId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

function parseAmountToCents(value) {
  const amount = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(amount)) {
    return null;
  }

  return Math.round(amount * 100);
}

function signaturePayload(rawBody, timestamp) {
  return `${timestamp}.${rawBody}`;
}

function verifyStripeWebhookSignature(rawBody, signatureHeader, secret) {
  if (!rawBody || !signatureHeader || !secret) {
    return false;
  }

  const parts = String(signatureHeader)
    .split(",")
    .map(entry => entry.trim())
    .reduce((accumulator, entry) => {
      const [key, value] = entry.split("=");
      if (!key || !value) {
        return accumulator;
      }
      if (!accumulator[key]) {
        accumulator[key] = [];
      }
      accumulator[key].push(value);
      return accumulator;
    }, {});

  const timestamp = Number((parts.t && parts.t[0]) || 0);
  const signatures = parts.v1 || [];
  if (!timestamp || !signatures.length) {
    return false;
  }

  const toleranceSeconds = 60 * 5;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > toleranceSeconds) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(signaturePayload(rawBody, timestamp), "utf8")
    .digest("hex");

  return signatures.some(candidate => {
    const candidateBuffer = Buffer.from(candidate, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    return candidateBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
  });
}

async function createStripeCheckoutSession({ quote, amountCents, siteUrl }) {
  const stripeSecretKey = getStripeSecretKey();
  const checkoutUrl = new URL("https://api.stripe.com/v1/checkout/sessions");
  const body = new URLSearchParams();

  body.set("mode", "payment");
  body.set("success_url", `${siteUrl}/payment-success.html?quote_id=${encodeURIComponent(quote.id)}&session_id={CHECKOUT_SESSION_ID}`);
  body.set("cancel_url", `${siteUrl}/dashboard.html?payment=cancelled&quote_id=${encodeURIComponent(quote.id)}`);
  if (String(quote.customer_email || "").trim()) {
    body.set("customer_email", String(quote.customer_email || "").trim());
  }
  body.set("line_items[0][quantity]", "1");
  body.set("line_items[0][price_data][currency]", "usd");
  body.set("line_items[0][price_data][unit_amount]", String(amountCents));
  body.set("line_items[0][price_data][product_data][name]", `MG Express Delivery ${quote.job_number || quote.id}`);
  body.set("metadata[quote_id]", String(quote.id));
  body.set("metadata[job_number]", String(quote.job_number || ""));
  body.set("metadata[amount_cents]", String(amountCents));

  if (quote.customer_name) {
    body.set("metadata[customer_name]", String(quote.customer_name));
  }

  const response = await fetch(checkoutUrl.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  const json = await response.json();

  if (!response.ok) {
    const message = json?.error?.message || `Stripe checkout session failed (${response.status})`;
    const error = new Error(message);
    error.statusCode = response.status;
    error.data = json;
    throw error;
  }

  return json;
}

async function sendResendEmail({ to, subject, html, text, from }) {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) {
    return { configured: false };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: String(from || process.env.RESEND_FROM_EMAIL || "MG Express <billing@mignexpress.com>"),
      to,
      subject,
      html,
      text
    })
  });

  const json = await response.json();
  if (!response.ok) {
    const error = new Error(json?.message || `Resend request failed (${response.status})`);
    error.statusCode = response.status;
    error.data = json;
    throw error;
  }

  return { configured: true, data: json };
}

async function sendTwilioSms({ to, body }) {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const fromNumber = String(process.env.TWILIO_FROM_NUMBER || "").trim();

  if (!accountSid || !authToken || !fromNumber) {
    return { configured: false };
  }

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      From: fromNumber,
      To: to,
      Body: body
    }).toString()
  });

  const json = await response.json();
  if (!response.ok) {
    const error = new Error(json?.message || `Twilio request failed (${response.status})`);
    error.statusCode = response.status;
    error.data = json;
    throw error;
  }

  return { configured: true, data: json };
}

function buildPaymentEmail({ quote, checkoutUrl, amountLabel }) {
  const subject = `MG Express Payment — ${quote.job_number || quote.id}`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#17221e">
      <p>MG Express</p>
      <p>Your delivery ${quote.job_number || quote.id} is ready for payment.</p>
      <p><strong>Amount Due:</strong> ${amountLabel}</p>
      <p><a href="${checkoutUrl}">Pay Securely</a></p>
      <p>After payment is received, your delivery will be released to dispatch.</p>
      <p>Thank you for choosing MG Express.</p>
    </div>
  `;
  const text = [
    "MG Express",
    `Your delivery ${quote.job_number || quote.id} is ready for payment.`,
    `Amount Due: ${amountLabel}`,
    `Pay Securely: ${checkoutUrl}`,
    "After payment is received, your delivery will be released to dispatch.",
    "Thank you for choosing MG Express."
  ].join("\n\n");

  return { subject, html, text };
}

function buildPaymentSms({ quote, checkoutUrl, amountLabel }) {
  return `MG Express: Payment for delivery ${quote.job_number || quote.id} is ready. Amount due: ${amountLabel}. Pay securely: ${checkoutUrl}`;
}

module.exports = {
  createStripeCheckoutSession,
  loadQuoteById,
  parseAmountToCents,
  getSiteUrl,
  getStripeWebhookSecret,
  sendResendEmail,
  sendTwilioSms,
  signaturePayload,
  supabaseRequest,
  toJsonResponse,
  updateQuoteById,
  verifyStripeWebhookSignature
};