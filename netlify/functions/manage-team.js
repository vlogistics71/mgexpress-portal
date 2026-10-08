const { supabaseRequest, sendResendEmail, toJsonResponse } = require("./_shared");

const ACTIVATION_URL = "https://portal.migenteexpress.com/staff-activate.html";
const PORTAL_URL = "https://portal.migenteexpress.com";
const TEAM_ROLES = new Set(["admin", "dispatcher", "staff"]);

function text(value) {
  return String(value || "").trim();
}

function response(statusCode, body) {
  return toJsonResponse(statusCode, body);
}

function requireEnv(name) {
  const value = text(process.env[name]);
  if (!value) throw new Error("Missing required environment variable: " + name);
  return value;
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
  const result = await fetch(url + "/auth/v1/" + path.replace(/^\//, ""), {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + serviceRoleKey,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const bodyText = await result.text();
  let data = null;
  if (bodyText) {
    try {
      data = JSON.parse(bodyText);
    } catch (_error) {
      data = bodyText;
    }
  }

  if (!result.ok) {
    const error = new Error(
      (data && typeof data === "object" && (data.msg || data.message)) ||
      bodyText ||
      "Auth request failed (" + result.status + ")"
    );
    error.statusCode = result.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function requireAdmin(event) {
  const authorization = text(event.headers?.authorization || event.headers?.Authorization);
  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    const error = new Error("Admin sign-in required.");
    error.statusCode = 401;
    throw error;
  }

  const url = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const userResponse = await fetch(url + "/auth/v1/user", {
    headers: {
      apikey: serviceRoleKey,
      Authorization: "Bearer " + accessToken
    }
  });

  if (!userResponse.ok) {
    const error = new Error("Invalid or expired admin session.");
    error.statusCode = 401;
    throw error;
  }

  const user = await userResponse.json();
  const profiles = await supabaseRequest(
    "profiles?select=id,role,full_name,team_member,team_role,team_disabled_at&id=eq." +
    encodeURIComponent(user.id) +
    "&limit=1"
  );
  const profile = Array.isArray(profiles) ? profiles[0] || null : null;

  if (text(profile?.role).toLowerCase() !== "admin") {
    const error = new Error("Administrator access is required to manage team members.");
    error.statusCode = 403;
    throw error;
  }

  return { user, profile };
}

async function listAuthUsers() {
  const data = await authRequest("admin/users?page=1&per_page=1000", { method: "GET" });
  return Array.isArray(data) ? data : (data?.users || []);
}

async function findAuthUserByEmail(email) {
  const users = await listAuthUsers();
  return users.find(user => text(user.email).toLowerCase() === email.toLowerCase()) || null;
}

async function loadTeamProfile(userId) {
  const rows = await supabaseRequest(
    "profiles?select=id,full_name,role,team_member,team_role,team_disabled_at,created_at&id=eq." +
    encodeURIComponent(userId) +
    "&limit=1"
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function loadTeamProfiles() {
  const rows = await supabaseRequest(
    "profiles?select=id,full_name,role,team_member,team_role,team_disabled_at,created_at&team_member=eq.true&order=created_at.asc"
  );
  return Array.isArray(rows) ? rows : [];
}

async function saveTeamProfile(userId, fullName, role) {
  await supabaseRequest("profiles?on_conflict=id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify({
      id: userId,
      full_name: fullName,
      role,
      team_member: true,
      team_role: role,
      team_disabled_at: null
    })
  });
}

async function patchTeamProfile(userId, payload) {
  return supabaseRequest("profiles?id=eq." + encodeURIComponent(userId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function generateActionLink(email, type, fullName, role) {
  return authRequest("admin/generate_link", {
    method: "POST",
    body: JSON.stringify({
      type,
      email,
      data: {
        full_name: fullName,
        role
      },
      redirect_to: ACTIVATION_URL
    })
  });
}

async function sendTeamAccessEmail({ email, fullName, role, actionLink, isNew }) {
  const safeName = escapeHtml(fullName || "Team Member");
  const safeRole = escapeHtml(role.charAt(0).toUpperCase() + role.slice(1));
  const safeLink = escapeHtml(actionLink);

  const result = await sendResendEmail({
    from: "MG Express Dispatch <quotes@notify.migenteexpress.com>",
    to: [email],
    subject: isNew ? "Your MG Express Dispatch Portal invite" : "MG Express Dispatch Portal access",
    html:
      '<div style="font-family:Arial,sans-serif;line-height:1.55;color:#17221e;max-width:620px;margin:auto">' +
      '<h2 style="color:#064f3b">MG Express Dispatch</h2>' +
      "<p>Hi " + safeName + ",</p>" +
      "<p>You have been given <strong>" + safeRole + "</strong> access to the MG Express Dispatch Portal.</p>" +
      '<p style="margin:26px 0"><a href="' + safeLink + '" style="display:inline-block;background:#087455;color:#fff;text-decoration:none;font-weight:700;padding:13px 18px;border-radius:10px">Set Up Portal Access</a></p>' +
      "<p>After you create your password, sign in at <strong>portal.migenteexpress.com</strong>.</p>" +
      "<p>If you did not expect this invitation, contact MG Express.</p>" +
      "</div>",
    text:
      "Hi " + (fullName || "Team Member") + ",\n\n" +
      "You have been given " + role + " access to the MG Express Dispatch Portal.\n\n" +
      "Set up your password here:\n" + actionLink + "\n\n" +
      "After setup, sign in at " + PORTAL_URL + "."
  });

  if (!result.configured) {
    throw new Error("Team invitation email service is not configured on the portal.");
  }
}

function memberStatus(profile, authUser) {
  if (text(profile.role).toLowerCase() === "disabled" || profile.team_disabled_at) return "disabled";
  if (authUser?.last_sign_in_at) return "active";
  return "invited";
}

async function listMembers() {
  const [profiles, authUsers] = await Promise.all([loadTeamProfiles(), listAuthUsers()]);
  const authById = new Map(authUsers.map(user => [String(user.id), user]));

  return profiles.map(profile => {
    const authUser = authById.get(String(profile.id)) || null;
    const assignedRole = TEAM_ROLES.has(text(profile.team_role).toLowerCase())
      ? text(profile.team_role).toLowerCase()
      : (TEAM_ROLES.has(text(profile.role).toLowerCase()) ? text(profile.role).toLowerCase() : "staff");

    return {
      id: profile.id,
      full_name: profile.full_name || "",
      email: authUser?.email || "",
      role: assignedRole,
      status: memberStatus(profile, authUser),
      disabled_at: profile.team_disabled_at || null,
      invited_at: authUser?.invited_at || null,
      last_sign_in_at: authUser?.last_sign_in_at || null,
      created_at: profile.created_at || authUser?.created_at || null
    };
  });
}

async function inviteMember(admin, input) {
  const email = text(input.email).toLowerCase();
  const fullName = text(input.full_name);
  const role = text(input.role).toLowerCase();

  if (!email || !email.includes("@")) {
    const error = new Error("Enter a valid email address.");
    error.statusCode = 400;
    throw error;
  }
  if (!fullName) {
    const error = new Error("Enter the team member's name.");
    error.statusCode = 400;
    throw error;
  }
  if (!TEAM_ROLES.has(role)) {
    const error = new Error("Choose Admin, Dispatcher, or Staff.");
    error.statusCode = 400;
    throw error;
  }

  let authUser = await findAuthUserByEmail(email);
  let existingProfile = authUser ? await loadTeamProfile(authUser.id) : null;

  if (
    existingProfile &&
    !existingProfile.team_member &&
    !TEAM_ROLES.has(text(existingProfile.role).toLowerCase()) &&
    text(existingProfile.role).toLowerCase() !== "disabled"
  ) {
    const error = new Error("This email already belongs to a non-staff MG Express account.");
    error.statusCode = 409;
    throw error;
  }

  const linkType = authUser ? "recovery" : "invite";
  const linkData = await generateActionLink(email, linkType, fullName, role);
  authUser = authUser || linkData?.user || null;
  if (!authUser?.id) authUser = await findAuthUserByEmail(email);

  const userId = text(authUser?.id || linkData?.user?.id || linkData?.id);
  const actionLink = text(linkData?.action_link || linkData?.properties?.action_link);

  if (!userId || !actionLink) {
    throw new Error("Supabase did not return a valid team activation link.");
  }

  await saveTeamProfile(userId, fullName, role);

  await sendTeamAccessEmail({
    email,
    fullName,
    role,
    actionLink,
    isNew: linkType === "invite"
  });

  return {
    ok: true,
    message: linkType === "invite" ? "Team invitation sent." : "Portal access link sent.",
    member_id: userId
  };
}

async function updateRole(admin, input) {
  const targetId = text(input.member_id);
  const role = text(input.role).toLowerCase();
  if (!targetId || !TEAM_ROLES.has(role)) {
    const error = new Error("A valid team member and role are required.");
    error.statusCode = 400;
    throw error;
  }

  const profile = await loadTeamProfile(targetId);
  if (!profile?.team_member) {
    const error = new Error("Team member not found.");
    error.statusCode = 404;
    throw error;
  }

  if (targetId === admin.user.id && role !== "admin") {
    const error = new Error("You cannot remove your own Admin role.");
    error.statusCode = 400;
    throw error;
  }

  const currentlyDisabled = text(profile.role).toLowerCase() === "disabled" || Boolean(profile.team_disabled_at);
  await patchTeamProfile(targetId, currentlyDisabled
    ? { team_role: role }
    : { role, team_role: role });

  return { ok: true, message: currentlyDisabled ? "Assigned role updated. Re-enable the account to restore access." : "Role updated." };
}

async function disableMember(admin, input) {
  const targetId = text(input.member_id);
  if (!targetId) {
    const error = new Error("Team member is required.");
    error.statusCode = 400;
    throw error;
  }
  if (targetId === admin.user.id) {
    const error = new Error("You cannot disable your own Admin account.");
    error.statusCode = 400;
    throw error;
  }

  const profile = await loadTeamProfile(targetId);
  if (!profile?.team_member) {
    const error = new Error("Team member not found.");
    error.statusCode = 404;
    throw error;
  }

  const currentRole = text(profile.role).toLowerCase();
  const assignedRole = TEAM_ROLES.has(text(profile.team_role).toLowerCase())
    ? text(profile.team_role).toLowerCase()
    : (TEAM_ROLES.has(currentRole) ? currentRole : "staff");

  await patchTeamProfile(targetId, {
    role: "disabled",
    team_role: assignedRole,
    team_disabled_at: new Date().toISOString()
  });

  return { ok: true, message: "Team member access disabled." };
}

async function enableMember(_admin, input) {
  const targetId = text(input.member_id);
  if (!targetId) {
    const error = new Error("Team member is required.");
    error.statusCode = 400;
    throw error;
  }

  const profile = await loadTeamProfile(targetId);
  if (!profile?.team_member) {
    const error = new Error("Team member not found.");
    error.statusCode = 404;
    throw error;
  }

  const assignedRole = TEAM_ROLES.has(text(profile.team_role).toLowerCase())
    ? text(profile.team_role).toLowerCase()
    : "staff";

  await patchTeamProfile(targetId, {
    role: assignedRole,
    team_role: assignedRole,
    team_disabled_at: null
  });

  return { ok: true, message: "Team member access restored." };
}

async function resendAccess(_admin, input) {
  const targetId = text(input.member_id);
  if (!targetId) {
    const error = new Error("Team member is required.");
    error.statusCode = 400;
    throw error;
  }

  const profile = await loadTeamProfile(targetId);
  if (!profile?.team_member) {
    const error = new Error("Team member not found.");
    error.statusCode = 404;
    throw error;
  }

  const users = await listAuthUsers();
  const authUser = users.find(user => String(user.id) === String(targetId));
  if (!authUser?.email) {
    const error = new Error("No login email was found for this team member.");
    error.statusCode = 404;
    throw error;
  }

  const role = TEAM_ROLES.has(text(profile.team_role).toLowerCase())
    ? text(profile.team_role).toLowerCase()
    : (TEAM_ROLES.has(text(profile.role).toLowerCase()) ? text(profile.role).toLowerCase() : "staff");

  const linkData = await generateActionLink(authUser.email, "recovery", profile.full_name || "Team Member", role);
  const actionLink = text(linkData?.action_link || linkData?.properties?.action_link);
  if (!actionLink) throw new Error("Supabase did not return a valid access link.");

  await sendTeamAccessEmail({
    email: authUser.email,
    fullName: profile.full_name || "Team Member",
    role,
    actionLink,
    isNew: false
  });

  return { ok: true, message: "Portal access link sent." };
}

exports.handler = async function handler(event) {
  try {
    const admin = await requireAdmin(event);

    if (event.httpMethod === "GET") {
      return response(200, {
        ok: true,
        current_user_id: admin.user.id,
        members: await listMembers()
      });
    }

    if (event.httpMethod !== "POST") {
      return response(405, { error: "Method not allowed." });
    }

    const input = JSON.parse(event.body || "{}");
    const action = text(input.action).toLowerCase();

    let result;
    if (action === "invite") result = await inviteMember(admin, input);
    else if (action === "update_role") result = await updateRole(admin, input);
    else if (action === "disable") result = await disableMember(admin, input);
    else if (action === "enable") result = await enableMember(admin, input);
    else if (action === "resend") result = await resendAccess(admin, input);
    else {
      const error = new Error("Unknown team management action.");
      error.statusCode = 400;
      throw error;
    }

    return response(200, result);
  } catch (error) {
    console.error("manage-team error", error);
    return response(
      error.statusCode && error.statusCode < 500 ? error.statusCode : 500,
      { error: error.message || "Unable to manage team access." }
    );
  }
};