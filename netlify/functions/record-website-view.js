const crypto = require("crypto");
const { supabaseRequest } = require("./_shared");

const ALLOWED_ORIGINS = new Set([
  "https://migenteexpress.com",
  "https://www.migenteexpress.com"
]);
const BOT_PATTERN = /bot|crawler|spider|slurp|preview|facebookexternalhit|linkedinbot|headless/i;

function response(statusCode, body, origin = "") {
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
  return { statusCode, headers, body: JSON.stringify(body) };
}

function cleanPath(value) {
  const raw = String(value || "").trim();
  if (!raw.startsWith("/") || raw.length > 300) return "";
  return raw.split("?")[0].split("#")[0].slice(0, 300) || "/";
}

function referrerHost(value) {
  try {
    const url = new URL(String(value || ""));
    return url.hostname.slice(0, 200) || null;
  } catch (_error) {
    return null;
  }
}

exports.handler = async event => {
  const origin = String(event.headers?.origin || event.headers?.Origin || "").replace(/\/$/, "");

  if (event.httpMethod === "OPTIONS") {
    return ALLOWED_ORIGINS.has(origin)
      ? response(204, {}, origin)
      : response(403, { error: "Origin not allowed" });
  }

  if (event.httpMethod !== "POST") return response(405, { error: "Method not allowed" }, origin);
  if (!ALLOWED_ORIGINS.has(origin)) return response(403, { error: "Origin not allowed" });

  const userAgent = String(event.headers?.["user-agent"] || "");
  if (!userAgent || BOT_PATTERN.test(userAgent)) return response(200, { recorded: false }, origin);

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (_error) {
    return response(400, { error: "Invalid request" }, origin);
  }

  const path = cleanPath(body.path);
  const sessionId = String(body.session_id || "");
  if (!path || sessionId.length < 20 || sessionId.length > 100) {
    return response(400, { error: "Invalid request" }, origin);
  }

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
        session_hash: sessionHash
      })
    });
  }

  return response(200, { recorded: true }, origin);
};
