(function () {
  "use strict";

  function getClient() {
    if (!window.mgSupabase) {
      throw new Error(
        "MG Express Supabase client is not ready. Make sure config.js loads before auth.js."
      );
    }

    return window.mgSupabase;
  }

  function normalizeRole(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replaceAll(" ", "_")
      .replaceAll("-", "_");
  }

  async function getSession() {
    const client = getClient();

    const result =
      await client.auth.getSession();

    if (result.error) {
      throw result.error;
    }

    return result.data.session || null;
  }

  async function getProfile(userId) {
    const client = getClient();

    const result =
      await client
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

    if (result.error) {
      throw result.error;
    }

    return result.data || null;
  }

  async function requireSession(options) {
    const settings = {
      loginPage: "/index.html",
      allowedRoles: [],
      redirectOnFailure: true,
      ...options
    };

    const session =
      await getSession();

    if (!session) {
      if (settings.redirectOnFailure) {
        window.location.replace(
          settings.loginPage
        );
      }

      return null;
    }

    const profile =
      await getProfile(
        session.user.id
      );

    if (!profile) {
      if (settings.redirectOnFailure) {
        window.location.replace(
          settings.loginPage +
          "?error=profile"
        );
      }

      return null;
    }

    const role =
      normalizeRole(profile.role);

    const allowedRoles =
      settings.allowedRoles.map(
        normalizeRole
      );

    if (
      allowedRoles.length &&
      !allowedRoles.includes(role)
    ) {
      if (settings.redirectOnFailure) {
        window.location.replace(
          settings.loginPage +
          "?error=access"
        );
      }

      return null;
    }

    return {
      session,
      user: session.user,
      profile,
      role
    };
  }

  async function requireDispatch() {
    return requireSession({
      allowedRoles: [
        "admin",
        "staff",
        "dispatcher"
      ]
    });
  }

  async function requireDriver() {
    return requireSession({
      allowedRoles: [
        "driver"
      ],
      loginPage: "/driver-login.html"
    });
  }

  async function requireCustomerPortal() {
    const auth =
      await requireSession({
        allowedRoles: [
          "customer"
        ],
        loginPage: "/customer-login.html"
      });

    if (!auth) {
      return null;
    }

    const client =
      getClient();

    const accountResult =
      await client
        .from(
          "customer_portal_accounts"
        )
        .select("*")
        .eq(
          "auth_user_id",
          auth.user.id
        )
        .eq(
          "is_recurring_customer",
          true
        )
        .eq(
          "portal_access_enabled",
          true
        )
        .maybeSingle();

    if (accountResult.error) {
      throw accountResult.error;
    }

    if (!accountResult.data) {
      window.location.replace(
        "/customer-login.html?error=access"
      );

      return null;
    }

    return {
      ...auth,
      customerAccount:
        accountResult.data
    };
  }

  async function signOut(options) {
    const settings = {
      redirectTo: "/index.html?loggedout=1",
      clearStorage: true,
      ...options
    };

    const client =
      getClient();

    try {
      await client.auth.signOut();
    } finally {
      if (settings.clearStorage) {
        localStorage.clear();
        sessionStorage.clear();
      }

      window.location.replace(
        settings.redirectTo
      );
    }
  }

  async function updateLastLogin() {
    const session =
      await getSession();

    if (!session) {
      return;
    }

    const client =
      getClient();

    await client
      .from(
        "customer_portal_accounts"
      )
      .update({
        portal_last_login_at:
          new Date().toISOString()
      })
      .eq(
        "auth_user_id",
        session.user.id
      );
  }

  window.MG_AUTH = Object.freeze({
    getSession,
    getProfile,
    requireSession,
    requireDispatch,
    requireDriver,
    requireCustomerPortal,
    signOut,
    updateLastLogin,
    normalizeRole
  });
})();
