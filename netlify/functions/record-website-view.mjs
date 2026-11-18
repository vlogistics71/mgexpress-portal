import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { supabaseRequest } = require("./_shared");

const ALLOWED_ORIGINS = new Set([
  "https://migenteexpress.com",
  "https://www.migenteexpress.com"
]);
const BOT_PATTERN = /bot|crawler|spider|slurp|preview|facebookexternalhit|linkedinbot|headless/i;

function response(status, body, origin = "") {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function cleanPath(value) {
  const raw = String(value || "").trim();
  if (!raw.startsWith("/") || raw.length > 300) return "";
  return raw.split("?")[0].split("#")[0].slice(0, 300) || "/";
}

function deviceType(userAgent) {
  const ua = String(userAgent || "");
  if (/ipad|tablet|kindle|silk|playbook|android(?!.*mobile)/i.test(ua)) return "Tablet";
  if (/mobile|iphone|ipod|android/i.test(ua)) return "Mobile";
  return "Desktop";
}

function referrerHost(value) {
  try {
    const url = new URL(String(value || ""));
    return url.hostname.slice(0, 200) || null;
  } catch {
    return null;
  }
}

function cleanLocation(value, maxLength = 100) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : null;
}

export default async (request, context) => {
  const origin = String(request.headers.get("origin") || "").replace(/\/$/, "");

  if (request.method === "OPTIONS") {
    return ALLOWED_ORIGINS.has(origin)
      ? response(204, {}, origin)
      : response(403, { error: "Origin not allowed" });
  }
  if (request.method !== "POST") return response(405, { error: "Method not allowed" }, origin);
  if (!ALLOWED_ORIGINS.has(origin)) return response(403, { error: "Origin not allowed" });

  const userAgent = String(request.headers.get("user-agent") || "");
  if (!userAgent || BOT_PATTERN.test(userAgent)) return response(200, { recorded: false }, origin);

  let body;
  try {
    body = await request.json();
  } catch {
    return response(400, { error: "Invalid request" }, origin);
  }

  const path = cleanPath(body.path);
  const sessionId = String(body.session_id || "");
  if (!path || sessionId.length < 20 || sessionId.length > 100) {
    return response(400, { error: "Invalid request" }, origin);
  }

  const geo = context?.geo || {};
  const location = {
    city: cleanLocation(geo.city),
    region: cleanLocation(geo.subdivision?.name || geo.subdivision?.code),
    country: cleanLocation(geo.country?.code || geo.country?.name, 80)
  };

  const sessionHash = crypto.createHash("sha256").update(sessionId, "utf8").digest("hex");
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const duplicate = await supabaseRequest(
    `website_page_views?select=id&session_hash=eq.${sessionHash}&path=eq.${encodeURIComponent(path)}&viewed_at=gte.${encodeURIComponent(since)}&limit=1`
  );

  if (!Array.isArray(duplicate) || duplicate.length === 0) {
    await supabaseRequest("website_page_views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path,
        referrer_host: referrerHost(body.referrer),
        session_hash: sessionHash,
        device_type: deviceType(userAgent),
        city: location.city,
        region: location.region,
        country: location.country
      })
    });
  }

  return response(200, { recorded: true }, origin);
};
