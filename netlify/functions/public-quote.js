const { supabaseRequest, toJsonResponse } = require("./_shared");

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

function clean(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

exports.handler = async function handler(event) {
  const origin = String(event.headers?.origin || event.headers?.Origin || "");

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(origin), body: "" };
  }

  if (event.httpMethod !== "POST") {
    return response(405, { error: "Method not allowed." }, origin);
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return response(403, { error: "Origin not allowed." }, origin);
  }

  try {
    const input = JSON.parse(event.body || "{}");
    const customerName = clean(input.name, 160);
    const customerPhone = clean(input.phone, 80);
    const pickupAddress = clean(input.pickup, 500);
    const deliveryAddress = clean(input.delivery, 500);

    if (!customerName || !customerPhone || !pickupAddress || !deliveryAddress) {
      return response(400, { error: "Name, phone, pickup address, and delivery address are required." }, origin);
    }

    const type = clean(input.type, 100);
    const business = clean(input.business, 200);
    const categoryMap = {
      "Medical Courier": "medical",
      "Legal Documents": "legal"
    };

    // Only send columns that exist in public.quotes. The current dispatch form
    // does not persist a company column, so preserve the website business name
    // inside special_instructions instead of causing the insert to fail.
    const payload = {
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_email: clean(input.email, 200) || null,
      pickup_address: pickupAddress,
      delivery_address: deliveryAddress,
      job_category: categoryMap[type] || "general",
      service_level: type === "Scheduled Route" ? "scheduled" : "on_demand",
      special_instructions: [
        business ? `Business name: ${business}` : "",
        type ? `Website delivery type: ${type}` : "",
        input.date ? `Preferred date: ${clean(input.date, 30)}` : "",
        clean(input.details, 3000)
      ].filter(Boolean).join("\n"),
      status: "new"
    };

    const created = await supabaseRequest("quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const quote = Array.isArray(created) ? created[0] : created;
    return response(201, {
      ok: true,
      id: quote?.id || null,
      job_number: quote?.job_number || null,
      message: "Quote request received. MG Express will contact you shortly."
    }, origin);
  } catch (error) {
    console.error("public-quote error", {
      message: error?.message,
      statusCode: error?.statusCode,
      data: error?.data
    });

    const diagnostic = error?.statusCode
      ? `PQ-${error.statusCode}`
      : error?.message?.includes("Missing required environment variable")
        ? "PQ-CONFIG"
        : "PQ-500";

    return response(500, {
      error: "Unable to submit your quote request right now. Please try again.",
      diagnostic
    }, origin);
  }
};
