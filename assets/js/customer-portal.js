(function () {
  "use strict";

  const client = window.mgSupabase;

  if (!client || !window.MG_AUTH) {
    console.error(
      "MG Express configuration or authentication module is missing."
    );
    return;
  }

  const portalMessage =
    document.getElementById("portalMessage");

  const requestMessage =
    document.getElementById("requestMessage");

  const sideMenu =
    document.getElementById("portalSideMenu");

  const menuOverlay =
    document.getElementById("portalMenuOverlay");

  const deliveryRequestForm =
    document.getElementById("deliveryRequestForm");

  let authData = null;
  let customerAccount = null;
  let jobs = [];
  let invoices = [];
  let locations = [];

  function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = value ?? "";
    return element.innerHTML;
  }

  function normalize(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replaceAll(" ", "_")
      .replaceAll("-", "_");
  }

  function money(value) {
    return Number(value || 0).toLocaleString(
      "en-US",
      {
        style: "currency",
        currency: "USD"
      }
    );
  }

  function localDateString(date) {
    const year = date.getFullYear();

    const month =
      String(date.getMonth() + 1)
        .padStart(2, "0");

    const day =
      String(date.getDate())
        .padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function formatDate(value) {
    if (!value) {
      return "Not scheduled";
    }

    const raw =
      String(value).slice(0, 10);

    const date =
      new Date(`${raw}T12:00:00`);

    if (Number.isNaN(date.getTime())) {
      return escapeHtml(value);
    }

    return date.toLocaleDateString(
      "en-US",
      {
        month: "short",
        day: "numeric",
        year: "numeric"
      }
    );
  }

  function formatTime(value) {
    if (!value) {
      return "Time pending";
    }

    const text =
      String(value).slice(0, 5);

    const parts =
      text.split(":");

    if (parts.length !== 2) {
      return escapeHtml(value);
    }

    const date = new Date();

    date.setHours(
      Number(parts[0]),
      Number(parts[1]),
      0,
      0
    );

    return date.toLocaleTimeString(
      "en-US",
      {
        hour: "numeric",
        minute: "2-digit"
      }
    );
  }

  function setPortalMessage(
    message,
    type
  ) {
    portalMessage.textContent =
      message || "";

    portalMessage.className =
      message
        ? `portal-message ${type || ""}`
        : "portal-message hidden";
  }

  function setRequestMessage(
    message,
    type
  ) {
    requestMessage.textContent =
      message || "";

    requestMessage.className =
      message
        ? `portal-message ${type || ""}`
        : "portal-message hidden";
  }

  function openMenu() {
    sideMenu.classList.add("open");
    menuOverlay.classList.add("open");

    document.body.classList.add(
      "portal-menu-open"
    );
  }

  function closeMenu() {
    sideMenu.classList.remove("open");
    menuOverlay.classList.remove("open");

    document.body.classList.remove(
      "portal-menu-open"
    );
  }

  function showView(viewName) {
    document
      .querySelectorAll("[data-portal-view]")
      .forEach(view => {
        view.classList.toggle(
          "active",
          view.dataset.portalView === viewName
        );
      });

    document
      .querySelectorAll("[data-view]")
      .forEach(button => {
        button.classList.toggle(
          "active",
          button.dataset.view === viewName
        );
      });

    closeMenu();

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  function jobStatus(job) {
    return normalize(job.status);
  }

  function isQuote(job) {
    return [
      "quote_pending",
      "pending_quote",
      "quoted",
      "quote"
    ].includes(jobStatus(job));
  }

  function isCompleted(job) {
    return [
      "delivered",
      "completed"
    ].includes(jobStatus(job));
  }

  function isCancelled(job) {
    return [
      "cancelled",
      "canceled",
      "rejected"
    ].includes(jobStatus(job));
  }

  function isActive(job) {
    return (
      !isQuote(job) &&
      !isCompleted(job) &&
      !isCancelled(job)
    );
  }

  function isPaid(invoice) {
    return (
      normalize(
        invoice.payment_status ||
        invoice.status
      ) === "paid"
    );
  }

  function isOverdue(invoice) {
    if (
      isPaid(invoice) ||
      !invoice.due_date
    ) {
      return false;
    }

    return (
      String(invoice.due_date).slice(0, 10) <
      localDateString(new Date())
    );
  }

  function friendlyJobStatus(job) {
    const status =
      jobStatus(job);

    const labels = {
      quote_pending:
        "Quote Requested",

      pending_quote:
        "Quote Requested",

      quoted:
        "Quote Ready",

      approved:
        "Approved",

      waiting_payment:
        "Waiting for Payment",

      payment_pending:
        "Waiting for Payment",

      assigned:
        "Driver Assigned",

      accepted:
        "Driver Assigned",

      picked_up:
        "Package Picked Up",

      in_transit:
        "En Route",

      en_route:
        "En Route",

      delayed:
        "Running Late",

      delivered:
        "Delivered",

      completed:
        "Completed"
    };

    return (
      labels[status] ||
      status
        .replaceAll("_", " ")
        .replace(/\b\w/g, letter =>
          letter.toUpperCase()
        ) ||
      "Pending"
    );
  }

  function statusClass(job) {
    const status =
      jobStatus(job);

    if (
      [
        "delayed",
        "waiting_payment",
        "payment_pending",
        "quote_pending",
        "pending_quote"
      ].includes(status)
    ) {
      return "warning";
    }

    if (
      [
        "cancelled",
        "canceled",
        "rejected"
      ].includes(status)
    ) {
      return "danger";
    }

    return "";
  }

  function routeText(job) {
    return `
      ${escapeHtml(
        job.pickup_address ||
        "Pickup pending"
      )}
      <br>
      <strong>to</strong>
      <br>
      ${escapeHtml(
        job.delivery_address ||
        "Delivery pending"
      )}
    `;
  }

  function deliveryCard(job) {
    const eta =
      job.estimated_delivery_time
        ? formatTime(
            job.estimated_delivery_time
          )
        : "Pending";

    return `
      <article class="portal-card">
        <div class="portal-card-main">
          <div>
            <div class="portal-card-title">
              ${escapeHtml(
                job.job_number ||
                "Delivery Request"
              )}
            </div>

            <div class="portal-card-subtitle">
              ${escapeHtml(
                formatDate(
                  job.scheduled_date ||
                  job.created_at
                )
              )}
            </div>
          </div>

          <div>
            <span class="portal-meta-label">
              Route
            </span>

            <div class="portal-meta-value">
              ${routeText(job)}
            </div>
          </div>

          <div>
            <span class="portal-meta-label">
              Estimated Drop-Off
            </span>

            <div class="portal-meta-value">
              ${escapeHtml(eta)}
            </div>
          </div>

          <div>
            <span
              class="portal-status ${statusClass(job)}"
            >
              ${escapeHtml(
                friendlyJobStatus(job)
              )}
            </span>
          </div>
        </div>
      </article>
    `;
  }

  function quoteCard(job) {
    const hasPrice =
      Number(job.customer_charge || 0) > 0;

    return `
      <article class="portal-card">
        <div class="portal-card-main">
          <div>
            <div class="portal-card-title">
              ${escapeHtml(
                job.job_number ||
                "Quote Request"
              )}
            </div>

            <div class="portal-card-subtitle">
              Requested
              ${escapeHtml(
                formatDate(job.created_at)
              )}
            </div>
          </div>

          <div>
            <span class="portal-meta-label">
              Route
            </span>

            <div class="portal-meta-value">
              ${routeText(job)}
            </div>
          </div>

          <div>
            <span class="portal-meta-label">
              Quote Amount
            </span>

            <div class="portal-meta-value">
              ${
                hasPrice
                  ? money(
                      job.customer_charge
                    )
                  : "Pricing pending"
              }
            </div>
          </div>

          <div>
            <span
              class="portal-status ${statusClass(job)}"
            >
              ${escapeHtml(
                friendlyJobStatus(job)
              )}
            </span>
          </div>
        </div>
      </article>
    `;
  }

  function invoiceCard(invoice) {
    const paid =
      isPaid(invoice);

    const overdue =
      isOverdue(invoice);

    const invoiceStatus =
      paid
        ? "Paid"
        : overdue
          ? "Overdue"
          : "Unpaid";

    const statusClassName =
      overdue
        ? "danger"
        : paid
          ? ""
          : "warning";

    return `
      <article class="portal-card">
        <div class="portal-card-main">
          <div>
            <div class="portal-card-title">
              ${escapeHtml(
                invoice.invoice_number ||
                "Invoice"
              )}
            </div>

            <div class="portal-card-subtitle">
              Created
              ${escapeHtml(
                formatDate(
                  invoice.created_at
                )
              )}
            </div>
          </div>

          <div>
            <span class="portal-meta-label">
              Customer
            </span>

            <div class="portal-meta-value">
              ${escapeHtml(
                invoice.customer_name ||
                customerAccount.customer_name
              )}
            </div>
          </div>

          <div>
            <span class="portal-meta-label">
              Amount Due
            </span>

            <div class="portal-meta-value">
              ${money(invoice.amount)}
            </div>

            <div class="portal-card-subtitle">
              Due
              ${escapeHtml(
                formatDate(invoice.due_date)
              )}
            </div>
          </div>

          <div>
            <span
              class="portal-status ${statusClassName}"
            >
              ${invoiceStatus}
            </span>
          </div>
        </div>

        ${
          paid
            ? ""
            : `
              <div class="portal-card-actions">
                <button
                  class="portal-card-button primary"
                  type="button"
                  data-pay-invoice="${escapeHtml(
                    invoice.id
                  )}"
                >
                  Pay Online
                </button>

                <button
                  class="portal-card-button"
                  type="button"
                  data-invoice-details="${escapeHtml(
                    invoice.id
                  )}"
                >
                  Invoice Details
                </button>
              </div>
            `
        }
      </article>
    `;
  }

  function locationCard(location) {
    const tags = [];

    if (
      location.is_pickup_location
    ) {
      tags.push("Pickup");
    }

    if (
      location.is_delivery_location
    ) {
      tags.push("Delivery");
    }

    return `
      <article class="portal-card">
        <div class="portal-card-main">
          <div>
            <div class="portal-card-title">
              ${escapeHtml(
                location.location_name
              )}
            </div>

            <div class="portal-card-subtitle">
              ${escapeHtml(
                tags.join(" • ") ||
                "Saved location"
              )}
            </div>
          </div>

          <div>
            <span class="portal-meta-label">
              Address
            </span>

            <div class="portal-meta-value">
              ${escapeHtml(
                location.address
              )}
            </div>
          </div>

          <div>
            <span class="portal-meta-label">
              Contact
            </span>

            <div class="portal-meta-value">
              ${escapeHtml(
                location.contact_name ||
                "Not recorded"
              )}
            </div>
          </div>

          <div>
            <span class="portal-meta-label">
              Phone
            </span>

            <div class="portal-meta-value">
              ${escapeHtml(
                location.contact_phone ||
                "Not recorded"
              )}
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function renderList(
    elementId,
    records,
    cardBuilder,
    emptyMessage
  ) {
    const element =
      document.getElementById(elementId);

    if (!records.length) {
      element.innerHTML = `
        <div class="portal-empty">
          ${escapeHtml(emptyMessage)}
        </div>
      `;

      return;
    }

    element.innerHTML = `
      <div class="portal-list">
        ${records
          .map(cardBuilder)
          .join("")}
      </div>
    `;
  }

  function populateLocations() {
    const pickupSelect =
      document.getElementById(
        "pickupLocationSelect"
      );

    const deliverySelect =
      document.getElementById(
        "deliveryLocationSelect"
      );

    pickupSelect.innerHTML = `
      <option value="">
        Enter a different address
      </option>

      ${locations
        .filter(location =>
          location.is_pickup_location
        )
        .map(location => `
          <option value="${escapeHtml(
            location.id
          )}">
            ${escapeHtml(
              location.location_name
            )}
          </option>
        `)
        .join("")}
    `;

    deliverySelect.innerHTML = `
      <option value="">
        Enter a different address
      </option>

      ${locations
        .filter(location =>
          location.is_delivery_location
        )
        .map(location => `
          <option value="${escapeHtml(
            location.id
          )}">
            ${escapeHtml(
              location.location_name
            )}
          </option>
        `)
        .join("")}
    `;
  }

  function renderPortal() {
    const quoteJobs =
      jobs.filter(isQuote);

    const activeJobs =
      jobs.filter(isActive);

    const completedJobs =
      jobs.filter(isCompleted);

    const unpaidInvoices =
      invoices.filter(invoice =>
        !isPaid(invoice)
      );

    document
      .getElementById(
        "welcomeCustomerName"
      )
      .textContent =
        customerAccount.customer_name ||
        "Customer";

    document
      .getElementById(
        "welcomeCompanyName"
      )
      .textContent =
        customerAccount.company_name ||
        "";

    document
      .getElementById(
        "activeDeliveryCount"
      )
      .textContent =
        activeJobs.length;

    document
      .getElementById(
        "pendingQuoteCount"
      )
      .textContent =
        quoteJobs.length;

    document
      .getElementById(
        "invoiceDueCount"
      )
      .textContent =
        unpaidInvoices.length;

    document
      .getElementById(
        "completedDeliveryCount"
      )
      .textContent =
        completedJobs.length;

    document
      .getElementById(
        "portalMenuUser"
      )
      .textContent =
        authData.user.email || "";

    document
      .getElementById(
        "profileCustomerName"
      )
      .textContent =
        customerAccount.customer_name ||
        "—";

    document
      .getElementById(
        "profileCompanyName"
      )
      .textContent =
        customerAccount.company_name ||
        "—";

    document
      .getElementById(
        "profileEmail"
      )
      .textContent =
        customerAccount.email ||
        authData.user.email ||
        "—";

    document
      .getElementById(
        "profilePhone"
      )
      .textContent =
        customerAccount.phone ||
        "—";

    renderList(
      "dashboardActiveDeliveries",
      activeJobs.slice(0, 3),
      deliveryCard,
      "You do not have any active deliveries."
    );

    renderList(
      "dashboardInvoices",
      unpaidInvoices.slice(0, 3),
      invoiceCard,
      "You do not have any unpaid invoices."
    );

    renderList(
      "quotesList",
      quoteJobs,
      quoteCard,
      "You do not have any pending quotes."
    );

    renderList(
      "activeDeliveriesList",
      activeJobs,
      deliveryCard,
      "You do not have any active deliveries."
    );

    renderList(
      "deliveryHistoryList",
      completedJobs,
      deliveryCard,
      "You do not have any completed deliveries."
    );

    renderList(
      "customerInvoiceList",
      invoices,
      invoiceCard,
      "You do not have any invoices."
    );

    renderList(
      "savedLocationList",
      locations,
      locationCard,
      "You do not have any saved locations."
    );

    populateLocations();
  }

  async function loadPortalData() {
    const [
      jobsResult,
      invoicesResult,
      locationsResult
    ] = await Promise.all([
      client
        .from("quotes")
        .select("*")
        .eq(
          "customer_account_id",
          customerAccount.id
        )
        .order(
          "created_at",
          {
            ascending: false
          }
        ),

      client
        .from("invoices")
        .select("*")
        .eq(
          "customer_account_id",
          customerAccount.id
        )
        .order(
          "created_at",
          {
            ascending: false
          }
        ),

      client
        .from(
          "customer_saved_locations"
        )
        .select("*")
        .eq(
          "customer_account_id",
          customerAccount.id
        )
        .eq(
          "is_active",
          true
        )
        .order(
          "location_name",
          {
            ascending: true
          }
        )
    ]);

    if (jobsResult.error) {
      throw jobsResult.error;
    }

    if (invoicesResult.error) {
      throw invoicesResult.error;
    }

    if (locationsResult.error) {
      throw locationsResult.error;
    }

    jobs =
      jobsResult.data || [];

    invoices =
      invoicesResult.data || [];

    locations =
      locationsResult.data || [];

    renderPortal();
  }

  function selectedLocation(
    locationId
  ) {
    return locations.find(
      location =>
        String(location.id) ===
        String(locationId)
    );
  }

  async function submitDeliveryRequest(
    event
  ) {
    event.preventDefault();

    const button =
      document.getElementById(
        "submitDeliveryRequestButton"
      );

    const pickupAddress =
      document
        .getElementById(
          "requestPickupAddress"
        )
        .value
        .trim();

    const deliveryAddress =
      document
        .getElementById(
          "requestDeliveryAddress"
        )
        .value
        .trim();

    if (
      !pickupAddress ||
      !deliveryAddress
    ) {
      setRequestMessage(
        "Pickup and delivery addresses are required.",
        "error"
      );

      return;
    }

    button.disabled = true;
    button.textContent =
      "Submitting Request...";

    setRequestMessage(
      "Sending your request to MG Express dispatch...",
      "success"
    );

    const payload = {
      customer_account_id:
        customerAccount.id,

      customer_name:
        customerAccount.customer_name,

      customer_email:
        customerAccount.email ||
        authData.user.email,

      customer_phone:
        customerAccount.phone ||
        null,

      pickup_address:
        pickupAddress,

      delivery_address:
        deliveryAddress,

      scheduled_date:
        document
          .getElementById(
            "requestScheduledDate"
          )
          .value,

      requested_pickup_time:
        document
          .getElementById(
            "requestPickupTime"
          )
          .value || null,

      vehicle_type:
        document
          .getElementById(
            "requestVehicleType"
          )
          .value,

      delivery_speed:
        document
          .getElementById(
            "requestDeliverySpeed"
          )
          .value,

      package_type:
        document
          .getElementById(
            "requestPackageType"
          )
          .value
          .trim() ||
        null,

      special_instructions:
        document
          .getElementById(
            "requestInstructions"
          )
          .value
          .trim() ||
        null,

      customer_charge: 0,
      driver_pay: 0,
      status: "quote_pending",
      request_source:
        "customer_portal"
    };

    try {
      const result =
        await client
          .from("quotes")
          .insert(payload);

      if (result.error) {
        throw result.error;
      }

      deliveryRequestForm.reset();

      document
        .getElementById(
          "requestScheduledDate"
        )
        .value =
          localDateString(
            new Date()
          );

      setRequestMessage(
        "Your quote request was sent successfully. Dispatch will review the request and prepare pricing.",
        "success"
      );

      await loadPortalData();

      setTimeout(() => {
        showView("quotes");
      }, 1200);
    } catch (error) {
      setRequestMessage(
        error.message ||
        "Unable to submit your delivery request.",
        "error"
      );
    } finally {
      button.disabled = false;
      button.textContent =
        "Submit Quote Request";
    }
  }

  document
    .getElementById(
      "portalMenuButton"
    )
    .addEventListener(
      "click",
      openMenu
    );

  document
    .getElementById(
      "portalMenuClose"
    )
    .addEventListener(
      "click",
      closeMenu
    );

  menuOverlay.addEventListener(
    "click",
    closeMenu
  );

  document
    .querySelectorAll(
      "[data-view]"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        function () {
          showView(
            this.dataset.view
          );
        }
      );
    });

  document
    .querySelectorAll(
      "[data-open-view]"
    )
    .forEach(button => {
      button.addEventListener(
        "click",
        function () {
          showView(
            this.dataset.openView
          );
        }
      );
    });

  document
    .getElementById(
      "pickupLocationSelect"
    )
    .addEventListener(
      "change",
      function () {
        const location =
          selectedLocation(
            this.value
          );

        if (location) {
          document
            .getElementById(
              "requestPickupAddress"
            )
            .value =
              location.address;
        }
      }
    );

  document
    .getElementById(
      "deliveryLocationSelect"
    )
    .addEventListener(
      "change",
      function () {
        const location =
          selectedLocation(
            this.value
          );

        if (location) {
          document
            .getElementById(
              "requestDeliveryAddress"
            )
            .value =
              location.address;
        }
      }
    );

  deliveryRequestForm.addEventListener(
    "submit",
    submitDeliveryRequest
  );

  document
    .getElementById(
      "customerInvoiceList"
    )
    .addEventListener(
      "click",
      function (event) {
        const payButton =
          event.target.closest(
            "[data-pay-invoice]"
          );

        if (payButton) {
          setPortalMessage(
            "Secure online payments are the next feature being connected. Your invoice remains safely stored.",
            "success"
          );

          window.scrollTo({
            top: 0,
            behavior: "smooth"
          });
        }
      }
    );

  document
    .getElementById(
      "dashboardInvoices"
    )
    .addEventListener(
      "click",
      function (event) {
        const payButton =
          event.target.closest(
            "[data-pay-invoice]"
          );

        if (payButton) {
          showView("invoices");

          setPortalMessage(
            "Select the invoice after secure online payments are connected.",
            "success"
          );
        }
      }
    );

  document
    .getElementById(
      "portalSignOutButton"
    )
    .addEventListener(
      "click",
      async function () {
        this.disabled = true;
        this.textContent =
          "Signing Out...";

        await window.MG_AUTH.signOut({
          redirectTo:
            "/customer-login.html?loggedout=1"
        });
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

  async function startPortal() {
    try {
      authData =
        await window.MG_AUTH
          .requireCustomerPortal();

      if (!authData) {
        return;
      }

      customerAccount =
        authData.customerAccount;

      document
        .getElementById(
          "requestScheduledDate"
        )
        .value =
          localDateString(
            new Date()
          );

      await window.MG_AUTH
        .updateLastLogin();

      await loadPortalData();
    } catch (error) {
      setPortalMessage(
        error.message ||
        "Unable to load your customer portal.",
        "error"
      );

      document
        .querySelectorAll(
          ".portal-empty"
        )
        .forEach(element => {
          element.textContent =
            "Unable to load this section.";
        });
    }
  }

  startPortal();
})();
