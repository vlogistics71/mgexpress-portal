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
    .dispatch-menu-brand > span:not(.dispatch-menu-desktop-title) { color:#ff665c; }
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
  // Apply the shared, phone-only operations layout to the remaining workspaces.
  // Dashboard and Deliveries already have their own compact designs.
  const compactWorkspacePages = new Set([
    "process-serves", "customer", "driver", "driver-onboarding",
    "payroll", "invoices", "reports", "history", "team", "settings",
    "assigned", "pending-approval", "ready-to-dispatch", "closed-today",
    "driver-applications", "customer-details", "customer-record", "jobs"
  ]);
  const compactPage = window.location.pathname.split("/").pop().replace(/\.html$/i, "").toLowerCase();
  if (compactWorkspacePages.has(compactPage)) {
    document.body.classList.add("mg-compact-screen", "mg-compact-" + compactPage);
    const sharedStylesheet = document.createElement("link");
    sharedStylesheet.rel = "stylesheet";
    sharedStylesheet.href = "/assets/css/dispatch-compact-workspaces.css?v=20261125-compact-secondary-v1";
    document.head.appendChild(sharedStylesheet);
    if (compactPage === "team") {
      const invitePanel = document.querySelector("main#app > section.panel");
      const inviteHeader = invitePanel?.querySelector("h2");
      if (invitePanel && inviteHeader) {
        const toggleInvite = document.createElement("button");
        toggleInvite.type = "button";
        toggleInvite.className = "mg-team-toggle";
        toggleInvite.textContent = "Add";
        toggleInvite.setAttribute("aria-label", "Expand Add Team Member");
        toggleInvite.setAttribute("aria-expanded", "false");
        inviteHeader.appendChild(toggleInvite);
        toggleInvite.addEventListener("click", () => {
          const expanded = invitePanel.classList.toggle("mg-team-invite-open");
          toggleInvite.textContent = expanded ? "Close" : "Add";
          toggleInvite.setAttribute("aria-expanded", String(expanded));
          toggleInvite.setAttribute("aria-label", expanded ? "Collapse Add Team Member" : "Expand Add Team Member");
          if (expanded) invitePanel.querySelector("#fullName")?.focus({preventScroll:true});
        });
      }
    }
  }

  // Neon visual theme applies only to the internal dispatch workspace pages.
  // It changes presentation only; page structure and dispatch behavior stay untouched.
  const dispatchThemePage = window.location.pathname.split("/").pop().toLowerCase();
  if (dispatchThemePage !== "index.html") {
    document.body.classList.add("mg-dispatch-neon");
    const neonTheme = document.createElement("style");
    neonTheme.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Titan+One&display=swap');
      body.mg-dispatch-neon {
        --dark-green:#190625; --green:#ff279a; --light-green:#401145; --coral:#ff783f;
        --background:#17051f; --ink:#fff8ff; --muted:#f0d9ef; --line:rgba(242,84,204,.5);
        --blue:#bd56f2; --blue-bg:#351052; --danger-bg:#42112c;
        background:var(--background);
      }
      body.mg-dispatch-neon > .topbar {
        background:
          linear-gradient(90deg,rgba(20,4,33,.72),rgba(42,6,48,.3)),
          url("/assets/images/vice-city-sunset.svg") center 52% / cover no-repeat !important;
        border-bottom:3px solid #ff35a5;
        box-shadow:0 5px 24px rgba(255,39,154,.2);
      }
      /* The deliveries page uses one shared sunset banner behind the brand row.
         Keep the navigation content, but don't paint a second banner inside its header. */
      body.mg-dispatch-neon.mg-deliveries-page > .topbar {
        background:transparent !important;
        background-image:none !important;
        border:0 !important;
        border-image:none !important;
        box-shadow:none !important;
      }
      body.mg-dispatch-neon .brand,
      body.mg-dispatch-neon .dispatch-menu-brand {
        font-family:'Titan One','Arial Rounded MT Bold',Arial,sans-serif;
        letter-spacing:.015em;
        background:linear-gradient(100deg,#ff9b43 0%,#ff3b9f 52%,#a54cf0 100%);
        -webkit-background-clip:text; background-clip:text;
        color:transparent !important; -webkit-text-fill-color:transparent;
        text-shadow:0 0 13px rgba(255,55,166,.35);
      }
      body.mg-dispatch-neon .brand span,
      body.mg-dispatch-neon .dispatch-menu-brand > span:not(.dispatch-menu-desktop-title) {
        color:transparent !important; -webkit-text-fill-color:transparent;
      }
      body.mg-dispatch-neon .brand-subtitle,
      body.mg-dispatch-neon .staff-email {color:#f2eaff}
      body.mg-dispatch-neon .welcome-greeting,
      body.mg-dispatch-neon h2,
      body.mg-dispatch-neon h3 {color:#512276}
      body.mg-dispatch-neon .primary-button,
      body.mg-dispatch-neon .primary-cta,
      body.mg-dispatch-neon .create-job-button,
      body.mg-dispatch-neon .action-btn:not(.secondary),
      body.mg-dispatch-neon .btn.primary,
      body.mg-dispatch-neon .button.primary,
      body.mg-dispatch-neon .pricing-button,
      body.mg-dispatch-neon .primary-btn {
        background:linear-gradient(105deg,#ff963f 0%,#ff2998 54%,#9239e8 100%) !important;
        border-color:transparent !important; color:#fff !important;
        box-shadow:0 5px 16px rgba(255,39,154,.25);
      }
      body.mg-dispatch-neon .secondary-button,
      body.mg-dispatch-neon .action-btn.secondary,
      body.mg-dispatch-neon .back-link {
        color:#fff8ff; border-color:#ba56d8;
      }
      body.mg-dispatch-neon input:focus,
      body.mg-dispatch-neon select:focus,
      body.mg-dispatch-neon textarea:focus {
        outline:2px solid #ff963f; outline-offset:1px; border-color:#ff2998;
        box-shadow:0 0 0 3px rgba(255,41,152,.18);
      }
      body.mg-dispatch-neon .dispatch-side-menu {border-left:1px solid #9c38b6;background:#190625;color:#fff8ff}
      body.mg-dispatch-neon .dispatch-menu-header {
        background:
          linear-gradient(90deg,rgba(20,4,33,.56),rgba(44,7,51,.4)),
          url("/assets/images/vice-city-dashboard-banner.png") center 48% / cover no-repeat !important;
        border-bottom:3px solid #ff35a5;
      }
      body.mg-dispatch-neon .dispatch-menu-close,
      body.mg-dispatch-neon .dispatch-menu-button {color:#21103a;border-color:#ff79bd}
      body.mg-dispatch-neon .dispatch-menu-links,
      body.mg-dispatch-neon .dispatch-menu-footer {background:#190625 !important;border-color:rgba(239,74,205,.42) !important}
      body.mg-dispatch-neon .dispatch-menu-link {
        background:linear-gradient(145deg,#321044,#230a37) !important;
        border:1px solid rgba(200,89,219,.55) !important;color:#fff8ff !important;
      }
      body.mg-dispatch-neon .dispatch-menu-link:nth-child(4n + 2) {border-color:#ff963f !important}
      body.mg-dispatch-neon .dispatch-menu-link:nth-child(4n + 3) {border-color:#b653ef !important}
      body.mg-dispatch-neon .dispatch-menu-link:nth-child(4n + 4) {border-color:#ff6477 !important}
      body.mg-dispatch-neon .dispatch-side-menu .dispatch-menu-links a.dispatch-menu-link.active,
      body.mg-dispatch-neon .dispatch-side-menu .dispatch-menu-links a.dispatch-menu-link.active:visited {
        background:linear-gradient(145deg,#321044,#230a37) !important;
        border-color:rgba(200,89,219,.55) !important;
        color:#fff8ff !important;
        -webkit-text-fill-color:#fff8ff !important;
        box-shadow:0 8px 20px rgba(8,0,23,.24) !important;
      }
      body.mg-dispatch-neon .dispatch-menu-link:hover,
      body.mg-dispatch-neon .dispatch-menu-link:active {filter:brightness(1.15)}
      body.mg-dispatch-neon .dispatch-menu-signout {
        background:linear-gradient(145deg,#321044,#230a37) !important;
        color:#fff8ff !important;
        -webkit-text-fill-color:#fff8ff !important;
        border:1px solid rgba(200,89,219,.55) !important;
        box-shadow:0 8px 20px rgba(8,0,23,.24) !important;
      }
    `;
    /* Pages after Deliveries use a compact floating menu button instead of the repeated brand banner.
       Dashboard and Deliveries keep their own full-width header layouts. */
    body.mg-dispatch-neon.mg-secondary-page > .topbar {
      position:static !important; height:0 !important; min-height:0 !important;
      padding:0 !important; margin:0 !important; overflow:visible !important;
      border:0 !important; background:transparent !important; box-shadow:none !important;
    }
    body.mg-dispatch-neon.mg-secondary-page > .topbar .topbar-inner {
      position:fixed !important; top:10px !important; right:12px !important; left:auto !important;
      z-index:1000 !important; width:auto !important; min-height:0 !important;
      margin:0 !important; padding:0 !important; gap:0 !important;
    }
    body.mg-dispatch-neon.mg-secondary-page > .topbar .topbar-inner > :not(.dispatch-menu-button) {
      display:none !important;
    }
    body.mg-dispatch-neon.mg-secondary-page .dispatch-menu-button {
      width:48px !important; height:48px !important; border-radius:14px !important;
      background:rgba(36,8,56,.72) !important; color:#fff8ff !important;
      border:1px solid rgba(255,88,188,.78) !important; box-shadow:0 6px 18px rgba(9,1,19,.25) !important;
      backdrop-filter:blur(8px);
    }
    body.mg-dispatch-neon.mg-secondary-page > main.container,
    body.mg-dispatch-neon.mg-secondary-page > main.wrap {
      padding-top:68px !important;
    }
    body.mg-dispatch-neon.mg-secondary-page button:not(.dispatch-menu-button):not(.dispatch-menu-close):not(.dispatch-menu-signout),
    body.mg-dispatch-neon.mg-secondary-page input[type="button"],
    body.mg-dispatch-neon.mg-secondary-page input[type="submit"],
    body.mg-dispatch-neon.mg-secondary-page a.primary-button,
    body.mg-dispatch-neon.mg-secondary-page a.primary-cta,
    body.mg-dispatch-neon.mg-secondary-page .primary-button,
    body.mg-dispatch-neon.mg-secondary-page .primary-cta {
      color:#fff8ff !important; -webkit-text-fill-color:#fff8ff !important;
      background:linear-gradient(145deg,rgba(255,55,163,.22),rgba(132,54,195,.25)) !important;
      border:1px solid rgba(241,116,219,.78) !important;
      box-shadow:inset 0 1px rgba(255,255,255,.06),0 4px 14px rgba(7,1,18,.18) !important;
      backdrop-filter:blur(6px);
    }
    body.mg-dispatch-neon.mg-secondary-page button:hover,
    body.mg-dispatch-neon.mg-secondary-page a.primary-button:hover,
    body.mg-dispatch-neon.mg-secondary-page a.primary-cta:hover {
      background:linear-gradient(145deg,rgba(255,55,163,.34),rgba(132,54,195,.36)) !important;
      filter:none !important;
    }
    body.mg-dispatch-neon.mg-secondary-page .customer-summary,
    body.mg-dispatch-neon.mg-secondary-page .customer-details,
    body.mg-dispatch-neon.mg-secondary-page .customer-card,
    body.mg-dispatch-neon.mg-secondary-page .stat-card,
    body.mg-dispatch-neon.mg-secondary-page .summary-card,
    body.mg-dispatch-neon.mg-secondary-page .driver-card,
    body.mg-dispatch-neon.mg-secondary-page .card {
      background:linear-gradient(145deg,rgba(55,12,78,.72),rgba(25,6,43,.76)) !important;
      color:#fff8ff !important; border-color:rgba(255,85,190,.65) !important;
    }
    body.mg-dispatch-neon.mg-secondary-page .customer-meta-label,
    body.mg-dispatch-neon.mg-secondary-page .customer-meta-value,
    body.mg-dispatch-neon.mg-secondary-page .customer-name,
    body.mg-dispatch-neon.mg-secondary-page .customer-company,
    body.mg-dispatch-neon.mg-secondary-page .meta,
    body.mg-dispatch-neon.mg-secondary-page .value {
      color:#fff8ff !important;
    }
    @media (max-width:720px) {
      body.mg-dispatch-neon.mg-secondary-page > .topbar .topbar-inner {top:8px !important;right:9px !important}
      body.mg-dispatch-neon.mg-secondary-page > main.container,
      body.mg-dispatch-neon.mg-secondary-page > main.wrap {padding-top:62px !important}
    }
    document.head.appendChild(neonTheme);
  }

  const currentPage = window.location.pathname.split("/").pop().toLowerCase();
  if (!["dashboard.html", "deliveries.html", "index.html"].includes(currentPage)) {
    document.body.classList.add("mg-secondary-page");
  }
  function fileName(url) { return new URL(url, window.location.origin).pathname.split("/").pop().toLowerCase(); }

  const overlay = document.createElement("div");
  overlay.className = "dispatch-menu-overlay";
  const menu = document.createElement("aside");
  menu.className = "dispatch-side-menu";

  const links = pages.map(page => {
    const active = fileName(page.href) === currentPage ? " active" : "";
    return `<a class="dispatch-menu-link${active}" href="${page.href}"><span class="dispatch-menu-icon">${page.icon}</span><span>${page.label}</span></a>`;
  }).join("");

  menu.innerHTML = `<div class="dispatch-menu-header"><button class="dispatch-menu-close" id="dispatchMenuClose" type="button">×</button><div class="dispatch-menu-brand">COMMAND CENTER</div><div class="dispatch-menu-subtitle" id="dispatchMenuUser">MG Express Dispatch</div></div><nav class="dispatch-menu-links">${links}</nav><div class="dispatch-menu-footer"><button id="dispatchMenuSignOut" class="dispatch-menu-signout">Sign Out</button></div>`;

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
  // Compact pages scroll inside panels; restore Android swipe-to-refresh.
  if (!document.querySelector('script[data-mg-pull-refresh]')) {
    const refreshScript = document.createElement("script");
    refreshScript.src = "/assets/js/mobile-pull-refresh.js?v=20261113-pull-v1";
    refreshScript.dataset.mgPullRefresh = "true";
    document.body.appendChild(refreshScript);
  }
})();
