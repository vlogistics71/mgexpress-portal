"use strict";

// Amanda AI Sales: read-only eligibility review. This function NEVER dials a phone.
// It is intentionally separate from Alex's incoming Retell quote function.
const { requireDispatchAccess, supabaseRequest, toJsonResponse } = require("./_shared");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function usPhoneE164(raw) {
  const input = String(raw || "").trim();
  const digits = input.replace(/[^0-9]/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}

function legalReview({ lead, phone, permission, suppressed, now }) {
  const blockers = [];
  if (!phone) blockers.push("no_valid_us_phone");
  if (lead.status === "Not Interested") blockers.push("lead_not_interested");
  if (suppressed) blockers.push("do_not_call");
  if (!permission) blockers.push("no_verified_phone_specific_ai_marketing_permission");
  if (permission) {
    if (permission.review_status !== "verified" ||
        permission.permission_kind !== "ai_marketing_voice" ||
        permission.phone_e164 !== phone ||
        !permission.verified_at ||
        !permission.verified_by ||
        permission.revoked_at ||
        new Date(permission.consented_at).getTime() > now ||
        new Date(permission.expires_at).getTime() <= now) {
      blockers.push("invalid_or_expired_permission");
    }
  }
  return blockers;
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") return toJsonResponse(405, { error: "POST required" });

  let auth;
  try {
    auth = await requireDispatchAccess(event);
  } catch (error) {
    return toJsonResponse(error.statusCode === 403 ? 403 : 401, { error: "Dispatch authentication required" });
  }

  let input;
  try {
    input = JSON.parse(event.body || "{}");
  } catch (_) {
    return toJsonResponse(400, { error: "Invalid JSON" });
  }

  if (!input || !UUID_RE.test(String(input.lead_id || ""))) {
    return toJsonResponse(400, { error: "A valid lead_id is required" });
  }

  try {
    const leadId = input.lead_id;
    const leads = await supabaseRequest(`sales_leads?select=id,business,phone,status&id=eq.${encodeURIComponent(leadId)}&limit=1`);
    const lead = Array.isArray(leads) ? leads[0] : null;
    if (!lead) return toJsonResponse(404, { error: "Lead not found" });

    const phone = usPhoneE164(lead.phone);
    let permissions = [];
    let suppressed = false;
    if (phone) {
      const [allowedRows, suppressRows] = await Promise.all([
        supabaseRequest(`sales_ai_permissions?select=phone_e164,permission_kind,review_status,consented_at,expires_at,verified_at,verified_by,revoked_at&lead_id=eq.${encodeURIComponent(leadId)}&phone_e164=eq.${encodeURIComponent(phone)}&review_status=eq.verified&order=verified_at.desc&limit=10`),
        supabaseRequest(`sales_ai_dnc?select=phone_e164&phone_e164=eq.${encodeURIComponent(phone)}&limit=1`)
      ]);
      permissions = Array.isArray(allowedRows) ? allowedRows : [];
      suppressed = Array.isArray(suppressRows) && suppressRows.length > 0;
    }

    const now = Date.now();
    const validPermission = permissions.find(p => legalReview({ lead, phone, permission: p, suppressed: false, now }).filter(x => x === "invalid_or_expired_permission").length === 0) || null;
    const complianceBlockers = legalReview({ lead, phone, permission: validPermission, suppressed, now });

    // Deliberately no Retell API call; dialing remains disabled even when flags are changed.
    const blockers = [...complianceBlockers, "outbound_agent_not_connected", "legal_and_provider_approval_pending", "dialing_disabled"];
    const report = {
      agent: "Amanda",
      lead_id: leadId,
      business: lead.business,
      mode: "review_only",
      outbound_call_placed: false,
      can_dial: false,
      compliance_checks_passed: complianceBlockers.length === 0,
      blockers
    };

    try {
      await supabaseRequest("sales_ai_call_events", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({
          lead_id: leadId,
          phone_e164: phone,
          event_kind: "eligibility_review",
          details: {
            agent: "Amanda",
            reason_codes: blockers,
            reviewed_by: auth.user.id
          }
        })
      });
    } catch (logError) {
      console.error("Amanda preflight audit failed", { message: logError.message });
      return toJsonResponse(503, { error: "Unable to audit eligibility review; no call placed." });
    }

    return toJsonResponse(200, report);
  } catch (error) {
    console.error("Amanda eligibility review failed", { message: error.message });
    return toJsonResponse(503, { error: "Eligibility review unavailable; no call placed." });
  }
};
