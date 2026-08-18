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

    const allowedCategories = new Set(["medical", "pallet", "legal", "general", "special"]);
    const requestedCategory = clean(input.job_category, 100) || categoryMap[legacyType] || "general";
    const jobCategory = allowedCategories.has(requestedCategory) ? requestedCategory : "general";

    const allowedDeliveryTypes = new Set([
      "business_to_business",
      "business_to_residential",
      "residential_to_business",
      "residential_to_residential"
    ]);
    const requestedDeliveryType = clean(input.delivery_type, 100);
    const deliveryType = allowedDeliveryTypes.has(requestedDeliveryType) ? requestedDeliveryType : null;

    const allowedServiceLevels = new Set(["routine", "priority", "stat", "scheduled", "on_demand"]);
    const requestedServiceLevel = clean(input.service_level, 100) || (legacyType === "Scheduled Route" ? "scheduled" : "on_demand");
    const serviceLevel = allowedServiceLevels.has(requestedServiceLevel) ? requestedServiceLevel : "on_demand";

    const returnRequired = String(input.return_required || "false") === "true";
    const allowedReturnLocations = new Set(["same_as_pickup", "different_location"]);
    const requestedReturnLocation = clean(input.return_location_type, 100) || "same_as_pickup";
    const returnLocationType = returnRequired && allowedReturnLocations.has(requestedReturnLocation)
      ? requestedReturnLocation
      : null;

    const allowedReturnTimings = new Set(["immediate", "later_today", "another_day"]);
    const requestedReturnTiming = clean(input.return_timing, 100) || "immediate";
    const returnTiming = returnRequired && allowedReturnTimings.has(requestedReturnTiming)
      ? requestedReturnTiming
      : null;

    const company = clean(input.company || input.business, 200);
    const instructionParts = [
      company ? `Company: ${company}` : "",
      clean(input.pickup_contact_name, 160) ? `Pickup contact: ${clean(input.pickup_contact_name, 160)}` : "",
      clean(input.pickup_contact_phone, 80) ? `Pickup contact phone: ${clean(input.pickup_contact_phone, 80)}` : "",
      clean(input.pickup_instructions, 2000) ? `Pickup instructions: ${clean(input.pickup_instructions, 2000)}` : "",
      clean(input.delivery_contact_phone, 80) ? `Delivery contact phone: ${clean(input.delivery_contact_phone, 80)}` : "",
      clean(input.delivery_instructions, 2000) ? `Delivery instructions: ${clean(input.delivery_instructions, 2000)}` : "",
      input.estimated_miles !== "" && input.estimated_miles != null
        ? `Estimated miles: ${clean(input.estimated_miles, 50)}`
        : "",
      legacyType ? `Website delivery type: ${legacyType}` : "",
      input.date ? `Preferred date: ${clean(input.date, 30)}` : "",
      clean(input.special_instructions, 3000),
      clean(input.details, 3000)
    ].filter(Boolean);

    const payload = {
      customer_name: customerName,
      customer_email: nullable(input.customer_email || input.email, 200),
      customer_phone: customerPhone,

      pickup_address: pickupAddress,
      pickup_suite_floor: nullable(input.pickup_suite_floor, 120),
      pickup_city: nullable(input.pickup_city, 120),
      pickup_state: nullable(input.pickup_state, 80),
      pickup_zip: nullable(input.pickup_zip, 20),

      delivery_address: deliveryAddress,
      delivery_suite_floor: nullable(input.delivery_suite_floor, 120),
      delivery_city: nullable(input.delivery_city, 120),
      delivery_state: nullable(input.delivery_state, 80),
      delivery_zip: nullable(input.delivery_zip, 20),
      delivery_recipient_name: nullable(input.delivery_recipient_name || input.delivery_contact_name, 160),

      vehicle_type: nullable(input.vehicle_type, 100),
      delivery_speed: nullable(input.delivery_speed, 100),
      job_category: jobCategory,
      delivery_type: deliveryType,
      service_level: serviceLevel,
      package_type: nullable(input.package_type, 160),
      weight: nullable(input.weight || input.package_weight, 100),
      special_instructions: instructionParts.length ? instructionParts.join("\n") : null,

      return_required: returnRequired,
      return_location_type: returnLocationType,
      return_timing: returnTiming,
      return_address: returnRequired && returnLocationType === "different_location" ? nullable(input.return_address, 500) : null,
      return_suite_floor: returnRequired && returnLocationType === "different_location" ? nullable(input.return_suite_floor, 120) : null,
      return_zip: returnRequired && returnLocationType === "different_location" ? nullable(input.return_zip, 20) : null,

      request_source: "website",
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
