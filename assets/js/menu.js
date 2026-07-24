(function () {
  "use strict";

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
      href: "/history.html",
      label: "Job History",
      icon: "📚"
    },
    {
      href: "/customer.html",
      label: "Customers",
      icon: "👥"
    },
    {
      href: "/driver.html",
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
      icon: "📄"
    },
    {
      href: "/reports.html",
      label: "Reports",
      icon: "📊"
    }
  ];

  function currentPageName() {
    return (
      window.location.pathname
        .split("/")
        .pop() || "dashboard.html"
    );
  }

  function ensureStyles() {
    if (
      document.getElementById(
        "mgSharedMenuStyles"
      )
    ) {
      return;
    }

    const style =
      document.createElement("style");

    style.id =
      "mgSharedMenuStyles";

    style.textContent = `
      body.mg-menu-open {
        overflow: hidden;
      }

      .mg-menu-button {
        display: grid;
        place-items: center;
        width: 62px;
        height: 62px;
        padding: 0;
        border: 0;
        border-radius: 18px;
        background: #ffffff;
        color: #064f3b;
        font-size: 36px;
        font-weight: 900;
        line-height: 1;
        cursor: pointer;
      }

      .mg-menu-overlay {
        position: fixed;
        inset: 0;
        z-index: 5000;
        background: rgba(8, 25, 20, .58);
        opacity: 0;
        visibility: hidden;
        transition:
          opacity .2s ease,
          visibility .2s ease;
      }

      .mg-menu-overlay.open {
        opacity: 1;
        visibility: visible;
      }

      .mg-side-menu {
        position: fixed;
        top: 0;
        right: 0;
        z-index: 5001;
        width: min(365px, 88vw);
        height: 100%;
        padding: 22px 18px;
        background: #ffffff;
        box-shadow:
          -12px 0 30px rgba(0, 0, 0, .17);
        transform: translateX(105%);
        transition: transform .24s ease;
        overflow-y: auto;
      }

      .mg-side-menu.open {
        transform: translateX(0);
      }

      .mg-menu-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 5px 3px 20px;
        border-bottom: 1px solid #dfe8e4;
      }

      .mg-menu-brand {
        color: #064f3b;
        font-size: 22px;
        font-weight: 900;
        line-height: 1.15;
      }

      .mg-menu-brand span {
        color: #ff665c;
      }

      .mg-menu-user {
        margin-top: 7px;
        color: #68756f;
        font-size: 12px;
        overflow-wrap: anywhere;
      }

      .mg-menu-close {
        display: grid;
        place-items: center;
        width: 45px;
        height: 45px;
        flex: 0 0 45px;
        border: 0;
        border-radius: 13px;
        background: #f3f8f6;
        color: #064f3b;
        font-size: 27px;
        cursor: pointer;
      }

      .mg-menu-links {
        display: grid;
        gap: 9px;
        margin-top: 19px;
      }

      .mg-menu-link {
        display: flex;
        align-items: center;
        gap: 13px;
        min-height: 56px;
        padding: 13px 15px;
        border-radius: 14px;
        color: #064f3b;
        text-decoration: none;
        font-weight: 900;
      }

      .mg-menu-link:hover,
      .mg-menu-link.active {
        background: #e7f5ef;
      }

      .mg-menu-icon {
        width: 25px;
        text-align: center;
        font-size: 19px;
      }

      .mg-menu-signout {
        width: 100%;
        min-height: 54px;
        margin-top: 22px;
        border: 1px solid #f0caca;
        border-radius: 14px;
        background: #fff0f0;
        color: #9b2929;
        font-weight: 900;
        cursor: pointer;
      }

      @media (max-width: 430px) {
        .mg-menu-button {
          width: 58px;
          height: 58px;
          border-radius: 16px;
          font-size: 34px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function buildMenuMarkup(userLabel) {
    const currentPage =
      currentPageName();

    return `
      <div
        class="mg-menu-overlay"
        id="mgMenuOverlay"
      ></div>

      <aside
        class="mg-side-menu"
        id="mgSideMenu"
        aria-hidden="true"
      >
        <div class="mg-menu-top">
          <div>
            <div class="mg-menu-brand">
              MG <span>EXPRESS</span><br>
              COMMAND CENTER
            </div>

            <div class="mg-menu-user">
              ${escapeHtml(userLabel)}
            </div>
          </div>

          <button
            class="mg-menu-close"
            id="mgMenuCloseButton"
            type="button"
            aria-label="Close menu"
          >
            ×
          </button>
        </div>

        <nav class="mg-menu-links">
          ${pages
            .map(page => {
              const pageName =
                page.href
                  .split("/")
                  .pop();

              const active =
                pageName === currentPage
                  ? "active"
                  : "";

              return `
                <a
                  class="mg-menu-link ${active}"
                  href="${page.href}"
                >
                  <span class="mg-menu-icon">
                    ${page.icon}
                  </span>

                  <span>
                    ${page.label}
                  </span>
                </a>
              `;
            })
            .join("")}
        </nav>

        <button
          class="mg-menu-signout"
          id="mgMenuSignOutButton"
          type="button"
        >
          Sign Out
        </button>
      </aside>
    `;
  }

  function escapeHtml(value) {
    const div =
      document.createElement("div");

    div.textContent =
      value ?? "";

    return div.innerHTML;
  }

  function openMenu() {
    const menu =
      document.getElementById(
        "mgSideMenu"
      );

    const overlay =
      document.getElementById(
        "mgMenuOverlay"
      );

    if (!menu || !overlay) {
      return;
    }

    menu.classList.add("open");
    overlay.classList.add("open");

    menu.setAttribute(
      "aria-hidden",
      "false"
    );

    document.body.classList.add(
      "mg-menu-open"
    );
  }

  function closeMenu() {
    const menu =
      document.getElementById(
        "mgSideMenu"
      );

    const overlay =
      document.getElementById(
        "mgMenuOverlay"
      );

    if (!menu || !overlay) {
      return;
    }

    menu.classList.remove("open");
    overlay.classList.remove("open");

    menu.setAttribute(
      "aria-hidden",
      "true"
    );

    document.body.classList.remove(
      "mg-menu-open"
    );
  }

  async function initialize(options) {
    const settings = {
      buttonContainerSelector:
        ".topbar-inner",
      userLabel: "",
      requireDispatch: true,
      ...options
    };

    ensureStyles();

    let authData = null;

    if (
      settings.requireDispatch &&
      window.MG_AUTH
    ) {
      authData =
        await window.MG_AUTH
          .requireDispatch();

      if (!authData) {
        return null;
      }
    }

    const userLabel =
      settings.userLabel ||
      authData?.user?.email ||
      authData?.profile?.email ||
      "MG Express Dispatch";

    if (
      !document.getElementById(
        "mgSideMenu"
      )
    ) {
      document.body.insertAdjacentHTML(
        "beforeend",
        buildMenuMarkup(userLabel)
      );
    }

    const container =
      document.querySelector(
        settings.buttonContainerSelector
      );

    if (
      container &&
      !document.getElementById(
        "mgMenuButton"
      )
    ) {
      const button =
        document.createElement("button");

      button.id =
        "mgMenuButton";

      button.className =
        "mg-menu-button";

      button.type =
        "button";

      button.setAttribute(
        "aria-label",
        "Open menu"
      );

      button.textContent =
        "☰";

      container.appendChild(button);
    }

    document
      .getElementById("mgMenuButton")
      ?.addEventListener(
        "click",
        openMenu
      );

    document
      .getElementById(
        "mgMenuCloseButton"
      )
      ?.addEventListener(
        "click",
        closeMenu
      );

    document
      .getElementById("mgMenuOverlay")
      ?.addEventListener(
        "click",
        closeMenu
      );

    document
      .getElementById(
        "mgMenuSignOutButton"
      )
      ?.addEventListener(
        "click",
        async function () {
          this.disabled = true;
          this.textContent =
            "Signing Out...";

          if (window.MG_AUTH) {
            await window.MG_AUTH.signOut();
          }
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

    return {
      authData,
      openMenu,
      closeMenu
    };
  }

  window.MG_MENU = Object.freeze({
    initialize,
    openMenu,
    closeMenu
  });
})();
