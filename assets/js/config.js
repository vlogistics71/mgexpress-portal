(function () {
  "use strict";
  window.MG_GEOAPIFY_API_KEY = "34d895e9c6cd4d1faf0692f758aac8ac";
  const SUPABASE_URL = "https://dczlucwfjayymlwbzzdi.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kcv_a78ZyUxMo2neKUANdw_XN7eAMpI";
  if (!window.supabase) { console.error("Supabase library is missing. Load @supabase/supabase-js before config.js."); return; }
  if (!window.mgSupabase) {
    const baseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    const isCustomerPortal = /(^|\/)customer-portal\.html$/.test(window.location.pathname);
    if (isCustomerPortal) {
      window.mgSupabase = new Proxy(baseClient, { get(target, property, receiver) {
        if (property !== "from") return Reflect.get(target, property, receiver);
        return function secureFrom(table) {
          const builder = target.from(table); if (table !== "quotes") return builder;
          return new Proxy(builder, { get(builderTarget, builderProperty, builderReceiver) {
            if (builderProperty !== "insert") return Reflect.get(builderTarget, builderProperty, builderReceiver);
            return async function secureCustomerQuoteInsert(payload) {
              const row = Array.isArray(payload) ? payload[0] || {} : payload || {};
              return target.rpc("submit_customer_quote_request", {
                p_pickup_address: String(row.pickup_address || "").trim(),
                p_delivery_address: String(row.delivery_address || "").trim(),
                p_scheduled_date: row.scheduled_date || null,
                p_vehicle_type: String(row.vehicle_type || "").trim(),
                p_delivery_speed: String(row.delivery_speed || "").trim(),
                p_package_type: String(row.package_type || "").trim(),
                p_customer_instructions: String(row.special_instructions || "").trim() || null
              });
            };
          }});
        };
      }});
    } else window.mgSupabase = baseClient;
  }
  window.MG_CONFIG = Object.freeze({portalName:"MG Express Portal",companyName:"MG Express",portalBaseUrl:"https://portal.migenteexpress.com",supabaseUrl:SUPABASE_URL,geoapifyApiKey:String(window.MG_GEOAPIFY_API_KEY||"").trim()});
  function load(src){const s=document.createElement("script");s.src=src;s.defer=true;document.head.appendChild(s)}
  if (/(^|\/)request\.html$/.test(window.location.pathname)) load("assets/js/customer-autofill.js");
  if (/(^|\/)customer\.html$/.test(window.location.pathname)) load("assets/js/customer-directory-panel.js");
  console.log("[MG Config] Geoapify configured:", Boolean(window.MG_CONFIG?.geoapifyApiKey));
})();