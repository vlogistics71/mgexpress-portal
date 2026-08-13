const {
  getSiteUrl,
  loadQuoteById,
  sendResendEmail,
  supabaseRequest,
  toJsonResponse
} = require("./_shared");

const INVOICE_SENDER = "MG Express <billing@migenteexpress.com>";
const DISPATCH_ROLES = new Set(["admin", "staff", "dispatcher"]);

function clean(value) {
  return String(value || "").trim().toLowerCase();
}

function hasValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  return String(value).trim() !== "";
}

function firstPresentValue(values) {
  for (const value of values) {
    if (hasValue(value)) {
      return String(value).trim();
    }
  }

  return "";
}

function isMissingColumnError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("column") && (message.includes("does not exist") || message.includes("schema cache") || message.includes("not found"));
}

function parseJsonBody(rawBody) {
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch (_error) {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

function readBearerToken(headers) {
  const authHeader = String(headers?.authorization || headers?.Authorization || "").trim();
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return "";
  }

  return authHeader.slice(7).trim();
}

async function requireDispatchAccess(event) {
  const accessToken = readBearerToken(event.headers || {});
  if (!accessToken) {
    const error = new Error("Authentication required");
    error.statusCode = 401;
    throw error;
  }

  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    const error = new Error("Server authentication is not configured");
    error.statusCode = 500;
    throw error;
  }

  const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!authResponse.ok) {
    const error = new Error("Invalid or expired session");
    error.statusCode = 401;
    throw error;
  }

  const user = await authResponse.json();
  const profileRows = await supabaseRequest(`profiles?select=id,role&id=eq.${encodeURIComponent(user.id)}&limit=1`);
  const profile = Array.isArray(profileRows) ? profileRows[0] || null : null;
  const role = clean(profile?.role);

  if (!DISPATCH_ROLES.has(role)) {
    const error = new Error("Not authorized to send invoice emails");
    error.statusCode = 403;
    throw error;
  }
}

function resolveInvoiceNumber(quote, invoice) {
  const existing = firstPresentValue([invoice?.invoice_number]);
  if (existing) {
    return existing;
  }

  const jobNumber = firstPresentValue([quote?.job_number]);
  if (jobNumber) {
    return "INV-" + jobNumber;
  }

  return "INV-PENDING";
}

function resolveInvoiceTotal(quote, invoice) {
  const invoiceAmount = Number(invoice?.amount);
  if (Number.isFinite(invoiceAmount)) {
    return invoiceAmount;
  }

  const customerCharge = Number(quote?.customer_charge);
  if (Number.isFinite(customerCharge)) {
    return customerCharge;
  }

  const approvedPrice = Number(quote?.approved_price);
  if (Number.isFinite(approvedPrice)) {
    return approvedPrice;
  }

  return 0;
}

function money(value) {
  return Number(value || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD"
  });
}

function formatDate(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(date);
}

function normalizePaymentStatusLabel(value) {
  const token = clean(value);
  if (token === "paid") {
    return "PAID";
  }

  if (["pending", "payment_sent", "sent"].includes(token)) {
    return "PENDING";
  }

  return "UNPAID";
}

function resolveInvoiceLinks(quote, invoice) {
  const invoiceUrl = firstPresentValue([
    invoice?.invoice_url,
    invoice?.hosted_invoice_url,
    invoice?.pdf_url,
    invoice?.invoice_pdf_url,
    invoice?.invoice_link
  ]);

  const paymentUrl = firstPresentValue([
    invoice?.payment_link_url,
    invoice?.payment_url,
    invoice?.payment_link,
    invoice?.checkout_url,
    quote?.payment_link_url,
    quote?.customer_payment_link,
    quote?.invoice_payment_link,
    quote?.payment_url
  ]);

  return {
    invoiceUrl,
    paymentUrl,
    actionUrl: invoiceUrl || paymentUrl || ""
  };
}

