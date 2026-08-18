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

function nullable(value, max = 1000) {
  const text = clean(value, max);
  return text || null;
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

    const customerName = clean(input.customer_name || input.name, 160);
    const customerPhone = clean(input.customer_phone || input.phone, 80);
    const pickupAddress = clean(input.pickup_address || input.pickup, 500);
    const deliveryAddress = clean(input.delivery_address || input.delivery, 500);

    if (!customerName || !customerPhone || !pickupAddress || !deliveryAddress) {
      return response(400, {
        error: "Name, phone, pickup address, and delivery address are required."
      }, origin);
    }

    const legacyType = clean(input.type, 100);
    const categoryMap = {
      "Medical Courier": "medical",
      "Legal Documents": "legal"
    };

    const company = clean(input.company || input.business, 200);
    const legacyNotes = [
      legacyType ? `Website delivery type: ${legacyType}` : "",
      input.date ? `Preferred date: ${clean(input.date, 30)}` : "",
      clean(input.details, 3000)
    ].filter(Boolean);

    const deliveryNotes = [
      clean(input.delivery_contact_phone, 80) ? `Delivery contact phone: ${clean(input.delivery_contact_phone, 80)}` : "",
      clean(input.delivery_instructions, 2000) ? `Delivery instructions: ${clean(input.delivery_instructions, 2000)}` : ""
    ].filter(Boolean);

    const instructionParts = [
      company ? `Company: ${company}` : "",
      clean(input.special_instructions, 3000),
      ...deliveryNotes,
      ...legacyNotes
    ].filter(Boolean);

    const payload = {
      customer_name: customerName,
      customer_email: nullable(input.customer_email || input.email, 200),
      customer_phone: customerPhone,

      pickup_address: pickupAddress,
      pickup_suite_floor: nullable(input.pickup_suite_floor, 120),
      pickup_zip: nullable(input.pickup_zip, 20),
      pickup_contact_name: nullable(input.pickup_contact_name, 160),
      pickup_contact_phone: nullable(input.pickup_contact_phone, 80),
      pickup_instructions: nullable(input.pickup_instructions, 2000),

      delivery_address: deliveryAddress,
      delivery_suite_floor: nullable(input.delivery_suite_floor, 120),
      delivery_zip: nullable(input.delivery_zip, 20),
      delivery_recipient_name: nullable(input.delivery_recipient_name || input.delivery_contact_name, 160),

      vehicle_type: nullable(input.vehicle_type, 100),
      delivery_speed: nullable(input.delivery_speed, 100),
      job_category: clean(input.job_category, 100) || categoryMap[legacyType] || "general",
      delivery_type: nullable(input.delivery_type, 100),
      service_level: clean(input.service_level, 100) || (legacyType === "Scheduled Route" ? "scheduled" : "on_demand"),
      package_type: nullable(input.package_type, 160),
      package_weight: nullable(input.weight || input.package_weight, 100),
      estimated_miles: input.estimated_miles === "" || input.estimated_miles == null
        ? null
        : Number(input.estimated_miles),
      special_instructions: instructionParts.length ? instructionParts.join("\n") : null,

      return_required: String(input.return_required || "false") === "true",
      return_location_type: clean(input.return_location_type, 100) || "same_as_pickup",
      return_timing: clean(input.return_timing, 100) || "immediate",
      return_address: nullable(input.return_address, 500),
      return_suite_floor: nullable(input.return_suite_floor, 120),
      return_zip: nullable(input.return_zip, 20),

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
