(() => {
  "use strict";

  const PORTAL_BASE =
    "https://portal.migenteexpress.com";

  const pages = [
    {
      href:
        PORTAL_BASE +
        "/dashboard.html",

      label: "Dashboard",
      icon: "🏠"
    },
    {
      href:
        PORTAL_BASE +
        "/jobs.html",

      label: "Active Jobs",
      icon: "📦"
    },
    {
      href:
        PORTAL_BASE +
        "/dashboard.html",

      label: "Create Job",
      icon: "➕"
    },
    {
      href:
        PORTAL_BASE +
        "/history.html",

      label: "Job History",
      icon: "📚"
    },
    {
      href:
        PORTAL_BASE +
        "/customer.html",

      label: "Customers",
      icon: "👥"
    },
    {
      href:
        PORTAL_BASE +
        "/driver.html",

      label: "Drivers",
      icon: "🚚"
    },
    {
      href:
        PORTAL_BASE +
        "/payroll.html",

      label: "Payroll",
      icon: "💵"
    },
    {
      href:
        PORTAL_BASE +
        "/invoices.html",

      label: "Invoices",
      icon: "🧾"
    },
    {
      href:
        PORTAL_BASE +
        "/reports.html",

      label: "Reports",
      icon: "📊"
    }
  ];

  const style =
    document.createElement("style");

  style.textContent = `
    body.dispatch-menu-open {
      overflow: hidden !important;
    }

    .dispatch-menu-overlay {
      position: fixed;
      inset: 0;
      z-index: 998;
      background: rgba(10, 20, 16, .58);
      opacity: 0;
      visibility: hidden;
      transition:
        opacity .22s ease,
        visibility .22s ease;
    }

    .dispatch-menu-overlay.open {
      opacity: 1;
      visibility: visible;
    }

    .dispatch-side-menu {
      position: fixed;
      top: 0;
      right: 0;
      z-index: 999;
      width: min(88vw, 440px);
      height: 100dvh;
      display: flex;
      flex-direction: column;
      background: #ffffff;
      color: #17221e;
      box-shadow:
        -15px 0 45px
        rgba(0, 0, 0, .2);
      transform: translateX(105%);
      transition:
        transform .24s ease;
      overflow: hidden;
    }

    .dispatch-side-menu.open {
      transform: translateX(0);
    }

    .dispatch-menu-header {
      position: relative;
      padding:
        28px 82px
        27px 28px;
      background: #064f3b;
      color: #ffffff;
    }

    .dispatch-menu-brand {
      font-size: 29px;
      font-weight: 900;
      line-height: 1.08;
    }

    .dispatch-menu-brand span {
      color: #ff665c;
    }

    .dispatch-menu-subtitle {
      margin-top: 7px;
      font-size: 14px;
      opacity: .82;
      overflow-wrap: anywhere;
    }

    .dispatch-menu-close {
      position: absolute;
      top: 24px;
      right: 24px;
      width: 56px;
      height: 56px;
      border: 0;
      border-radius: 16px;
      background: #ffffff;
      color: #064f3b;
      font-size: 30px;
      font-weight: 900;
      cursor: pointer;
    }

    .dispatch-menu-links {
      flex: 1;
      overflow-y: auto;
      padding: 18px 18px 25px;
      background: #ffffff;
    }
        .dispatch-menu-link {
      display: flex;
      align-items: center;
      gap: 18px;
      min-height: 70px;
      margin-bottom: 5px;
      padding: 14px 18px;
      border-radius: 17px;
      color: #17221e;
      text-decoration: none;
      font-size: 19px;
      font-weight: 900;
      transition: background .2s ease;
    }

    .dispatch-menu-link:hover,
    .dispatch-menu-link:active {
      background: #f2f7f5;
    }

    .dispatch-menu-link.active {
      background: #e7f5ef;
      color: #087455;
    }

    .dispatch-menu-icon {
      width: 34px;
      flex: 0 0 34px;
      text-align: center;
      font-size: 27px;
    }

    .dispatch-menu-footer {
      padding: 18px;
      border-top: 1px solid #dfe8e4;
      background: #ffffff;
    }

    .dispatch-menu-signout {
      width: 100%;
      min-height: 55px;
      border: 0;
      border-radius: 15px;
      background: #fff0f0;
      color: #9b2929;
      font-size: 17px;
      font-weight: 900;
      cursor: pointer;
    }

    .dispatch-menu-button {
      width: 62px;
      height: 62px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 0;
      border-radius: 17px;
      background: #ffffff;
      color: #064f3b;
      font-size: 34px;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,.08);
    }

    .dispatch-menu-floating {
      position: fixed !important;
      top: 15px !important;
      right: 15px !important;
      z-index: 997 !important;
    }
  `;

  document.head.appendChild(style);

  const currentPage =
    window.location.pathname
      .split("/")
      .pop()
      .toLowerCase();

  function fileName(url) {
    return new URL(url).pathname
      .split("/")
      .pop()
      .toLowerCase();
  }

  const overlay =
    document.createElement("div");

  overlay.className =
    "dispatch-menu-overlay";

  const menu =
    document.createElement("aside");

  menu.className =
    "dispatch-side-menu";

  const links =
    pages.map(page => {

      const active =
        fileName(page.href) === currentPage
          ? " active"
          : "";

      return `
        <a
          class="dispatch-menu-link${active}"
          href="${page.href}"
        >
          <span class="dispatch-menu-icon">
            ${page.icon}
          </span>

          <span>
            ${page.label}
          </span>
        </a>
      `;
    }).join("");
    menu.innerHTML = `
    <div class="dispatch-menu-header">

      <button
        class="dispatch-menu-close"
        id="dispatchMenuClose"
        type="button">
        ×
      </button>

      <div class="dispatch-menu-brand">
        MG <span>EXPRESS</span><br>
        COMMAND CENTER
      </div>

      <div
        class="dispatch-menu-subtitle"
        id="dispatchMenuUser">

        MG Express Dispatch

      </div>

    </div>

    <nav class="dispatch-menu-links">

      ${links}

    </nav>

    <div class="dispatch-menu-footer">

      <button
        id="dispatchMenuSignOut"
        class="dispatch-menu-signout">

        Sign Out

      </button>

    </div>
  `;

  const openButton =
    document.createElement("button");

  openButton.className =
    "dispatch-menu-button";

  openButton.innerHTML = "☰";

  function openMenu() {

    overlay.classList.add("open");

    menu.classList.add("open");

    document.body.classList.add(
      "dispatch-menu-open"
    );

  }

  function closeMenu() {

    overlay.classList.remove("open");

    menu.classList.remove("open");

    document.body.classList.remove(
      "dispatch-menu-open"
    );

  }

  document.body.appendChild(
    overlay
  );

  document.body.appendChild(
    menu
  );

  const header =
    document.querySelector(".topbar-inner") ||
    document.querySelector(".topbar");

  if (header) {

    header.style.display = "flex";

    header.style.justifyContent =
      "space-between";

    header.style.alignItems =
      "center";

    header.appendChild(
      openButton
    );

  } else {

    openButton.classList.add(
      "dispatch-menu-floating"
    );

    document.body.appendChild(
      openButton
    );

  }

  openButton.addEventListener(
    "click",
    openMenu
  );

  overlay.addEventListener(
    "click",
    closeMenu
  );

  document
    .getElementById(
      "dispatchMenuClose"
    )
    .addEventListener(
      "click",
      closeMenu
    );
    document
    .getElementById(
      "dispatchMenuSignOut"
    )
    .addEventListener(
      "click",
      async function () {
        this.disabled = true;
        this.textContent =
          "Signing Out...";

        try {
          const client =
            window.mgDispatchClient ||
            window.mgSupabaseClient ||
            window.client;

          if (
            client &&
            client.auth &&
            client.auth.signOut
          ) {
            await client.auth.signOut();
          }
        } catch (error) {
          console.error(
            "MG Express sign-out error:",
            error
          );
        } finally {
          localStorage.clear();
          sessionStorage.clear();

          window.location.replace(
            PORTAL_BASE +
            "/index.html?loggedout=1"
          );
        }
      }
    );

  window.addEventListener(
    "mg-dispatch-ready",
    function (event) {
      const details =
        event.detail || {};

      const userBox =
        document.getElementById(
          "dispatchMenuUser"
        );

      if (!userBox) {
        return;
      }

      userBox.textContent =
        details.name ||
        details.email ||
        "MG Express Dispatch";
    }
  );

  document.addEventListener(
    "keydown",
    function (event) {
      if (event.key === "Escape") {
        closeMenu();
      }
    }
  );

  const existingEmail =
    document
      .getElementById("staffEmail")
      ?.textContent
      ?.trim();

  if (existingEmail) {
    document
      .getElementById(
        "dispatchMenuUser"
      )
      .textContent =
        existingEmail;
  }
})();