function buildInvoiceEmail({ quote, invoice, invoiceNumber, serviceDate, invoiceTotal, paymentStatusLabel, actionUrl, siteUrl }) {
  const customerName = firstPresentValue([quote?.customer_name, invoice?.customer_name, "Customer"]);
  const jobNumber = firstPresentValue([quote?.job_number, quote?.id, "Delivery"]);
  const pickupLocation = firstPresentValue([quote?.pickup_address, "Not provided"]);
  const deliveryLocation = firstPresentValue([quote?.delivery_address, "Not provided"]);
  const contactLine = firstPresentValue([siteUrl, "https://portal.migenteexpress.com"]);

  const actionButton = actionUrl
    ? `<p style="margin:20px 0;"><a href="${actionUrl}" style="display:inline-block;background:#0f6a4f;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:8px;">View / Pay Invoice</a></p>`
    : "";

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#17221e;max-width:640px;">
      <p style="margin:0 0 10px;font-size:14px;font-weight:700;letter-spacing:0.04em;">MG EXPRESS</p>
      <h2 style="margin:0 0 14px;color:#0e4032;">Invoice Ready</h2>
      <p style="margin:0 0 12px;">Hello ${customerName},</p>
      <p style="margin:0 0 14px;">Your MG Express invoice is ready.</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 14px;">
        <tr><td style="padding:6px 0;color:#6a776f;font-weight:700;">Invoice Number</td><td style="padding:6px 0;text-align:right;">${invoiceNumber}</td></tr>
        <tr><td style="padding:6px 0;color:#6a776f;font-weight:700;">Job Number</td><td style="padding:6px 0;text-align:right;">${jobNumber}</td></tr>
        <tr><td style="padding:6px 0;color:#6a776f;font-weight:700;">Pickup</td><td style="padding:6px 0;text-align:right;">${pickupLocation}</td></tr>
        <tr><td style="padding:6px 0;color:#6a776f;font-weight:700;">Delivery</td><td style="padding:6px 0;text-align:right;">${deliveryLocation}</td></tr>
        <tr><td style="padding:6px 0;color:#6a776f;font-weight:700;">Service Date</td><td style="padding:6px 0;text-align:right;">${serviceDate}</td></tr>
        <tr><td style="padding:6px 0;color:#6a776f;font-weight:700;">Invoice Total</td><td style="padding:6px 0;text-align:right;">${invoiceTotal}</td></tr>
        <tr><td style="padding:6px 0;color:#6a776f;font-weight:700;">Payment Status</td><td style="padding:6px 0;text-align:right;">${paymentStatusLabel}</td></tr>
      </table>
      ${actionButton}
      <p style="margin:14px 0 0;">If you need help with this invoice, reply to this email or contact MG Express through the portal.</p>
      <p style="margin:8px 0 0;color:#44524b;">${contactLine}</p>
    </div>
  `;

  const textLines = [
    "MG EXPRESS",
    "",
    `Hello ${customerName},`,
    "",
    "Your MG Express invoice is ready.",
    "",
    `Invoice Number: ${invoiceNumber}`,
    `Job Number: ${jobNumber}`,
    `Pickup: ${pickupLocation}`,
    `Delivery: ${deliveryLocation}`,
    `Service Date: ${serviceDate}`,
    `Invoice Total: ${invoiceTotal}`,
    `Payment Status: ${paymentStatusLabel}`
  ];

  if (actionUrl) {
    textLines.push("", `View / Pay Invoice: ${actionUrl}`);
  }

  textLines.push("", "If you need help with this invoice, reply to this email or contact MG Express through the portal.", contactLine);

  return {
    subject: `MG Express Invoice — ${invoiceNumber}`,
    html,
    text: textLines.join("\n")
  };
}

async function loadLatestInvoiceForJob(quoteId) {
  const encoded = encodeURIComponent(`eq.${quoteId}`);
  const data = await supabaseRequest(`invoices?select=*&job_id=${encoded}&order=created_at.desc&limit=1`);
  return Array.isArray(data) ? data[0] || null : null;
}

async function tryPatchSingleColumn(path, fieldName, value) {
  try {
    await supabaseRequest(path, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ [fieldName]: value })
    });
    return true;
  } catch (error) {
    if (isMissingColumnError(error)) {
      return false;
    }

    throw error;
  }
}

async function recordInvoiceSentMetadata({ quoteId, invoiceId, sentAt }) {
  const methodFields = ["invoice_delivery_method", "delivery_method", "send_method", "sent_via"];
  const timeFields = ["invoice_sent_at", "email_sent_at", "sent_at", "emailed_at"];

  if (invoiceId) {
    const invoicePath = `invoices?id=eq.${encodeURIComponent(invoiceId)}`;
    for (const field of methodFields) {
      const updated = await tryPatchSingleColumn(invoicePath, field, "email");
      if (updated) {
        break;
      }
    }

    for (const field of timeFields) {
      const updated = await tryPatchSingleColumn(invoicePath, field, sentAt);
      if (updated) {
        break;
      }
    }
  }

  const quotePath = `quotes?id=eq.${encodeURIComponent(quoteId)}`;
  for (const field of methodFields) {
    const updated = await tryPatchSingleColumn(quotePath, field, "email");
    if (updated) {
      break;
    }
  }

  for (const field of timeFields) {
    const updated = await tryPatchSingleColumn(quotePath, field, sentAt);
    if (updated) {
      break;
    }
  }
}

exports.handler = async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return toJsonResponse(405, { error: "Method not allowed" });
    }

    await requireDispatchAccess(event);

    const body = parseJsonBody(event.body);
    const quoteId = String(body.quote_id || body.quoteId || body.job_id || body.jobId || "").trim();

    if (!quoteId) {
      return toJsonResponse(400, { error: "quote_id is required" });
    }

    const quote = await loadQuoteById(
      quoteId,
      "id,job_number,customer_name,customer_email,customer_phone,pickup_address,delivery_address,delivery_scheduled_at,scheduled_at,pickup_time,delivery_time,approved_price,customer_charge,payment_status,payment_link_url,customer_payment_link,invoice_payment_link,payment_url"
    );

    if (!quote) {
      return toJsonResponse(404, { error: "Job not found" });
    }

    const customerEmail = String(quote.customer_email || "").trim();
    if (!customerEmail) {
      return toJsonResponse(400, { error: "No customer email is stored for this job." });
    }

    const invoice = await loadLatestInvoiceForJob(quote.id);
    const invoiceNumber = resolveInvoiceNumber(quote, invoice);
    const invoiceTotal = money(resolveInvoiceTotal(quote, invoice));
    const serviceDate = formatDate(firstPresentValue([
      quote.delivery_scheduled_at,
      quote.scheduled_at,
      quote.pickup_time,
      quote.delivery_time,
      quote.created_at,
      invoice?.created_at
    ]));
    const paymentStatusLabel = normalizePaymentStatusLabel(firstPresentValue([
      invoice?.payment_status,
      quote.payment_status,
      "unpaid"
    ]));

    const links = resolveInvoiceLinks(quote, invoice);
    const email = buildInvoiceEmail({
      quote,
      invoice,
      invoiceNumber,
      serviceDate,
      invoiceTotal,
      paymentStatusLabel,
      actionUrl: links.actionUrl,
      siteUrl: getSiteUrl()
    });

    const emailResult = await sendResendEmail({
      from: INVOICE_SENDER,
      to: customerEmail,
      subject: email.subject,
      html: email.html,
      text: email.text
    });

    if (!emailResult.configured) {
      return toJsonResponse(500, { error: "Email sending is not configured." });
    }

    const sentAt = new Date().toISOString();
    await recordInvoiceSentMetadata({
      quoteId: quote.id,
      invoiceId: invoice?.id || "",
      sentAt
    });

    return toJsonResponse(200, {
      ok: true,
      sent: true,
      sent_via: ["email"],
      quote_id: quote.id,
      invoice_id: invoice?.id || null,
      invoice_number: invoiceNumber,
      sent_at: sentAt,
      customer_email: customerEmail
    });
  } catch (error) {
    console.error("send-invoice-email failed", {
      message: error?.message,
      statusCode: error?.statusCode,
      data: error?.data
    });

    return toJsonResponse(error.statusCode || 500, {
      error: error.message || "Unable to send invoice email"
    });
  }
};
