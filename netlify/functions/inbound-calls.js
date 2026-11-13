"use strict";
const { requireDispatchAccess, supabaseRequest, toJsonResponse } = require("./_shared");

const CALL_ID = /^[A-Za-z0-9_-]{6,128}$/;
const STATUS = new Set(["needs_follow_up", "contacted", "no_follow_up_needed"]);
const CALL_RETENTION_MS = 4 * 24 * 60 * 60 * 1000;
const recentOnly = () => "&created_at=gte." +
  encodeURIComponent(new Date(Date.now() - CALL_RETENTION_MS).toISOString());

exports.handler = async function (event) {
  try {
    const actor = await requireDispatchAccess(event);
    if (event.httpMethod === "GET") {
      const calls = await supabaseRequest(
        "inbound_calls?select=provider_call_id,caller_phone,called_number,started_at,ended_at,last_event,end_reason,summary,call_outcome,requested_human,human_request_known,transfer_state,quote_status,follow_up_status,followed_up_at,created_at,updated_at" +
        recentOnly() + "&order=created_at.desc&limit=200"
      );
      return toJsonResponse(200, { calls: Array.isArray(calls) ? calls : [] });
    }
    if (event.httpMethod === "POST") {
      let payload;
      try { payload = JSON.parse(event.body || "{}"); }
      catch (_) { return toJsonResponse(400, { error: "Invalid JSON" }); }
      const id = String(payload.provider_call_id || "");
      const status = String(payload.follow_up_status || "");
      if (!CALL_ID.test(id) || !STATUS.has(status))
        return toJsonResponse(400, { error: "Invalid call or follow-up status" });
      const updated = await supabaseRequest(
        "inbound_calls?provider_call_id=eq." + encodeURIComponent(id) + recentOnly(), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            follow_up_status: status,
            followed_up_at: status === "needs_follow_up" ? null : new Date().toISOString(),
            follow_up_by: status === "needs_follow_up" ? null : actor.user.id,
            updated_at: new Date().toISOString()
          })
        }
      );
      if (!Array.isArray(updated) || !updated.length) return toJsonResponse(404, { error: "Call not found" });
      return toJsonResponse(200, { ok: true, follow_up_status: status });
    }
    return toJsonResponse(405, { error: "Method not allowed" });
  } catch (error) {
    console.error("inbound-calls endpoint error", { status: error.statusCode, message: error.message });
    return toJsonResponse(error.statusCode === 403 ? 403 : error.statusCode === 401 ? 401 : 503, {
      error: error.statusCode === 403 || error.statusCode === 401
        ? "Dispatch access required"
        : "Unable to load or update incoming call records"
    });
  }
};