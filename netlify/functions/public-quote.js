const { notifyDispatch } = require("./_dispatch-push");
const crypto = require("crypto");
const {
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


const US_STATE_CODES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "));
const STREET_SUFFIX = /\b(?:st(?:reet)?|rd|road|ave(?:nue)?|blvd|boulevard|ct|court|pl|place|dr|drive|ln|lane|way|cir(?:cle)?|ter(?:race)?|trl|trail|pkwy|parkway|hwy|highway|loop|pass|pike|plaza|sq|square|pt|point|run|path|aly|alley)\.?\b/i;
const STREET_NUMBER = /^\d{1,6}[a-z]?(?:-\d{1,6}[a-z]?)?\s+/i;

function addressFields(input, prefix) {
  const street = clean(input[prefix + "_address"], 500).replace(/\s+/g, " ");
  const city = clean(input[prefix + "_city"], 120).replace(/\s+/g, " ");
  const stateInput = clean(input[prefix + "_state"], 40);
  const state = /^colorado$/i.test(stateInput) ? "CO" : stateInput.toUpperCase();
  const zip = clean(input[prefix + "_zip"], 20);
  const label = prefix === "pickup" ? "Pickup" : "Delivery";
  if (!STREET_NUMBER.test(street) || !STREET_SUFFIX.test(street)) {
    throw new Error(label + " street must contain a building number, street name and type (for example, 123 Main St or 45 Oak Blvd).");
  }
  if (!/^[a-z][a-z .'-]{1,79}$/i.test(city)) {
    throw new Error(label + " city is required. Enter the complete city name.");
  }
  if (!US_STATE_CODES.has(state)) {
    throw new Error(label + " state is required. Use a two-letter state abbreviation such as CO.");
  }
  if (!/^\d{5}(?:-\d{4})?$/.test(zip)) {
    throw new Error(label + " ZIP is required and must be 5 digits (or ZIP+4).");
  }
  return { street, city, state, zip,
    full: [street, city, state + " " + zip].join(", ") };
}
function normStreet(value) {
  return clean(value, 500).toLowerCase()
    .replace(/\b(street|st)\b/g,"st")
    .replace(/\b(road|rd)\b/g,"rd")
    .replace(/\b(avenue|ave)\b/g,"ave")
    .replace(/\b(boulevard|blvd)\b/g,"blvd")
    .replace(/\b(court|ct)\b/g,"ct")
    .replace(/\b(place|pl)\b/g,"pl")
    .replace(/\b(drive|dr)\b/g,"dr")
    .replace(/\b(lane|ln)\b/g,"ln")
    .replace(/\b(circle|cir)\b/g,"cir")
    .replace(/\b(north|n)\b/g,"n")
    .replace(/\b(south|s)\b/g,"s")
    .replace(/\b(east|e)\b/g,"e")
    .replace(/\b(west|w)\b/g,"w")
    .replace(/\b(parkway|pkwy)\b/g,"pkwy")
    .replace(/[^a-z0-9]/g,"");
}
function geocodeMatches(found, expected) {
  if (!found || !["building", "amenity"].includes(found.resultType)) return false;
  if (String(found.housenumber || "").toLowerCase() !==
      (expected.street.match(/^\S+/)?.[0] || "").toLowerCase()) return false;
  if (!found.street || !normStreet(expected.street).endsWith(normStreet(found.street))) {
    // Expected string can contain directional prefixes, so also compare the
    // street name after removing the street number, without requiring a prefix match.
    const enteredStreet = expected.street.replace(STREET_NUMBER, "").trim();
    if (normStreet(enteredStreet) !== normStreet(found.street)) return false;
  }
  if (found.postcode && found.postcode.slice(0, 5) !== expected.zip.slice(0, 5)) return false;
  if (!found.postcode || !found.stateCode ||
      found.stateCode.toUpperCase() !== expected.state ||
      (found.countryCode && found.countryCode !== "us")) return false;
  // Some valid postal addresses use a different municipal name from the
  // geocoder. Exact building + street + state + ZIP are stronger identifiers.
  // Confidence is used as a tie-breaker, never as the only address check.
  if (Number.isFinite(found.confidence) && found.confidence < 0.55) return false;
  return true;
}


function describeAddressIssue(found, expected, label) {
  if (!found) return label + " address could not be located on the map.";
  const pieces = [];
  if (found.postcode && found.postcode.slice(0,5) !== expected.zip.slice(0,5)) {
    pieces.push("ZIP " + expected.zip + " does not match the suggested ZIP " + found.postcode);
  }
  if (found.city && found.city.toLowerCase() !== expected.city.toLowerCase() && pieces.length) {
    pieces.push("suggested city is " + found.city);
  }
  if (pieces.length) {
    return label + ": " + pieces.join("; ") + ". Please check the full address.";
  }
  return label + ": The street number or address could not be confirmed. Dispatch will verify it.";
}

const INTRODUCTORY_DISCOUNT = 0.14;
// Primary local coverage: 35-mile radius around downtown Denver.
const LOCAL_COVERAGE_CENTER = { lat: 39.7392, lon: -104.9903 };
const LOCAL_COVERAGE_MILES = 35;
function distanceMiles(a, b) {
  const radians = value => value * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

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

async function geocodeAddress(input, expected) {
  const apiKey = String(process.env.GEOAPIFY_API_KEY || "34d895e9c6cd4d1faf0692f758aac8ac").trim();
  const url = new URL("https://api.geoapify.com/v1/geocode/search");
  url.searchParams.set("text", input);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  url.searchParams.set("filter", "rect:-109.06,36.99,-102.04,41.00|countrycode:us");
  url.searchParams.set("apiKey", apiKey);
  const result = await fetch(url);
  if (!result.ok) throw new Error("Address lookup failed.");
  const payload = await result.json();
  const candidates = (Array.isArray(payload.results) ? payload.results : []).map(match => ({
    lat: Number(match?.lat),
    lon: Number(match?.lon),
    postcode: String(match?.postcode || "").trim(),
    resultType: String(match?.result_type || "").toLowerCase(),
    housenumber: String(match?.housenumber || "").trim(),
    street: String(match?.street || "").trim(),
    city: String(match?.city || match?.town || match?.village || match?.municipality || "").trim(),
    stateCode: String(match?.state_code || "").trim(),
    countryCode: String(match?.country_code || "").trim().toLowerCase(),
    confidence: match?.rank?.confidence == null ? null : Number(match.rank.confidence)
  })).filter(candidate => Number.isFinite(candidate.lat) && Number.isFinite(candidate.lon));
  if (!candidates.length) throw new Error("Address could not be located.");
  // Use an exact-number/street/state/ZIP match, not simply the geocoder's
  // first result (which can be a street or a similar address).
  return candidates.find(candidate => geocodeMatches(candidate, expected)) || candidates[0];
}

async function calculateRouteMiles(pickup, delivery, pickupExpected, deliveryExpected) {
  const apiKey = String(process.env.GEOAPIFY_API_KEY || "34d895e9c6cd4d1faf0692f758aac8ac").trim();
  const [start, finish] = await Promise.all([geocodeAddress(pickup, pickupExpected), geocodeAddress(delivery, deliveryExpected)]);
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
  return { miles: Math.round(miles * 10) / 10, start, finish };

}

function calculatePackageFees(pieceCount, packageWeight) {
  const additionalPieces = Math.max(0, pieceCount - 2);
  const extraPieceFee = additionalPieces * 4;
  const heavyWeightFee = normalizeToken(packageWeight) === "over_75_lbs" ? 8 : 0;
  return { additionalPieces, extraPieceFee, heavyWeightFee, total: extraPieceFee + heavyWeightFee };
}

function calculatePriceBreakdown({ vehicleType, deliverySpeed, serviceLevel, miles, packageFees }) {
  const rate = PRICE_CHART[normalizeToken(vehicleType)];
  const speedMultiplier = SPEED_MULTIPLIERS[normalizeToken(deliverySpeed)];
  if (!rate || !speedMultiplier || !Number.isFinite(miles) || miles <= 0) return null;
  let multiplier = speedMultiplier;
  if (normalizeToken(serviceLevel) === "stat") multiplier = Math.max(multiplier, 1.50);
  const round = value => Math.round(value * 100) / 100;
  const mileageCharge = round(miles * rate.mileage);
  const deliveryBeforeDiscount = Math.max(rate.minimum, (rate.base + miles * rate.mileage) * multiplier);
  const discountedDelivery = round(deliveryBeforeDiscount * (1 - INTRODUCTORY_DISCOUNT));
  const discountAmount = round(deliveryBeforeDiscount - discountedDelivery);
  return {
    pickup_to_delivery_miles: miles,
    mileage_rate: rate.mileage,
    mileage_charge: mileageCharge,
    base_fee: rate.base,
    minimum_delivery_charge: rate.minimum,
    speed_multiplier: multiplier,
    delivery_before_discount: round(deliveryBeforeDiscount),
    discount_percent: Math.round(INTRODUCTORY_DISCOUNT * 100),
    discount_amount: discountAmount,
    additional_pieces_fee: packageFees.extraPieceFee,
    heavy_weight_fee: packageFees.heavyWeightFee,
    package_fees: packageFees.total,
    total: round(discountedDelivery + packageFees.total)
  };
}
function calculateCustomerPrice(args) {
  return calculatePriceBreakdown(args)?.total ?? null;
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

    let pickupLocation;
    let deliveryLocation;
    try {
      pickupLocation = addressFields({ ...input, pickup_address: pickupAddress }, "pickup");
      deliveryLocation = addressFields({ ...input, delivery_address: deliveryAddress }, "delivery");
    } catch (error) {
      return response(400, { error: error.message }, origin);
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
    const pickupBusinessName = clean(input.pickup_business_name, 160);
    const deliveryBusinessName = clean(input.delivery_business_name, 160);
    if (requestSource === "website" && !deliveryType) {
      return response(400, { error: "Select whether pickup and delivery are businesses or residences." }, origin);
    }
    if (requestSource === "website" && deliveryType?.startsWith("business_to_") && !pickupBusinessName) {
      return response(400, { error: "Enter the pickup business name." }, origin);
    }
    if (requestSource === "website" && deliveryType?.endsWith("_to_business") && !deliveryBusinessName) {
      return response(400, { error: "Enter the delivery business name." }, origin);
    }

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
      pickupBusinessName && deliveryType?.startsWith("business_to_") ? `Pickup business: ${pickupBusinessName}` : "",
      deliveryBusinessName && deliveryType?.endsWith("_to_business") ? `Delivery business: ${deliveryBusinessName}` : "",
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

    const pickupRouteAddress = pickupLocation.full;
    const deliveryRouteAddress = deliveryLocation.full;
    let routeMiles = null;
    let routeData = null;
    let routeError = null;
    try {
      routeData = await calculateRouteMiles(pickupRouteAddress, deliveryRouteAddress, pickupLocation, deliveryLocation);
      routeMiles = routeData.miles;
    } catch (error) {
      routeError = error;
      console.error("public quote route calculation failed", { message: error?.message });
    }

    // Never offer an automatic estimate for a street-only geocode, ambiguous house
    // number, mismatched city/ZIP or unavailable lookup. The quote can still be
    // saved for dispatch review if the customer supplied a complete typed address.
    const pickupAddressVerified = !!routeData && geocodeMatches(routeData.start, pickupLocation);
    const deliveryAddressVerified = !!routeData && geocodeMatches(routeData.finish, deliveryLocation);
    const addressNeedsVerification = !pickupAddressVerified || !deliveryAddressVerified;
    const verificationIssues = addressNeedsVerification ? [
      !pickupAddressVerified ? describeAddressIssue(routeData?.start, pickupLocation, "Pickup") : null,
      !deliveryAddressVerified ? describeAddressIssue(routeData?.finish, deliveryLocation, "Delivery") : null
    ].filter(Boolean) : [];
    const pickupOutside = !!routeData && distanceMiles(LOCAL_COVERAGE_CENTER, routeData.start) > LOCAL_COVERAGE_MILES;
    const deliveryOutside = !!routeData && distanceMiles(LOCAL_COVERAGE_CENTER, routeData.finish) > LOCAL_COVERAGE_MILES;
    const outsideServiceArea = pickupOutside || deliveryOutside;
    const needsCustomReview = outsideServiceArea || addressNeedsVerification;
    // A preliminary estimate is still helpful when the map returns driving miles
    // but address components or the service area require dispatch approval.
    // Never treat this estimated amount as payment approval.
    const priceBreakdown = calculatePriceBreakdown({
      vehicleType: input.vehicle_type,
      deliverySpeed,
      serviceLevel,
      miles: routeMiles,
      packageFees
    });
    const customerPrice = priceBreakdown?.total ?? null;
    // Every public request still requires dispatch approval before any payment.
    const needsReview = true;
    // Route miles and pricing have dedicated quote fields; address/service-area
    // warnings belong in internal_dispatch_notes. Never mix automatically
    // generated review diagnostics into customer Special/Additional Notes.

    const payload = {
      customer_name: customerName,
      customer_email: nullable(input.customer_email || input.email, 200),
      customer_phone: customerPhone,

      pickup_address: pickupLocation.street,
      pickup_business_name: deliveryType?.startsWith("business_to_") ? nullable(pickupBusinessName, 160) : null,
      pickup_suite_floor: nullable(input.pickup_suite_floor, 120),
      pickup_city: pickupLocation.city,
      pickup_state: pickupLocation.state,
      pickup_zip: pickupLocation.zip,

      delivery_address: deliveryLocation.street,
      delivery_business_name: deliveryType?.endsWith("_to_business") ? nullable(deliveryBusinessName, 160) : null,
      delivery_suite_floor: nullable(input.delivery_suite_floor, 120),
      delivery_city: deliveryLocation.city,
      delivery_state: deliveryLocation.state,
      delivery_zip: deliveryLocation.zip,
      delivery_recipient_name: nullable(input.delivery_recipient_name || input.delivery_contact_name, 160),

      vehicle_type: nullable(input.vehicle_type, 100),
      delivery_speed: nullable(deliverySpeed, 100),
      job_category: jobCategory,
      delivery_type: deliveryType,
      service_level: serviceLevel,
      package_type: nullable(input.package_type, 160),
      weight: nullable(input.weight || packageWeight, 100),
      special_instructions: instructionParts.length ? instructionParts.join("\n") : null,
      internal_dispatch_notes: needsCustomReview ? [
        outsideServiceArea ? "CUSTOM QUOTE REQUIRED: OUTSIDE SERVICE AREA" : "",
        addressNeedsVerification ? "ADDRESS VERIFICATION REQUIRED: CUSTOM QUOTE" : "",
        ...verificationIssues
      ].filter(Boolean).join("\n") : null,
      // Only a dispatch approval flow may set approved_price/customer_charge.
      approved_price: null,
      preliminary_quote_amount: customerPrice,
      quoted_route_miles: routeMiles,
      customer_charge: 0,
      payment_status: null,

      return_required: returnRequired,
      return_location_type: returnLocationType,
      return_timing: returnTiming,
      return_address: returnRequired && returnLocationType === "different_location" ? nullable(input.return_address, 500) : null,
      return_suite_floor: returnRequired && returnLocationType === "different_location" ? nullable(input.return_suite_floor, 120) : null,
      return_zip: returnRequired && returnLocationType === "different_location" ? nullable(input.return_zip, 20) : null,

      request_source: requestSource, // Store voice requests as phone calls, not website orders.
      status: "new"
    };

    const created = await supabaseRequest("quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const quote = Array.isArray(created) ? created[0] : created;
    if (requestSource === "website" && quote?.id) {
      try { await notifyDispatch("quote-" + quote.id, {title:"New online quote",body:"A customer submitted a quote. Open dispatch to review.",url:"/pending-approval.html",tag:"quote-" + quote.id}); }
      catch (_) { console.error("Online quote push could not be queued"); }
    }

    // Dispatch creates Checkout later with "Approve & Send Payment Link".
    const checkoutUrl = "";

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
            subject: `New MG Express Order • ${quoteNumber}`,
            html: `
              <div style="margin:0;padding:20px 12px;background:#f2f2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1c1c1e;line-height:1.5">
                <div style="max-width:560px;margin:0 auto">
                  <p style="font-size:12px;font-weight:800;letter-spacing:1px;color:#24553e;margin:0 0 10px">MG EXPRESS · DISPATCH</p>
                  <div style="background:#fff;border:1px solid #e4e4e9;border-radius:20px;padding:22px 20px;margin-bottom:12px">
                    <h1 style="font-size:25px;line-height:1.2;margin:0 0 6px;color:#1c1c1e">New order received</h1>
                    <p style="font-size:13px;color:#77777d;margin:0 0 16px">Quote #${show(quoteNumber)}</p>
                    <span style="display:inline-block;background:#fff3dd;border-radius:99px;padding:6px 11px;color:#925b03;font-size:12px;font-weight:700">Dispatch approval needed</span>
                    <p style="font-size:12px;color:#75757b;margin:20px 0 2px">Estimated customer price</p>
                    <p style="font-size:38px;line-height:1.1;font-weight:750;letter-spacing:-1px;color:#0f4f32;margin:0">${customerPrice != null ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(customerPrice) : 'Pricing pending'}</p>
                    <p style="font-size:12px;color:#77777d;margin:8px 0 0">Quote only · Not approved or paid</p>
                    ${needsCustomReview ? '<p style="padding:11px 13px;margin:16px 0 0;background:#fff7e8;color:#82551a;border-radius:11px;font-size:13px;font-weight:600">' + (addressNeedsVerification ? 'Address needs verification' : 'Custom route needs review') + (outsideServiceArea ? ' · Outside standard service area' : '') + '</p>' : ''}
                  </div>
                  <div style="background:#fff;border:1px solid #e4e4e9;border-radius:18px;padding:18px 20px;margin-bottom:12px">
                    <h2 style="font-size:15px;margin:0 0 14px">Route</h2>
                    <p style="font-size:11px;font-weight:800;letter-spacing:.6px;color:#208047;margin:0 0 3px">PICKUP</p>
                    ${payload.pickup_business_name ? '<p style="font-size:14px;font-weight:700;margin:0 0 3px">' + show(payload.pickup_business_name) + '</p>' : ''}
                    <p style="font-size:15px;font-weight:600;margin:0 0 2px;overflow-wrap:anywhere">${show(pickupLocation.full)}</p>
                    <p style="font-size:13px;color:#6b6b70;margin:0">Pickup: ${show(displayPreferredTime(preferredPickupTime))}</p>
                    <div style="border-top:1px solid #ebebef;margin:16px 0"></div>
                    <p style="font-size:11px;font-weight:800;letter-spacing:.6px;color:#bb6a12;margin:0 0 3px">DELIVERY</p>
                    ${payload.delivery_business_name ? '<p style="font-size:14px;font-weight:700;margin:0 0 3px">' + show(payload.delivery_business_name) + '</p>' : ''}
                    <p style="font-size:15px;font-weight:600;margin:0 0 2px;overflow-wrap:anywhere">${show(deliveryLocation.full)}</p>
                    <p style="font-size:13px;color:#6b6b70;margin:0">Deliver by: ${show(displayPreferredTime(preferredDeliveryTime))}</p>
                  </div>
                  <div style="background:#fff;border:1px solid #e4e4e9;border-radius:18px;padding:18px 20px;margin-bottom:12px">
                    <h2 style="font-size:15px;margin:0 0 8px">Order details</h2>
                    <p style="font-size:14px;color:#44444a;margin:0;line-height:1.7">
                      ${show(payload.vehicle_type)} · ${pieceCount} ${pieceCount === 1 ? 'piece' : 'pieces'} · ${show(packageWeight.replaceAll('_',' '))}
                      ${routeMiles != null ? ' · ' + show(routeMiles) + ' mi' : ''}
                      ${returnRequired ? ' · Return requested' : ''}
                    </p>
                    ${input.date ? '<p style="font-size:13px;color:#6b6b70;margin:8px 0 0">Date: ' + show(input.date) + '</p>' : ''}
                    ${clean(input.reference_number,160) ? '<p style="font-size:13px;color:#6b6b70;margin:8px 0 0">Ref: ' + show(input.reference_number) + '</p>' : ''}
                  </div>
                  <div style="background:#fff;border:1px solid #e4e4e9;border-radius:18px;padding:18px 20px;margin-bottom:12px">
                    <h2 style="font-size:15px;margin:0 0 8px">Customer</h2>
                    <p style="font-size:15px;font-weight:700;margin:0 0 5px">${show(payload.customer_name)}</p>
                    ${company ? '<p style="font-size:13px;color:#66666a;margin:0 0 6px">' + show(company) + '</p>' : ''}
                    ${payload.customer_phone ? '<p style="margin:5px 0;font-size:14px"><a style="color:#007aff;text-decoration:none" href="tel:' + encodeURIComponent(clean(payload.customer_phone,80)) + '">' + show(payload.customer_phone) + '</a></p>' : ''}
                    ${payload.customer_email ? '<p style="margin:5px 0;font-size:14px;overflow-wrap:anywhere"><a style="color:#007aff;text-decoration:none" href="mailto:' + encodeURIComponent(clean(payload.customer_email,160)) + '">' + show(payload.customer_email) + '</a></p>' : ''}
                  </div>
                  ${[input.pickup_contact_name,input.pickup_contact_phone,input.pickup_instructions,input.delivery_contact_phone,input.delivery_instructions,input.special_instructions,input.details].some(value => clean(value)) ? `
                    <div style="background:#fff;border:1px solid #e4e4e9;border-radius:18px;padding:18px 20px;margin-bottom:12px">
                      <h2 style="font-size:15px;margin:0 0 9px">Additional notes</h2>
                      ${input.pickup_contact_name ? '<p style="font-size:13px;margin:5px 0">Pickup contact: ' + show(input.pickup_contact_name) + '</p>' : ''}
                      ${input.pickup_contact_phone ? '<p style="font-size:13px;margin:5px 0">Pickup phone: ' + show(input.pickup_contact_phone) + '</p>' : ''}
                      ${input.pickup_instructions ? '<p style="font-size:13px;margin:5px 0;white-space:pre-line">Pickup: ' + show(input.pickup_instructions) + '</p>' : ''}
                      ${input.delivery_contact_phone ? '<p style="font-size:13px;margin:5px 0">Delivery phone: ' + show(input.delivery_contact_phone) + '</p>' : ''}
                      ${input.delivery_instructions ? '<p style="font-size:13px;margin:5px 0;white-space:pre-line">Delivery: ' + show(input.delivery_instructions) + '</p>' : ''}
                      ${input.special_instructions ? '<p style="font-size:13px;margin:5px 0;white-space:pre-line">' + show(input.special_instructions) + '</p>' : ''}
                      ${input.details ? '<p style="font-size:13px;margin:5px 0;white-space:pre-line">' + show(input.details) + '</p>' : ''}
                    </div>` : ''}
                  <a href="https://portal.migenteexpress.com/" style="display:block;background:#0f4f32;color:#fff;border-radius:14px;padding:15px 18px;font-size:15px;font-weight:700;text-decoration:none;text-align:center">Open Dispatch Portal</a>
                  <p style="margin:14px 0 0;color:#92929a;font-size:11px;text-align:center">MG Express · Internal order notification</p>
                </div>
              </div>
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
              subject: "MG Express Quote Request Received",
              html: `
                <div style="font-family:Arial,sans-serif;max-width:540px;margin:0 auto;padding:24px;color:#1f3d2b;line-height:1.6">
                  <h2 style="margin:0 0 16px;color:#0f4f32">Quote Request Received</h2>
                  <p>Thank you, ${show(payload.customer_name)}. We received your delivery request.</p>
                  ${customerPrice != null
                    ? '<p style="margin:18px 0 4px;font-weight:700">Estimated Price</p><p style="margin:0 0 18px;font-size:32px;line-height:1.2;font-weight:800;color:#0f4f32">$' + customerPrice.toFixed(2) + '</p>'
                    : '<p style="margin:18px 0">Dispatch is preparing your estimate.</p>'}
                  <p>Dispatch will review your order and send you a secure payment link shortly if approved.</p>
                  <p style="font-size:13px;color:#5b655f;border-top:1px solid #e1e8e3;padding-top:12px;margin-top:20px">This is a quote only. The final price may change after review. No payment has been taken.</p>
                </div>
              `
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
      quote_status: needsCustomReview ? "custom_review" : "review",
      outside_service_area: outsideServiceArea,
      address_verification_required: addressNeedsVerification,
      verification_issues: verificationIssues,
      amount: customerPrice,
      provisional_estimate: needsCustomReview,
      pricing_breakdown: priceBreakdown,
      mileage_basis: "pickup_to_delivery_driving",
      discount_percent: 14,
      amount_label: customerPrice != null
        ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(customerPrice)
        : null,
      checkout_url: null,
      review_token: quote?.id ? createReviewToken(quote.id) : null,
      customer_email_sent: customerEmailSent,
      message: needsCustomReview
        ? `${customerPrice != null ? "This is a tentative estimate using mapped driving miles between pickup and drop-off. " : "We could not calculate reliable driving miles, so dispatch will prepare your estimate. "}${verificationIssues.join(" ")}${outsideServiceArea ? " Route is outside our standard Denver metro coverage. " : " "}Dispatch must verify your route, availability and final price. No payment has been taken.`
        : customerPrice != null
        ? `Your preliminary estimate uses ${routeMiles} pickup-to-delivery driving miles and the 14% introductory delivery discount. Dispatch will confirm the final price and send a secure payment link only after approval. No payment has been taken.`
        : "Driving mileage or pricing was unavailable. Dispatch will contact you with a manually calculated quote before requesting payment."
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

