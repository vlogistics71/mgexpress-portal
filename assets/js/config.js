(function () {
  "use strict";

  const SUPABASE_URL =
    "https://dczlucwfjayymlwbzzdi.supabase.co";

  const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_kcv_a78ZyUxMo2neKUANdw_XN7eAMpI";

  if (!window.supabase) {
    console.error(
      "Supabase library is missing. Load @supabase/supabase-js before config.js."
    );

    return;
  }

  if (!window.mgSupabase) {
    window.mgSupabase =
      window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY
      );
  }

  window.MG_CONFIG = Object.freeze({
    portalName: "MG Express Portal",
    companyName: "MG Express",
    portalBaseUrl:
      "https://portal.migenteexpress.com",
    supabaseUrl: SUPABASE_URL
  });
})();
