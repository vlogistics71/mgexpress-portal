(function () {
  const styles = document.createElement("style");

  styles.textContent = `
    .dispatch-menu-button {
      width: 50px;
      height: 50px;
      border: 0;
      border-radius: 14px;
      background: #ffffff;
      color: #064f3b;
      font-size: 28px;
      font-weight: 900;
      cursor: pointer;
      display: grid;
      place-items: center;
      flex-shrink: 0;
    }

    .dispatch-menu-overlay {
      position: fixed;
      inset: 0;
      z-index: 998;
      background: rgba(0, 0, 0, .46);
      opacity: 0;
      visibility: hidden;
      transition: opacity .2s ease;
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
      width: min(340px, 90vw);
      height: 100vh;
      background: #ffffff;
      color: #17221e;
      transform: translateX(100%);
      transition: transform .25s ease;
      box-shadow: -12px 0 35px rgba(0, 0, 0, .2);
      display: flex;
      flex-direction: column;
    }

    .dispatch-side-menu.open {
      transform: translateX(0);
    }

    .dispatch-menu-header {
      position: relative;
      background: #064f3b;
      color: #ffffff;
      padding: 27px 22px;
    }

    .dispatch-menu-brand {
      font-size: 23px;
      font-weight: 900;
      line-height: 1.08;
    }

    .dispatch-menu-brand span {
      color: #ff665c;
    }

    .dispatch-menu-user {
      margin-top: 8px;
      font-size: 13px;
      opacity: .84;
      overflow-wrap: anywhere;
    }

    .dispatch-menu-close {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 44px;
      height: 44px;
      border: 0;
      border-radius: 12px;
      background: #ffffff;
      color: #064f3b;
      font-size: 24px;
      font-weight: 900;
      cursor: pointer;
    }

    .dispatch-menu-links {
      padding: 18px 14px;
      display: grid;
      gap: 7px;
      overflow-y: auto;
    }

    .dispatch-menu-link {
      display: flex;
      align-items: center;
      gap: 13px;
      min-height: 56px;
      padding: 13px 15px;
      border-radius: 13px;
      color: #17221e;
      text-decoration: none;
      font-size: 16px;
      font-weight: 800;
    }

    .dispatch-menu-link:hover,
    .dispatch-menu-link.active {
      background: #e7f5ef;
      color: #087455;
    }

    .dispatch-menu-icon {
      width: 30px;
      text-align: center;
      font-size: 21px;
    }

    .dispatch-menu-footer {
      margin-top: auto;
      padding: 15px;
      border-top: 1px solid #dfe8e4;
    }

    .dispatch-menu-signout {
      width: 100%;
      min-height: 54px;
      border: 0;
      border-radius: 13px;
      background: #fff0f0;
      color: #9b2929;
      font-size: 16px;
      font-weight: 900;
      cursor: pointer;
    }

    body.dispatch-menu-open {
      overflow: hidden;
    }
  `;

  document.head.appendChild(styles);

  const currentPage =
    window.location.pathname.split("/").pop() || "dashboard.html";

  const pages = [
    {
      href: "/dashboard.html",
      label: "Dashboard",
      icon: "🏠"
    },
    {
      href: "/jobs.html",
      label: "Active Jobs",
      icon: "📦"
    },
    {
      href: "/create-job.html",
      label: "Create Job",
      icon: "➕"
    },
    {
      href: "/history.html",
      label: "Job History",
      icon: "📚"
    },
    {
    {
      label: "Customers",
      icon: "👥",
      href: "https://portal.migenteexpress.com/customer.html"
    }
    {
      href: "/drivers.html",
      label: "Drivers",
      icon: "🚚"
    },
    {
      href: "/payroll.html",
      label: "Payroll",
      icon: "💵"
    },
    {
      href: "/invoices.html",
      label: "Invoices",
      icon: "🧾"
    },
    {
      href: "/reports.html",
      label: "Reports",
      icon: "📊"
    }
  ];

  const overlay = document.createElement("div");
  overlay.className = "dispatch-menu-overlay";

  const menu = document.createElement("aside");
  menu.className = "dispatch-side-menu";

  menu.innerHTML = `
    <div class="dispatch-menu-header">
      <button
        class="dispatch-menu-close"
        id="dispatchMenuClose"
        type="button"
        aria-label="Close menu"
      >
        ×
      </button>

      <div class="dispatch-menu-brand">
        MG <span>EXPRESS</span><br>
        COMMAND CENTER
      </div>

      <div
        class="dispatch-menu-user"
        id="dispatchMenuUser"
      ></div>
    </div>

    <nav class="dispatch-menu-links">
      ${pages.map(page => {
        const pageName =
          page.href.split("/").pop();

        const active =
          pageName === currentPage
            ? "active"
            : "";

        return `
          <a
            class="dispatch-menu-link ${active}"
            href="${page.href}"
          >
            <span class="dispatch-menu-icon">
              ${page.icon}
            </span>

            <span>${page.label}</span>
          </a>
        `;
      }).join("")}
    </nav>

    <div class="dispatch-menu-footer">
      <button
        class="dispatch-menu-signout"
        id="dispatchMenuSignOut"
        type="button"
      >
        Sign Out
      </button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(menu);

  const openButton =
    document.createElement("button");

  openButton.className =
    "dispatch-menu-button";

  openButton.type = "button";
  openButton.setAttribute(
    "aria-label",
    "Open menu"
  );

  openButton.textContent = "☰";

  const header =
    document.querySelector(".topbar-inner") ||
    document.querySelector(".topbar") ||
    document.querySelector("header");

  if (header) {
    const oldSignOut =
      header.querySelector("#signOutButton") ||
      header.querySelector(".signout");

    if (oldSignOut) {
      oldSignOut.style.display = "none";
    }

    header.appendChild(openButton);
  } else {
    openButton.style.position = "fixed";
    openButton.style.top = "15px";
    openButton.style.right = "15px";
    openButton.style.zIndex = "997";

    document.body.appendChild(openButton);
  }

  function openMenu() {
    menu.classList.add("open");
    overlay.classList.add("open");
    document.body.classList.add(
      "dispatch-menu-open"
    );
  }

  function closeMenu() {
    menu.classList.remove("open");
    overlay.classList.remove("open");
    document.body.classList.remove(
      "dispatch-menu-open"
    );
  }

  openButton.addEventListener(
    "click",
    openMenu
  );

  document
    .getElementById("dispatchMenuClose")
    .addEventListener(
      "click",
      closeMenu
    );

  overlay.addEventListener(
    "click",
    closeMenu
  );

  document
    .getElementById("dispatchMenuSignOut")
    .addEventListener(
      "click",
      async function () {
        this.disabled = true;
        this.textContent = "Signing Out…";

        try {
          if (window.mgDispatchClient) {
            await window.mgDispatchClient
              .auth
              .signOut();
          } else if (window.client) {
            await window.client
              .auth
              .signOut();
          }
        } finally {
          localStorage.clear();
          sessionStorage.clear();

          window.location.replace(
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

      document
        .getElementById("dispatchMenuUser")
        .textContent =
          details.name ||
          details.email ||
          "MG Express Dispatch";
    }
  );
})();
