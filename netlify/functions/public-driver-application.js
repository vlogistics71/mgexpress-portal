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

function missingColumnName(error) {
  const text = `${error?.message || ""} ${JSON.stringify(error?.data || {})}`;
  const patterns = [
    /Could not find the ['\"]([^'\"]+)['\"] column/i,
    /column ['\"]?([a-zA-Z0-9_]+)['\"]? .* does not exist/i,
    /PGRST204[\s\S]*?['\"]([a-zA-Z0-9_]+)['\"]/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return "";
}

async function insertAdaptive(payload) {
  const working = { ...payload };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await supabaseRequest("drivers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(working)
      });
    } catch (error) {
      const missing = missingColumnName(error);
      if (missing && Object.prototype.hasOwnProperty.call(working, missing)) {
        delete working[missing];
        continue;
      }
      if ((error?.statusCode === 400 || error?.statusCode === 409) && Object.prototype.hasOwnProperty.call(working, "status")) {
        delete working.status;
        continue;
      }
      throw error;
    }
  }
  throw new Error("Unable to match driver table schema.");
}

function pack(value) {
  return encodeURIComponent(clean(value, 500));
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
    const name = clean(input.name, 160);
    const phone = clean(input.phone, 80);
    const email = clean(input.email, 200);
    const residence = clean(input.area_of_residence, 160);
    const vehicleType = clean(input.vehicle_type, 100);
    const vehicleDetails = clean(input.vehicle_details, 220);
    const availability = clean(input.availability, 160);
    const preferredArea = clean(input.preferred_work_area, 160);
    const experience = clean(input.delivery_experience, 40);
    const validLicense = clean(input.valid_drivers_license, 40);
    const insured = clean(input.current_auto_insurance, 40);
    const applicantNotes = clean(input.notes, 500);

    if (!name || !phone || !email || !residence || !vehicleType || !vehicleDetails || !availability || !preferredArea || !experience || !validLicense || !insured) {
      return response(400, { error: "Please complete all required driver application fields." }, origin);
    }

    const applicationText = [
      "[DRIVER_APPLICATION]",
      `Submitted: ${new Date().toISOString()}`,
      `Residence: ${residence}`,
      `Vehicle Type: ${vehicleType}`,
      `Vehicle: ${vehicleDetails}`,
      `Availability: ${availability}`,
      `Preferred Work Area: ${preferredArea}`,
      `Courier / Delivery Experience: ${experience}`,
      `Valid Driver's License: ${validLicense}`,
      `Current Auto Insurance: ${insured}`,
      applicantNotes ? `Applicant Notes: ${applicantNotes}` : ""
    ].filter(Boolean).join("\n");

    // The existing drivers table reliably keeps vehicle_make_model and service_area.
    // Store a compact application payload in those fields so no applicant answers
    // are lost even when optional driver columns do not exist in the schema.
    const markedVehicleDetails = [
      `[DRIVER_APPLICATION] ${vehicleDetails}`,
      `R=${pack(residence)}`,
      `A=${pack(availability)}`,
      `E=${pack(experience)}`,
      `L=${pack(validLicense)}`,
      `I=${pack(insured)}`
    ].join("||");

    const markedServiceArea = [
      `[DRIVER_APPLICATION] ${preferredArea}`,
      `N=${pack(applicantNotes)}`,
      `S=${pack(new Date().toISOString())}`
    ].join("||");

    const payload = {
      full_name: name,
      display_name: name,
      name,
      email,
      phone,
      mobile_phone: phone,
      vehicle_type: vehicleType,
      vehicle: vehicleType,
      vehicle_make_model: markedVehicleDetails,
      current_area: residence,
      area: residence,
      city: residence,
      service_area: markedServiceArea,
      availability_status: "offline",
      status: "applicant",
      active: false,
      is_active: false,
      enabled: false,
      notes: applicationText,
      internal_notes: applicationText,
      dispatch_notes: applicationText
    };

    const created = await insertAdaptive(payload);
    const row = Array.isArray(created) ? created[0] : created;
    return response(201, {
      ok: true,
      id: row?.id || null,
      message: "Application received. MG Express will review your information and contact you if there is a fit."
    }, origin);
  } catch (error) {
    console.error("public-driver-application error", error);
    return response(500, {
      error: "Unable to submit your application right now. Please try again."
    }, origin);
  }
};
