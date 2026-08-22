const { supabaseRequest, sendResendEmail, toJsonResponse } = require("./_shared");

const ACTIVATION_URL = "https://portal.migenteexpress.com/driver-activate.html";
const MAIN_SITE_URL = "https://migenteexpress.com";

function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function response(statusCode, body) {
  return toJsonResponse(statusCode, body);
}

function text(value) {
  return String(value || "").trim();
}

function unpack(value, key) {
  const part = text(value).split("||").find(item => item.startsWith(`${key}=`));
  if (!part) return "";
  try {
    return decodeURIComponent(part.slice(key.length + 1));
  } catch (_error) {
    return part.slice(key.length + 1);
  }
}

function setPacked(value, key, newValue) {
  const parts = text(value).split("||").filter(Boolean);
  const encoded = encodeURIComponent(String(newValue || ""));
  let found = false;
  const next = parts.map(part => {
    if (part.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${encoded}`;
    }
    return part;
  });
  if (!found) next.push(`${key}=${encoded}`);
  return next.join("||");
}

function stripApplicationMarker(value) {
  return text(value)
    .split("||")[0]
    .replace("[DRIVER_APPLICATION]", "")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function authRequest(path, options = {}) {
  const url = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const result = await fetch(`${url}/auth/v1/${path.replace(/^\//, "")}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const bodyText = await result.text();
  let data = null;
  if (bodyText) {
    try { data = JSON.parse(bodyText); } catch (_error) { data = bodyText; }
  }

  if (!result.ok) {
    const error = new Error(data?.msg || data?.message || bodyText || `Auth request failed (${result.status})`);
    error.statusCode = result.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function verifyDispatcher(accessToken) {
  if (!accessToken) return null;
  const url = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const result = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!result.ok) return null;
  const user = await result.json();

  const profiles = await supabaseRequest(
    `profiles?select=id,role&id=eq.${encodeURIComponent(user.id)}`
  );
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (text(profile?.role).toLowerCase() === "driver") return null;
  return user;
}

async function findAuthUserByEmail(email) {
  const data = await authRequest("admin/users?page=1&per_page=1000", { method: "GET" });
  const users = Array.isArray(data) ? data : (data?.users || []);
  return users.find(user => text(user.email).toLowerCase() === email.toLowerCase()) || null;
}

async function generateActionLink(email, type, fullName) {
  return authRequest("admin/generate_link", {
    method: "POST",
    body: JSON.stringify({
      type,
      email,
      data: { role: "driver", full_name: fullName },
      redirect_to: ACTIVATION_URL
    })
  });
}

async function ensureDriverProfile(userId, fullName) {
  const existing = await supabaseRequest(
    `profiles?select=id,role&id=eq.${encodeURIComponent(userId)}`
  );
  const profile = Array.isArray(existing) ? existing[0] : null;

  if (profile && text(profile.role) && text(profile.role).toLowerCase() !== "driver") {
    throw new Error("This email already belongs to a non-driver MG Express account.");
  }

  await supabaseRequest("profiles?on_conflict=id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify({ id: userId, role: "driver", full_name: fullName })
  });
}

function driverPortalRecord(application, userId) {
  const vehicle = stripApplicationMarker(application.vehicle_make_model);
  const serviceArea = stripApplicationMarker(application.service_area);
  const record = { id: userId };

  const copyFields = [
    "full_name", "display_name", "name", "email", "phone", "mobile_phone",
    "vehicle_type", "vehicle", "current_area", "area", "city"
  ];

  for (const field of copyFields) {
    if (Object.prototype.hasOwnProperty.call(application, field)) {
      record[field] = application[field];
    }
  }

  if (Object.prototype.hasOwnProperty.call(application, "vehicle_make_model")) {
    record.vehicle_make_model = vehicle;
  }
  if (Object.prototype.hasOwnProperty.call(application, "service_area")) {
    record.service_area = serviceArea;
  }
  if (Object.prototype.hasOwnProperty.call(application, "availability_status")) {
    record.availability_status = "offline";
  }
  if (Object.prototype.hasOwnProperty.call(application, "active")) record.active = true;
  if (Object.prototype.hasOwnProperty.call(application, "is_active")) record.is_active = true;
  if (Object.prototype.hasOwnProperty.call(application, "enabled")) record.enabled = true;

  return record;
}

async function ensurePortalDriver(application, userId) {
  const record = driverPortalRecord(application, userId);
  await supabaseRequest("drivers?on_conflict=id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(record)
  });

  if (String(application.id) !== String(userId)) {
    await supabaseRequest(`quotes?assigned_driver_id=eq.${encodeURIComponent(application.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigned_driver_id: userId })
    });
  }
}

async function markApplicationInvited(application, userId) {
  const invitedAt = new Date().toISOString();
  let serviceArea = text(application.service_area);
  serviceArea = setPacked(serviceArea, "H", "hired");
  serviceArea = setPacked(serviceArea, "AU", userId);
  serviceArea = setPacked(serviceArea, "IV", invitedAt);

  const payload = { service_area: serviceArea };
  if (Object.prototype.hasOwnProperty.call(application, "active")) payload.active = false;
  if (Object.prototype.hasOwnProperty.call(application, "is_active")) payload.is_active = false;
  if (Object.prototype.hasOwnProperty.call(application, "enabled")) payload.enabled = false;

  await supabaseRequest(`drivers?id=eq.${encodeURIComponent(application.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  return { serviceArea, invitedAt };
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return response(405, { error: "Method not allowed." });
  }

  try {
    const authorization = String(event.headers?.authorization || event.headers?.Authorization || "");
    const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
    const dispatcher = await verifyDispatcher(accessToken);
    if (!dispatcher) return response(401, { error: "Dispatch sign-in required." });

    const input = JSON.parse(event.body || "{}");
    const driverId = text(input.driver_id);
    if (!driverId) return response(400, { error: "Driver application ID is required." });

    const rows = await supabaseRequest(
      `drivers?select=*&id=eq.${encodeURIComponent(driverId)}`
    );
    const application = Array.isArray(rows) ? rows[0] : null;
    if (!application) return response(404, { error: "Driver application was not found." });

    const email = text(application.email);
    const fullName = text(application.full_name || application.display_name || application.name || "MG Express Driver");
    if (!email) return response(400, { error: "This driver does not have an email address." });
    if (unpack(application.service_area, "H").toLowerCase() !== "hired") {
      return response(400, { error: "Only hired drivers can receive portal invites." });
    }

    let authUser = await findAuthUserByEmail(email);
    let linkType = "invite";
    let linkData;

    if (authUser) {
      linkType = "recovery";
      linkData = await generateActionLink(email, "recovery", fullName);
    } else {
      linkData = await generateActionLink(email, "invite", fullName);
      authUser = linkData?.user || null;
      if (!authUser?.id) authUser = await findAuthUserByEmail(email);
    }

    const userId = text(authUser?.id || linkData?.user?.id || linkData?.id);
    const actionLink = text(linkData?.action_link || linkData?.properties?.action_link);
    if (!userId || !actionLink) {
      throw new Error("Supabase did not return a valid driver activation link.");
    }

    await ensureDriverProfile(userId, fullName);
    await ensurePortalDriver(application, userId);
    const marked = await markApplicationInvited(application, userId);

    const safeName = escapeHtml(fullName);
    const safeLink = escapeHtml(actionLink);
    const emailResult = await sendResendEmail({
      to: [email],
      subject: linkType === "invite" ? "Set up your MG Express Driver Portal" : "MG Express Driver Portal access",
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.55;color:#17221e;max-width:620px;margin:auto">
          <h2 style="color:#064f3b">Welcome to MG Express</h2>
          <p>Hi ${safeName},</p>
          <p>Your MG Express driver account is ready. Use the button below to create or update your password.</p>
          <p style="margin:26px 0"><a href="${safeLink}" style="display:inline-block;background:#087455;color:#fff;text-decoration:none;font-weight:700;padding:13px 18px;border-radius:10px">Set Up Driver Portal</a></p>
          <p>After your password is created, go to <strong>migenteexpress.com</strong> and choose the Driver Portal to sign in.</p>
          <p>If you did not expect this message, contact MG Express Dispatch.</p>
        </div>
      `,
      text: `Hi ${fullName},\n\nYour MG Express driver account is ready. Set up your password here:\n${actionLink}\n\nAfter setup, go to ${MAIN_SITE_URL} and choose the Driver Portal to sign in.`
    });

    if (!emailResult.configured) {
      throw new Error("Driver email service is not configured on the portal.");
    }

    return response(200, {
      ok: true,
      message: linkType === "invite" ? "Driver portal invite sent." : "Driver portal access link resent.",
      invited_at: marked.invitedAt,
      service_area: marked.serviceArea,
      auth_user_id: userId
    });
  } catch (error) {
    console.error("invite-driver error", error);
    return response(error.statusCode && error.statusCode < 500 ? error.statusCode : 500, {
      error: error.message || "Unable to send the driver portal invite."
    });
  }
};
