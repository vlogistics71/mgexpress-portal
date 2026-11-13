(() => {
  "use strict";

  const PORTAL_BASE = "";

  const KNOWN_ROUTES = new Set([
    "/dashboard.html", "/deliveries.html", "/pending-approval.html", "/ready-to-dispatch.html",
    "/assigned.html", "/closed-today.html", "/customer.html", "/leads.html", "/driver.html",
    "/driver-onboarding.html", "/payroll.html", "/invoices.html", "/Reports.html", "/history.html",
    "/team.html", "/settings.html", "/process-serves.html", "/index.html"
  ]);

  function routeUrl(path) {
    const cleanPath = String(path || "").trim();
    return KNOWN_ROUTES.has(cleanPath) ? PORTAL_BASE + cleanPath : "";
  }

  const pages = [
    { href: routeUrl("/dashboard.html"), label: "Dashboard", icon: "🏠" },
    { href: routeUrl("/deliveries.html"), label: "Deliveries", icon: "📋" },
    { href: routeUrl("/process-serves.html"), label: "Process Serves", icon: "⚖️" },
    { href: routeUrl("/customer.html"), label: "Customers", icon: "👥" },
    { href: routeUrl("/leads.html"), label: "Leads", icon: "🎯" },
    { href: routeUrl("/driver.html"), label: "Drivers", icon: "🚚" },
    { href: routeUrl("/driver-onboarding.html"), label: "Driver Onboarding", icon: "🪪" },
    { href: routeUrl("/payroll.html"), label: "Payroll", icon: "💵" },
    { href: routeUrl("/invoices.html"), label: "Invoices", icon: "🧾" },
    { href: routeUrl("/Reports.html"), label: "Reports", icon: "📊" },
    { href: routeUrl("/history.html"), label: "Job History", icon: "📚" },
    { href: routeUrl("/team.html"), label: "Team Management", icon: "👤" },
    { href: routeUrl("/settings.html"), label: "Settings", icon: "⚙️" }
  ];

  const style = document.createElement("style");
  style.textContent = `
    body.dispatch-menu-open { overflow: hidden !important; }
    .dispatch-menu-overlay { position:fixed; inset:0; z-index:998; background:rgba(10,20,16,.58); opacity:0; visibility:hidden; transition:opacity .22s ease,visibility .22s ease; }
    .dispatch-menu-overlay.open { opacity:1; visibility:visible; }
    .dispatch-side-menu { position:fixed; top:0; right:0; z-index:999; width:min(88vw,440px); height:100dvh; display:flex; flex-direction:column; background:#fff; color:#17221e; box-shadow:-15px 0 45px rgba(0,0,0,.2); transform:translateX(105%); transition:transform .24s ease; overflow:hidden; }
    .dispatch-side-menu.open { transform:translateX(0); }
    .dispatch-menu-header { position:relative; padding:28px 82px 27px 28px; background:#064f3b; color:#fff; }
    .dispatch-menu-brand { font-size:29px; font-weight:900; line-height:1.08; }
    .dispatch-menu-brand span { color:#ff665c; }
    .dispatch-menu-subtitle { margin-top:7px; font-size:14px; opacity:.82; overflow-wrap:anywhere; }
    .dispatch-menu-close { position:absolute; top:24px; right:24px; width:56px; height:56px; border:0; border-radius:16px; background:#fff; color:#064f3b; font-size:30px; font-weight:900; cursor:pointer; }
    .dispatch-menu-links { flex:1; overflow-y:auto; padding:18px 18px 25px; background:#fff; }
    .dispatch-menu-link { display:flex; align-items:center; gap:18px; min-height:70px; margin-bottom:5px; padding:14px 18px; border-radius:17px; color:#17221e; text-decoration:none; font-size:19px; font-weight:900; transition:background .2s ease; }
    .dispatch-menu-link:hover,.dispatch-menu-link:active { background:#f2f7f5; }
    .dispatch-menu-link.active { background:#e7f5ef; color:#087455; }
    .dispatch-menu-icon { width:34px; flex:0 0 34px; text-align:center; font-size:27px; }
    .dispatch-menu-footer { padding:18px; border-top:1px solid #dfe8e4; background:#fff; }
    .dispatch-menu-signout { width:100%; min-height:55px; border:0; border-radius:15px; background:#fff0f0; color:#9b2929; font-size:17px; font-weight:900; cursor:pointer; }
    .dispatch-menu-button { width:62px; height:62px; display:inline-flex; align-items:center; justify-content:center; border:0; border-radius:17px; background:#fff; color:#064f3b; font-size:34px; cursor:pointer; box-shadow:0 4px 16px rgba(0,0,0,.08); }
    .dispatch-menu-floating { position:fixed !important; top:15px !important; right:15px !important; z-index:997 !important; }

    /* Compact, one-screen mobile command menu; desktop navigation stays unchanged. */
    @media (max-width: 720px) {
      .dispatch-side-menu {
        width: min(92vw, 390px);
        max-width: 100vw;
        height: 100dvh;
        border-radius: 18px 0 0 18px;
      }
      .dispatch-menu-header {
        flex: 0 0 auto;
        min-height: 75px;
        padding: 17px 61px 14px 16px;
      }
      .dispatch-menu-brand {
        font-size: 20px;
        line-height: 1.1;
        white-space: nowrap;
        letter-spacing: -.02em;
      }
      .dispatch-menu-desktop-title { display: none; }
      .dispatch-menu-subtitle {
        font-size: 11px;
        line-height: 1.25;
        margin-top: 6px;
        max-height: 2.5em;
        overflow: hidden;
        overflow-wrap: anywhere;
      }
      .dispatch-menu-close {
        top: 15px;
        right: 14px;
        width: 45px;
        height: 45px;
        border-radius: 12px;
        font-size: 26px;
      }
      .dispatch-menu-links {
        flex: 1 1 auto;
        min-height: 0;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        grid-auto-rows: minmax(56px, auto);
        align-content: start;
        gap: 7px;
        padding: 11px 12px;
        overflow-y: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        background: #f6f9f7;
      }
      .dispatch-menu-link {
        min-width: 0;
        min-height: 56px;
        margin: 0;
        padding: 8px 9px;
        display: flex;
        gap: 7px;
        align-items: center;
        justify-content: flex-start;
        border: 1px solid #e0eae5;
        border-radius: 12px;
        background: white;
        color: #223b30;
        font-size: 13px;
        line-height: 1.17;
        font-weight: 800;
        overflow-wrap: anywhere;
        box-shadow: 0 2px 8px rgba(6, 79, 59, .025);
      }
      .dispatch-menu-link.active {
        border-color: #c9e7d9;
        background: #e7f5ef;
        color: #087455;
      }
      .dispatch-menu-icon {
        width: 24px;
        flex: 0 0 24px;
        text-align: center;
        font-size: 21px;
        line-height: 1.15;
      }
      .dispatch-menu-footer {
        flex: 0 0 auto;
        padding: 10px 12px max(11px, env(safe-area-inset-bottom));
      }
      .dispatch-menu-signout {
        min-height: 46px;
        border-radius: 12px;
        font-size: 14px;
      }
    }
    @media (max-width: 360px) {
      .dispatch-menu-links { gap: 6px; padding: 9px; }
      .dispatch-menu-link { font-size: 12px; padding: 7px; gap: 5px; }
      .dispatch-menu-icon { width: 21px; flex-basis: 21px; font-size: 19px; }
      .dispatch-menu-brand { font-size: 18px; }
    }
    @media (max-width: 720px) and (max-height: 600px) {
      /* On very short/landscape displays, allow only the menu tiles to scroll. */
      .dispatch-menu-header { min-height: 60px; padding-top: 10px; padding-bottom: 9px; }
      .dispatch-menu-close { top: 9px; width: 42px; height: 42px; }
      .dispatch-menu-links { grid-auto-rows: minmax(49px, auto); gap: 5px; }
      .dispatch-menu-link { min-height: 49px; padding: 6px 8px; }
      .dispatch-menu-footer { padding-top: 7px; padding-bottom: max(7px, env(safe-area-inset-bottom)); }
      .dispatch-menu-signout { min-height: 42px; }
    }
  `;
  document.head.appendChild(style);

  const currentPage = window.location.pathname.split("/").pop().toLowerCase();
  function fileName(url) { return new URL(url, window.location.origin).pathname.split("/").pop().toLowerCase(); }

  const overlay = document.createElement("div");
  overlay.className = "dispatch-menu-overlay";
  const menu = document.createElement("aside");
  menu.className = "dispatch-side-menu";

  const links = pages.map(page => {
    const active = fileName(page.href) === currentPage ? " active" : "";
    return `<a class="dispatch-menu-link${active}" href="${page.href}"><span class="dispatch-menu-icon">${page.icon}</span><span>${page.label}</span></a>`;
  }).join("");

  menu.innerHTML = `<div class="dispatch-menu-header"><button class="dispatch-menu-close" id="dispatchMenuClose" type="button">×</button><div class="dispatch-menu-brand">MG <span>EXPRESS</span><span class="dispatch-menu-desktop-title"><br>COMMAND CENTER</span></div><div class="dispatch-menu-subtitle" id="dispatchMenuUser">MG Express Dispatch</div></div><nav class="dispatch-menu-links">${links}</nav><div class="dispatch-menu-footer"><button id="dispatchMenuSignOut" class="dispatch-menu-signout">Sign Out</button></div>`;

  const openButton = document.createElement("button");
  openButton.className = "dispatch-menu-button";
  openButton.innerHTML = "☰";

  function openMenu(){ overlay.classList.add("open"); menu.classList.add("open"); document.body.classList.add("dispatch-menu-open"); }
  function closeMenu(){ overlay.classList.remove("open"); menu.classList.remove("open"); document.body.classList.remove("dispatch-menu-open"); }

  document.body.appendChild(overlay); document.body.appendChild(menu);
  const header = document.querySelector(".topbar-inner") || document.querySelector(".topbar");
  if (header) { header.style.display="flex"; header.style.justifyContent="space-between"; header.style.alignItems="center"; header.appendChild(openButton); }
  else { openButton.classList.add("dispatch-menu-floating"); document.body.appendChild(openButton); }

  openButton.addEventListener("click", openMenu); overlay.addEventListener("click", closeMenu);
  document.getElementById("dispatchMenuClose").addEventListener("click", closeMenu);
  document.getElementById("dispatchMenuSignOut").addEventListener("click", async function(){
    this.disabled=true; this.textContent="Signing Out...";
    try { const client=window.mgDispatchClient||window.mgSupabaseClient||window.mgSupabase||window.client; if(client?.auth?.signOut) await client.auth.signOut({ scope: "local" }); }
    catch(error){ console.error("MG Express sign-out error:",error); }
    finally { localStorage.clear(); sessionStorage.clear(); window.location.replace(routeUrl("/index.html")+"?loggedout=1"); }
  });
  window.addEventListener("mg-dispatch-ready", event => { const d=event.detail||{}; const box=document.getElementById("dispatchMenuUser"); if(box) box.textContent=d.name||d.email||"MG Express Dispatch"; });
  document.addEventListener("keydown", event => { if(event.key==="Escape") closeMenu(); });
  const existingEmail=document.getElementById("staffEmail")?.textContent?.trim(); if(existingEmail) document.getElementById("dispatchMenuUser").textContent=existingEmail;
})();
