const crypto = require("crypto");
const {
  createStripeCheckoutSession,
  supabaseRequest,
  toJsonResponse
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

function clean(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function nullable(value, max = 1000) {
  const text = clean(value, max);
  return text || null;
}

const INTRODUCTORY_DISCOUNT = 0.14;

const PRICE_CHART = Object.freeze({
  car: { base: 25, mileage: 1.45, minimum: 35 },
  suv: { base: 25, mileage: 1.45, minimum: 35 },
  cargo_van: { base: 35, mileage: 1.90, minimum: 50 },
  sprinter_van: { base: 50, mileage: 2.50, minimum: 75 },
  box_truck: { base: 75, mileage: 3.25, minimum: 110 }
});

const SPEED_MULTIPLIERS = Object.freeze({
  next_day: 0.90,
  "6_hr": 0.95,
  "5_hr": 1,
  "4_hr": 1,
  "3_hr": 1.15,
  "2_hr": 1.30
});

function normalizeToken(value) {
  return clean(value, 100).toLowerCase().replace(/\s+/g, "_");
}

function normalizePreferredTime(value) {
  const match = clean(value, 10).match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 7 || hour > 21 || ![0, 15, 30, 45].includes(minute) || (hour === 21 && minute !== 0)) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function displayPreferredTime(value) {
  const normalized = normalizePreferredTime(value);
  if (!normalized) return "Not provided";
  const [hourText, minute] = normalized.split(":");
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

function deliverySpeedFromWindow(pickupTime, deliveryTime) {
  const pickup = normalizePreferredTime(pickupTime);
  const delivery = normalizePreferredTime(deliveryTime);
  if (!pickup || !delivery) return null;
  const [pickupHour, pickupMinute] = pickup.split(":").map(Number);
  const [deliveryHour, deliveryMinute] = delivery.split(":").map(Number);
  let minutes = deliveryHour * 60 + deliveryMinute - (pickupHour * 60 + pickupMinute);
  if (minutes <= 0) minutes += 24 * 60;
  
  return String(Math.max(2, Math.min(6, Math.ceil(minutes / 60)))) + "_hr";
}

function createReviewToken(quoteId) {
  return crypto
    .createHmac("sha256", String(process.env.SUPABASE_SERVICE_ROLE_KEY || ""))
    .update(String(quoteId || ""), "utf8")
    .digest("hex");
}

async function geocodeAddress(input) {
  const apiKey = String(process.env.GEOAPIFY_API_KEY || "34d895e9c6cd4d1faf0692f758aac8ac").trim();
  const url = new URL("https://api.geoapify.com/v1/geocode/search");
  url.searchParams.set("text", input);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("filter", "rect:-109.06,36.99,-102.04,41.00|countrycode:us");
  url.searchParams.set("apiKey", apiKey);
  const result = await fetch(url);
  if (!result.ok) throw new Error("Address lookup failed.");
  const payload = await result.json();
  const match = Array.isArray(payload.results) ? payload.results[0] : null;
  const lat = Number(match?.lat);
  const lon = Number(match?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("Address could not be located.");
  return { lat, lon };
}

async function calculateRouteMiles(pickup, delivery) {
  const apiKey = String(process.env.GEOAPIFY_API_KEY || "34d895e9c6cd4d1faf0692f758aac8ac").trim();
  const [start, finish] = await Promise.all([geocodeAddress(pickup), geocodeAddress(delivery)]);
  const url = new URL("https://api.geoapify.com/v1/routing");
  url.searchParams.set("waypoints", `${start.lat},${start.lon}|${finish.lat},${finish.lon}`);
  url.searchParams.set("mode", "drive");
  url.searchParams.set("units", "imperial");
  url.searchParams.set("format", "json");
  url.searchParams.set("apiKey", apiKey);
  const result = await fetch(url);
  if (!result.ok) throw new Error("Route calculation failed.");
  const payload = await result.json();
  const miles = Number(payload?.results?.[0]?.distance);
  if (!Number.isFinite(miles) || miles <= 0) throw new Error("Route mileage was unavailable.");
  return Math.round(miles * 10) / 10;
}

function calculatePackageFees(pieceCount, packageWeight) {
  const additionalPieces = Math.max(0, pieceCount - 2);
  const extraPieceFee = additionalPieces * 4;
  const heavyWeightFee = normalizeToken(packageWeight) === "over_75_lbs" ? 8 : 0;
  return { additionalPieces, extraPieceFee, heavyWeightFee, total: extraPieceFee + heavyWeightFee };
}

function calculateCustomerPrice({ vehicleType, deliverySpeed, serviceLevel, miles, packageFees }) {
  const rate = PRICE_CHART[normalizeToken(vehicleType)];
  const speedMultiplier = SPEED_MULTIPLIERS[normalizeToken(deliverySpeed)];
  if (!rate || !speedMultiplier || !Number.isFinite(miles) || miles <= 0) return null;
  let multiplier = speedMultiplier;
  if (normalizeToken(serviceLevel) === "stat") multiplier = Math.max(multiplier, 1.50);
  const calculated = Math.max(rate.minimum, (rate.base + miles * rate.mileage) * multiplier);
  const discountedDeliveryPrice = calculated * (1 - INTRODUCTORY_DISCOUNT);
  const basePrice = Math.ceil(discountedDeliveryPrice / 5) * 5;
  return basePrice + packageFees.total;
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

    if (clean(input.website, 200)) {
      return response(201, { ok: true, message: "Quote request received." }, origin);
    }

    const requestSource = clean(input.request_source, 50) === "voice" ? "voice" : "website";
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
    const pieceCount = Number(input.piece_count);
    if (!Number.isInteger(pieceCount) || pieceCount < 1 || pieceCount > 100) {
      return response(400, { error: "Number of pieces must be a whole number from 1 to 100." }, origin);
    }
    const packageWeight = clean(input.package_weight, 100) || "under_50_lbs";
    const packageFees = calculatePackageFees(pieceCount, packageWeight);
    const preferredPickupTime = normalizePreferredTime(input.preferred_pickup_time);
    const preferredDeliveryTime = normalizePreferredTime(input.preferred_delivery_time);
    const deliverySpeed = normalizeToken(input.delivery_speed) || deliverySpeedFromWindow(preferredPickupTime, preferredDeliveryTime);
    const instructionParts = [
      company ? `Company: ${company}` : "",
      clean(input.reference_number, 160) ? `Reference number: ${clean(input.reference_number, 160)}` : "",
      preferredPickupTime ? `Preferred pickup time: ${displayPreferredTime(preferredPickupTime)}` : "",
      preferredDeliveryTime ? `Deliver by time: ${displayPreferredTime(preferredDeliveryTime)}` : "",
      `Pieces / boxes: ${pieceCount}`,
      `Estimated total weight: ${packageWeight.replaceAll("_", " ")}`,
      packageFees.extraPieceFee ? `Additional-piece fee: ${packageFees.extraPieceFee.toFixed(2)}` : "",
      packageFees.heavyWeightFee ? `Over-75-lb fee: ${packageFees.heavyWeightFee.toFixed(2)}` : "",
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

    const pickupRouteAddress = [pickupAddress, input.pickup_city, input.pickup_state || "CO", input.pickup_zip].filter(Boolean).join(", ");
    const deliveryRouteAddress = [deliveryAddress, input.delivery_city, input.delivery_state || "CO", input.delivery_zip].filter(Boolean).join(", ");
    let routeMiles = null;
    let routeError = null;
    try {
      routeMiles = await calculateRouteMiles(pickupRouteAddress, deliveryRouteAddress);
    } catch (error) {
      routeError = error;
      console.error("public quote route calculation failed", { message: error?.message });
    }

    const customerPrice = calculateCustomerPrice({
      vehicleType: input.vehicle_type,
      deliverySpeed,
      serviceLevel,
      miles: routeMiles,
      packageFees
    });
    const needsReview = Boolean(
      requestSource === "voice" ||
      routeError || !customerPrice || routeMiles > 300 ||
      ["pallet", "special"].includes(jobCategory) ||
      normalizeToken(input.package_weight) === "custom"
    );
    if (routeMiles) instructionParts.push(`Calculated route miles: ${routeMiles}`);

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
      delivery_speed: nullable(deliverySpeed, 100),
      job_category: jobCategory,
      delivery_type: deliveryType,
      service_level: serviceLevel,
      package_type: nullable(input.package_type, 160),
      weight: nullable(input.weight || packageWeight, 100),
      special_instructions: instructionParts.length ? instructionParts.join("\n") : null,
      approved_price: requestSource === "voice" && customerPrice ? customerPrice : (needsReview ? null : customerPrice),
      customer_charge: needsReview ? 0 : customerPrice,
      payment_status: needsReview ? null : "waiting_payment",

      return_required: returnRequired,
      return_location_type: returnLocationType,
      return_timing: returnTiming,
      return_address: returnRequired && returnLocationType === "different_location" ? nullable(input.return_address, 500) : null,
      return_suite_floor: returnRequired && returnLocationType === "different_location" ? nullable(input.return_suite_floor, 120) : null,
      return_zip: returnRequired && returnLocationType === "different_location" ? nullable(input.return_zip, 20) : null,

      request_source: requestSource === "voice" ? "website" : requestSource,
      status: needsReview ? "new" : "waiting_payment"
    };

    const created = await supabaseRequest("quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const quote = Array.isArray(created) ? created[0] : created;

    let checkoutUrl = "";
    if (!needsReview && quote?.id && customerPrice) {
      try {
        const checkout = await createStripeCheckoutSession({
          quote: { ...quote, customer_email: payload.customer_email, customer_name: payload.customer_name },
          amountCents: Math.round(customerPrice * 100),
          siteUrl: "https://migenteexpress.com",
          successUrl: `https://migenteexpress.com/payment-success.html?quote_id=${encodeURIComponent(quote.id)}&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: "https://migenteexpress.com/#quote"
        });
        checkoutUrl = String(checkout?.url || "");
      } catch (checkoutError) {
        console.error("public quote checkout creation failed", { message: checkoutError?.message });
      }
    }

    // Quote persistence is the primary operation. Email is intentionally best-effort:
    // a notification failure must never cause a successfully saved quote to fail.
    const resendApiKey = process.env.RESEND_API_KEY;
    let customerEmailSent = false;
    if (resendApiKey) {
      try {
        const quoteNumber = quote?.job_number || quote?.id || "New";
        const htmlEscape = (value) => String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#039;");
        const show = (value) => value ? htmlEscape(value) : "Not provided";

        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: "MG Express Quotes <quotes@notify.migenteexpress.com>",
            to: ["info@migenteexpress.com"],
            reply_to: payload.customer_email || undefined,
            subject: `New MG Express Quote Request – ${quoteNumber}`,
            html: `
              <h2>New MG Express Quote Request</h2>
              <p><strong>Quote:</strong> ${show(quoteNumber)}</p>
              <p><strong>Customer:</strong> ${show(payload.customer_name)}<br>
              <strong>Phone:</strong> ${show(payload.customer_phone)}<br>
              <strong>Email:</strong> ${show(payload.customer_email)}<br>
              <strong>Company:</strong> ${show(company)}</p>
              <p><strong>Pickup:</strong> ${show(payload.pickup_address)}<br>
              <strong>Preferred pickup time:</strong> ${show(displayPreferredTime(preferredPickupTime))}<br>
              <strong>Delivery:</strong> ${show(payload.delivery_address)}<br>
              <strong>Deliver by time:</strong> ${show(displayPreferredTime(preferredDeliveryTime))}</p>
              <p><strong>Vehicle:</strong> ${show(payload.vehicle_type)}<br>
              <strong>Delivery speed:</strong> ${show(payload.delivery_speed)}<br>
              <strong>Service level:</strong> ${show(payload.service_level)}<br>
              <strong>Pieces / boxes:</strong> ${pieceCount}<br>
              <strong>Estimated total weight:</strong> ${show(packageWeight.replaceAll("_", " "))}<br>
              <strong>Additional-piece fee:</strong> ${packageFees.extraPieceFee.toFixed(2)}<br>
              <strong>Over-75-lb fee:</strong> ${packageFees.heavyWeightFee.toFixed(2)}<br>
              <strong>Route miles:</strong> ${show(routeMiles)}<br>
              <strong>Customer quote:</strong> ${customerPrice ? `$${customerPrice.toFixed(2)}` : "Dispatch review required"}</p>
              <p><strong>Special instructions:</strong><br>${show(payload.special_instructions).replaceAll("\n", "<br>")}</p>
              <p><a href="https://portal.migenteexpress.com/">Open MG Express Dispatch Portal</a></p>
            `
          })
        });

        if (!emailResponse.ok) {
          const emailError = await emailResponse.text();
          console.error("quote notification email failed", {
            status: emailResponse.status,
            body: emailError.slice(0, 500)
          });
        }

        if (payload.customer_email) {
          const customerEmailResponse = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${resendApiKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              from: "MG Express Quotes <quotes@notify.migenteexpress.com>",
              to: [payload.customer_email],
              subject: requestSource === "voice" && customerPrice
                ? `Your preliminary MG Express quote is ${customerPrice.toFixed(2)}`
                : needsReview
                  ? "MG Express received your quote request"
                  : `Your MG Express quote is ${customerPrice ? `${customerPrice.toFixed(2)}` : "ready"}`,
              html: requestSource === "voice" && customerPrice
                ? `<h2>Your preliminary MG Express quote</h2><p>Thank you, ${show(payload.customer_name)}. Based on the information provided during your call, the preliminary price is <strong>${customerPrice.toFixed(2)}</strong>.</p><p><strong>Quote:</strong> ${show(quoteNumber)}<br><strong>Pieces / boxes:</strong> ${pieceCount}<br><strong>Additional-piece fee:</strong> ${packageFees.extraPieceFee.toFixed(2)}<br><strong>Over-75-lb fee:</strong> ${packageFees.heavyWeightFee.toFixed(2)}<br><strong>Preferred pickup:</strong> ${show(displayPreferredTime(preferredPickupTime))}<br><strong>Deliver by:</strong> ${show(displayPreferredTime(preferredDeliveryTime))}</p><p>Dispatch will review the request and email the final approved quote and secure payment link.</p><p style="font-size:13px;line-height:1.5;color:#666"><strong>Pricing notice:</strong> This preliminary quote is based on the information provided during the call and may change after dispatch review.</p>`
                : needsReview
                  ? `<h2>We received your delivery request</h2><p>Thank you, ${show(payload.customer_name)}. Dispatch is reviewing the details and will contact you shortly.</p>`
                  : `<h2>Your MG Express quote is ready</h2><p><strong>Quote:</strong> ${show(quoteNumber)}<br><strong>Pieces / boxes:</strong> ${pieceCount}<br><strong>Additional-piece fee:</strong> ${packageFees.extraPieceFee.toFixed(2)}<br><strong>Over-75-lb fee:</strong> ${packageFees.heavyWeightFee.toFixed(2)}<br><strong>Total:</strong> ${customerPrice.toFixed(2)}<br><strong>Preferred pickup:</strong> ${show(displayPreferredTime(preferredPickupTime))}<br><strong>Deliver by:</strong> ${show(displayPreferredTime(preferredDeliveryTime))}</p>${checkoutUrl ? `<p><a href="${htmlEscape(checkoutUrl)}">Pay securely online</a></p>` : "<p>Dispatch will send your secure payment link shortly.</p>"}<p style="font-size:13px;line-height:1.5;color:#666"><strong>Pricing notice:</strong> This quote is based on the information submitted. The final price may change for wait time, additional packages, stops or trips, incorrect or incomplete addresses, a different vehicle requirement, stairs or limited access, tolls, parking, or other service changes. Dispatch will confirm any adjustment before an additional charge is made.</p>`
            })
          });
          if (!customerEmailResponse.ok) {
            const customerEmailError = await customerEmailResponse.text();
            console.error("customer quote email failed", { status: customerEmailResponse.status, body: customerEmailError.slice(0, 500) });
          } else {
            customerEmailSent = true;
          }
        }
      } catch (emailError) {
        console.error("quote notification email failed", {
          message: emailError?.message
        });
      }
    } else {
      console.log("quote notification email skipped: RESEND_API_KEY is not configured");
    }

    return response(201, {
      ok: true,
      id: quote?.id || null,
      job_number: quote?.job_number || null,
      quote_status: needsReview ? "review" : "instant",
      amount: requestSource === "voice" && customerPrice ? customerPrice : (needsReview ? null : customerPrice),
      amount_label: requestSource === "voice" && customerPrice
        ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(customerPrice)
        : (needsReview ? null : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(customerPrice)),
      checkout_url: checkoutUrl || null,
      review_token: quote?.id ? createReviewToken(quote.id) : null,
      customer_email_sent: customerEmailSent,
      message: requestSource === "voice" && customerPrice
        ? `The preliminary quote is ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(customerPrice)}. Dispatch approval is required.`
        : needsReview
          ? "Quote request received. Dispatch will review the details and contact you shortly."
          : "Your instant quote is ready."
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
