(function () {
  "use strict";

  const client = window.mgSupabase;

  const customerList =
    document.getElementById("customerList");

  const customerSearch =
    document.getElementById("customerSearch");

  const customerFilter =
    document.getElementById("customerFilter");

  const pageMessage =
    document.getElementById("customerPageMessage");

  const customerModalOverlay =
    document.getElementById("customerModalOverlay");

  const customerForm =
    document.getElementById("customerForm");

  const customerFormMessage =
    document.getElementById("customerFormMessage");

  const locationModalOverlay =
    document.getElementById("locationModalOverlay");

  const locationForm =
    document.getElementById("locationForm");

  const locationFormMessage =
    document.getElementById("locationFormMessage");

  let customers = [];
  let jobs = [];
  let invoices = [];
  let locations = [];
  let customerSummaries = [];

  function escapeHtml(value) {
    const element =
      document.createElement("div");

    element.textContent =
      value ?? "";

    return element.innerHTML;
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

  function normalize(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function setPageMessage(message, type) {
    pageMessage.textContent =
      message || "";

    pageMessage.className =
      message
        ? `message ${type || ""}`
        : "message hidden";
  }

  function setCustomerFormMessage(
    message,
    type
  ) {
    customerFormMessage.textContent =
      message || "";

    customerFormMessage.className =
      message
        ? `message ${type || ""}`
        : "message hidden";
  }

  function setLocationFormMessage(
    message,
    type
  ) {
    locationFormMessage.textContent =
      message || "";

    locationFormMessage.className =
      message
        ? `message ${type || ""}`
        : "message hidden";
  }

  function openCustomerModal(customer) {
    const editing = Boolean(customer);

    document
      .getElementById("customerModalTitle")
      .textContent =
        editing
          ? "Edit Customer"
          : "New Customer";

    document
      .getElementById("customerAccountId")
      .value =
        customer?.id || "";

    document
      .getElementById("customerName")
      .value =
        customer?.customer_name || "";

    document
      .getElementById("companyName")
      .value =
        customer?.company_name || "";

    document
      .getElementById("customerEmail")
      .value =
        customer?.email || "";

    document
      .getElementById("customerPhone")
      .value =
        customer?.phone || "";

    document
      .getElementById(
        "isRecurringCustomer"
      )
      .checked =
        customer?.is_recurring_customer ===
        true;

    document
      .getElementById(
        "portalAccessEnabled"
      )
      .checked =
        customer?.portal_access_enabled ===
        true;

    setCustomerFormMessage("", "");

    customerModalOverlay.classList.add(
      "open"
    );

    document.body.style.overflow =
      "hidden";
  }

  function closeCustomerModal() {
    customerModalOverlay.classList.remove(
      "open"
    );

    document.body.style.overflow = "";

    customerForm.reset();

    document
      .getElementById("customerAccountId")
      .value = "";

    setCustomerFormMessage("", "");
  }

  function openLocationModal(customerId) {
    locationForm.reset();

    document
      .getElementById(
        "locationCustomerAccountId"
      )
      .value =
        customerId;

    document
      .getElementById(
        "isPickupLocation"
      )
      .checked = true;

    document
      .getElementById(
        "isDeliveryLocation"
      )
      .checked = true;

    setLocationFormMessage("", "");

    locationModalOverlay.classList.add(
      "open"
    );

    document.body.style.overflow =
      "hidden";
  }

  function closeLocationModal() {
    locationModalOverlay.classList.remove(
      "open"
    );

    document.body.style.overflow = "";

    locationForm.reset();

    setLocationFormMessage("", "");
  }

  function isPaid(invoice) {
    return (
      normalize(
        invoice.payment_status
      ) === "paid"
    );
  }

  function customerJobs(customerId) {
    return jobs.filter(
      job =>
        String(
          job.customer_account_id || ""
        ) ===
        String(customerId)
    );
  }

  function customerInvoices(customerId) {
    return invoices.filter(
      invoice =>
        String(
          invoice.customer_account_id || ""
        ) ===
        String(customerId)
    );
  }

  function customerLocations(customerId) {
    return locations.filter(
      location =>
        String(
          location.customer_account_id ||
          ""
        ) ===
        String(customerId) &&
        location.is_active !== false
    );
  }

  function completedJobs(customerId) {
    return customerJobs(customerId).filter(
      job =>
        [
          "delivered",
          "completed"
        ].includes(
          normalize(job.status)
        )
    );
  }

  function activeJobs(customerId) {
    return customerJobs(customerId).filter(
      job =>
        ![
          "delivered",
          "completed",
          "cancelled",
          "canceled"
        ].includes(
          normalize(job.status)
        )
    );
  }

  function customerRevenue(customerId) {
    return customerInvoices(customerId)
      .reduce(
        (total, invoice) =>
          total +
          Number(invoice.amount || 0),
        0
      );
  }

  function outstandingBalance(customerId) {
    return customerInvoices(customerId)
      .filter(invoice =>
        !isPaid(invoice)
      )
      .reduce(
        (total, invoice) =>
          total +
          Number(invoice.amount || 0),
        0
      );
  }

  function lastDeliveryDate(customerId) {
    const completed =
      completedJobs(customerId)
        .map(job =>
          job.completed_at ||
          job.delivery_photo_uploaded_at ||
          job.created_at
        )
        .filter(Boolean)
        .map(value =>
          new Date(value)
        )
        .filter(date =>
          !Number.isNaN(
            date.getTime()
          )
        )
        .sort(
          (first, second) =>
            second.getTime() -
            first.getTime()
        );

    return completed[0] || null;
  }

  function formatDate(value) {
    if (!value) {
      return "No deliveries";
    }

    const date =
      value instanceof Date
        ? value
        : new Date(value);

    if (
      Number.isNaN(date.getTime())
    ) {
      return "Not recorded";
    }

    return new Intl.DateTimeFormat(
      "en-US",
      {
        month: "short",
        day: "numeric",
        year: "numeric"
      }
    ).format(date);
  }

  function buildSummaries() {
    customerSummaries =
      customers.map(customer => {
        const customerJobList =
          customerJobs(customer.id);

        const customerInvoiceList =
          customerInvoices(customer.id);

        return {
          ...customer,

          totalJobs:
            customerJobList.length,

          activeJobs:
            activeJobs(
              customer.id
            ).length,

          completedJobs:
            completedJobs(
              customer.id
            ).length,

          invoiceCount:
            customerInvoiceList.length,

          revenue:
            customerRevenue(
              customer.id
            ),

          outstanding:
            outstandingBalance(
              customer.id
            ),

          lastDelivery:
            lastDeliveryDate(
              customer.id
            ),

          savedLocations:
            customerLocations(
              customer.id
            )
        };
      });

    customerSummaries.sort(
      (first, second) =>
        String(
          first.company_name ||
          first.customer_name ||
          ""
        ).localeCompare(
          String(
            second.company_name ||
            second.customer_name ||
            ""
          )
        )
    );
  }

  function updateStatistics() {
    const totalOutstanding =
      customerSummaries.reduce(
        (total, customer) =>
          total +
          Number(
            customer.outstanding || 0
          ),
        0
      );

    document
      .getElementById("totalCustomers")
      .textContent =
        customerSummaries.length;

    document
      .getElementById(
        "recurringCustomers"
      )
      .textContent =
        customerSummaries.filter(
          customer =>
            customer
              .is_recurring_customer ===
            true
        ).length;

    document
      .getElementById("portalCustomers")
      .textContent =
        customerSummaries.filter(
          customer =>
            customer
              .portal_access_enabled ===
            true
        ).length;

    document
      .getElementById(
        "outstandingBalance"
      )
      .textContent =
        money(totalOutstanding);
  }

  function filteredCustomers() {
    const search =
      normalize(
        customerSearch.value
      );

    const filter =
      customerFilter.value;

    return customerSummaries.filter(
      customer => {
        if (
          filter === "recurring" &&
          customer
            .is_recurring_customer !==
            true
        ) {
          return false;
        }

        if (
          filter === "portal" &&
          customer
            .portal_access_enabled !==
            true
        ) {
          return false;
        }

        if (
          filter === "standard" &&
          customer
            .is_recurring_customer ===
            true
        ) {
          return false;
        }

        if (!search) {
          return true;
        }

        return [
          customer.customer_name,
          customer.company_name,
          customer.email,
          customer.phone
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(search);
      }
    );
  }

  function locationTags(location) {
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

    return tags.join(" • ");
  }

  function renderLocations(customer) {
    const savedLocations =
      customer.savedLocations || [];

    if (!savedLocations.length) {
      return `
        <div class="empty">
          No saved locations yet.
        </div>
      `;
    }

    return `
      <div class="customer-location-list">
        ${savedLocations
          .map(location => `
            <div class="customer-location-row">
              <div>
                <div class="customer-location-name">
                  ${escapeHtml(
                    location.location_name
                  )}
                </div>

                <div class="customer-location-address">
                  ${escapeHtml(
                    location.address
                  )}
                </div>

                ${
                  location.contact_name
                    ? `
                      <div class="customer-location-address">
                        Contact:
                        ${escapeHtml(
                          location.contact_name
                        )}
                        ${
                          location.contact_phone
                            ? ` • ${escapeHtml(
                                location.contact_phone
                              )}`
                            : ""
                        }
                      </div>
                    `
                    : ""
                }

                ${
                  location.delivery_instructions
                    ? `
                      <div class="customer-location-address">
                        ${escapeHtml(
                          location.delivery_instructions
                        )}
                      </div>
                    `
                    : ""
                }

                <div class="customer-location-tags">
                  ${escapeHtml(
                    locationTags(location)
                  )}
                </div>
              </div>

              <button
                class="customer-location-delete"
                type="button"
                data-delete-location="${escapeHtml(
                  location.id
                )}"
              >
                Delete
              </button>
            </div>
          `)
          .join("")}
      </div>
    `;
  }

  function renderCustomers() {
    const visible =
      filteredCustomers();

    if (!visible.length) {
      customerList.innerHTML = `
        <div class="empty">
          No customers match your search or filter.
        </div>
      `;

      return;
    }

    customerList.innerHTML =
      visible
        .map(customer => {
          const portalBadge =
            customer.portal_access_enabled
              ? `
                <span class="customer-badge portal">
                  Portal Enabled
                </span>
              `
              : "";

          const recurringBadge =
            customer.is_recurring_customer
              ? `
                <span class="customer-badge recurring">
                  Recurring
                </span>
              `
              : `
                <span class="customer-badge">
                  Standard
                </span>
              `;

          const portalButtonLabel =
            customer.portal_access_enabled
              ? "Disable Portal"
              : "Enable Portal";

          return `
            <article
              class="customer-card"
              data-customer-card="${escapeHtml(
                customer.id
              )}"
            >
              <div class="customer-summary">
                <div class="customer-main">
                  <div class="customer-name">
                    ${escapeHtml(
                      customer.customer_name
                    )}
                  </div>

                  ${
                    customer.company_name
                      ? `
                        <div class="customer-company">
                          ${escapeHtml(
                            customer.company_name
                          )}
                        </div>
                      `
                      : ""
                  }

                  <div class="customer-contact">
                    ${escapeHtml(
                      customer.email
                    )}

                    ${
                      customer.phone
                        ? `<br>${escapeHtml(
                            customer.phone
                          )}`
                        : ""
                    }
                  </div>
                </div>

                <div class="customer-jobs">
                  <span class="customer-meta-label">
                    Deliveries
                  </span>

                  <div class="customer-meta-value">
                    ${customer.totalJobs}
                  </div>
                </div>

                <div class="customer-revenue">
                  <span class="customer-meta-label">
                    Revenue
                  </span>

                  <div class="customer-meta-value money">
                    ${money(
                      customer.revenue
                    )}
                  </div>
                </div>

                <div class="customer-balance">
                  <span class="customer-meta-label">
                    Outstanding
                  </span>

                  <div class="customer-meta-value money">
                    ${money(
                      customer.outstanding
                    )}
                  </div>
                </div>

                <div class="customer-status">
                  ${recurringBadge}
                  ${portalBadge}
                </div>
              </div>

              <div class="customer-actions">
                <button
                  class="customer-action-button primary"
                  type="button"
                  data-toggle-customer="${escapeHtml(
                    customer.id
                  )}"
                >
                  View Details
                </button>

                <button
                  class="customer-action-button"
                  type="button"
                  data-edit-customer="${escapeHtml(
                    customer.id
                  )}"
                >
                  Edit
                </button>

                <button
                  class="customer-action-button portal"
                  type="button"
                  data-toggle-portal="${escapeHtml(
                    customer.id
                  )}"
                >
                  ${portalButtonLabel}
                </button>

                <button
                  class="customer-action-button"
                  type="button"
                  data-add-location="${escapeHtml(
                    customer.id
                  )}"
                >
                  Add Location
                </button>
              </div>

              <div class="customer-details">
                <div class="customer-detail-grid">
                  <div class="customer-detail-box">
                    <span class="customer-meta-label">
                      Active Jobs
                    </span>

                    <div class="customer-meta-value">
                      ${customer.activeJobs}
                    </div>
                  </div>

                  <div class="customer-detail-box">
                    <span class="customer-meta-label">
                      Completed Jobs
                    </span>

                    <div class="customer-meta-value">
                      ${customer.completedJobs}
                    </div>
                  </div>

                  <div class="customer-detail-box">
                    <span class="customer-meta-label">
                      Invoices
                    </span>

                    <div class="customer-meta-value">
                      ${customer.invoiceCount}
                    </div>
                  </div>

                  <div class="customer-detail-box">
                    <span class="customer-meta-label">
                      Last Delivery
                    </span>

                    <div class="customer-meta-value">
                      ${escapeHtml(
                        formatDate(
                          customer.lastDelivery
                        )
                      )}
                    </div>
                  </div>
                </div>

                <h3>Saved Locations</h3>

                ${renderLocations(customer)}
              </div>
            </article>
          `;
        })
        .join("");
  }

  function findCustomer(customerId) {
    return customers.find(
      customer =>
        String(customer.id) ===
        String(customerId)
    );
  }

  async function loadCustomerData() {
    customerList.innerHTML = `
      <div class="empty">
        Loading customers...
      </div>
    `;

    setPageMessage("", "");

    const [
      customerResult,
      jobsResult,
      invoiceResult,
      locationResult
    ] = await Promise.all([
      client
        .from(
          "customer_portal_accounts"
        )
        .select("*")
        .order("created_at", {
          ascending: false
        }),

      client
        .from("quotes")
        .select("*")
        .order("created_at", {
          ascending: false
        }),

      client
        .from("invoices")
        .select("*")
        .order("created_at", {
          ascending: false
        }),

      client
        .from(
          "customer_saved_locations"
        )
        .select("*")
        .order("created_at", {
          ascending: false
        })
    ]);

    if (customerResult.error) {
      throw customerResult.error;
    }

    if (jobsResult.error) {
      throw jobsResult.error;
    }

    if (invoiceResult.error) {
      throw invoiceResult.error;
    }

    if (locationResult.error) {
      throw locationResult.error;
    }

    customers =
      customerResult.data || [];

    jobs =
      jobsResult.data || [];

    invoices =
      invoiceResult.data || [];

    locations =
      locationResult.data || [];

    buildSummaries();
    updateStatistics();
    renderCustomers();
  }

  async function saveCustomer(event) {
    event.preventDefault();

    const customerId =
      document
        .getElementById(
          "customerAccountId"
        )
        .value;

    const recurring =
      document
        .getElementById(
          "isRecurringCustomer"
        )
        .checked;

    const portalEnabled =
      document
        .getElementById(
          "portalAccessEnabled"
        )
        .checked;

    if (
      portalEnabled &&
      !recurring
    ) {
      setCustomerFormMessage(
        "Portal access can only be enabled for recurring customers.",
        "error"
      );

      return;
    }

    const payload = {
      customer_name:
        document
          .getElementById(
            "customerName"
          )
          .value
          .trim(),

      company_name:
        document
          .getElementById(
            "companyName"
          )
          .value
          .trim() ||
        null,

      email:
        document
          .getElementById(
            "customerEmail"
          )
          .value
          .trim()
          .toLowerCase(),

      phone:
        document
          .getElementById(
            "customerPhone"
          )
          .value
          .trim() ||
        null,

      is_recurring_customer:
        recurring,

      portal_access_enabled:
        portalEnabled
    };

    const saveButton =
      document.getElementById(
        "saveCustomerButton"
      );

    saveButton.disabled = true;
    saveButton.textContent =
      "Saving...";

    setCustomerFormMessage(
      "Saving customer...",
      "success"
    );

    try {
      let result;

      if (customerId) {
        result = await client
          .from(
            "customer_portal_accounts"
          )
          .update(payload)
          .eq("id", customerId)
          .select("*")
          .maybeSingle();
      } else {
        result = await client
          .from(
            "customer_portal_accounts"
          )
          .insert(payload)
          .select("*")
          .maybeSingle();
      }

      if (result.error) {
        throw result.error;
      }

      setCustomerFormMessage(
        customerId
          ? "Customer updated."
          : "Customer created.",
        "success"
      );

      await loadCustomerData();

      setTimeout(
        closeCustomerModal,
        650
      );
    } catch (error) {
      setCustomerFormMessage(
        error.message ||
        "Unable to save customer.",
        "error"
      );
    } finally {
      saveButton.disabled = false;
      saveButton.textContent =
        "Save Customer";
    }
  }

  async function saveLocation(event) {
    event.preventDefault();

    const customerId =
      document
        .getElementById(
          "locationCustomerAccountId"
        )
        .value;

    const payload = {
      customer_account_id:
        customerId,

      location_name:
        document
          .getElementById(
            "locationName"
          )
          .value
          .trim(),

      address:
        document
          .getElementById(
            "locationAddress"
          )
          .value
          .trim(),

      contact_name:
        document
          .getElementById(
            "locationContactName"
          )
          .value
          .trim() ||
        null,

      contact_phone:
        document
          .getElementById(
            "locationContactPhone"
          )
          .value
          .trim() ||
        null,

      delivery_instructions:
        document
          .getElementById(
            "locationInstructions"
          )
          .value
          .trim() ||
        null,

      is_pickup_location:
        document
          .getElementById(
            "isPickupLocation"
          )
          .checked,

      is_delivery_location:
        document
          .getElementById(
            "isDeliveryLocation"
          )
          .checked,

      is_active: true
    };

    const submitButton =
      locationForm.querySelector(
        'button[type="submit"]'
      );

    submitButton.disabled = true;
    submitButton.textContent =
      "Saving...";

    setLocationFormMessage(
      "Saving location...",
      "success"
    );

    try {
      const result = await client
        .from(
          "customer_saved_locations"
        )
        .insert(payload);

      if (result.error) {
        throw result.error;
      }

      setLocationFormMessage(
        "Location saved.",
        "success"
      );

      await loadCustomerData();

      setTimeout(
        closeLocationModal,
        650
      );
    } catch (error) {
      setLocationFormMessage(
        error.message ||
        "Unable to save location.",
        "error"
      );
    } finally {
      submitButton.disabled = false;
      submitButton.textContent =
        "Save Location";
    }
  }

  async function togglePortal(customerId) {
    const customer =
      findCustomer(customerId);

    if (!customer) {
      return;
    }

    const enabling =
      !customer.portal_access_enabled;

    if (
      enabling &&
      !customer.is_recurring_customer
    ) {
      setPageMessage(
        "Mark this customer as recurring before enabling portal access.",
        "error"
      );

      return;
    }

    const result = await client
      .from(
        "customer_portal_accounts"
      )
      .update({
        portal_access_enabled:
          enabling,

        portal_invited_at:
          enabling
            ? new Date().toISOString()
            : customer.portal_invited_at
      })
      .eq("id", customerId);

    if (result.error) {
      throw result.error;
    }

    setPageMessage(
      enabling
        ? "Portal access enabled. The secure invitation email will be connected in the next step."
        : "Portal access disabled.",
      "success"
    );

    await loadCustomerData();
  }

  async function deleteLocation(
    locationId
  ) {
    const confirmed =
      window.confirm(
        "Delete this saved location?"
      );

    if (!confirmed) {
      return;
    }

    const result = await client
      .from(
        "customer_saved_locations"
      )
      .delete()
      .eq("id", locationId);

    if (result.error) {
      throw result.error;
    }

    setPageMessage(
      "Saved location deleted.",
      "success"
    );

    await loadCustomerData();
  }

  customerList.addEventListener(
    "click",
    async function (event) {
      const toggleButton =
        event.target.closest(
          "[data-toggle-customer]"
        );

      if (toggleButton) {
        const card =
          document.querySelector(
            `[data-customer-card="${toggleButton.dataset.toggleCustomer}"]`
          );

        card?.classList.toggle(
          "open"
        );

        return;
      }

      const editButton =
        event.target.closest(
          "[data-edit-customer]"
        );

      if (editButton) {
        const customer =
          findCustomer(
            editButton.dataset
              .editCustomer
          );

        openCustomerModal(
          customer
        );

        return;
      }

      const portalButton =
        event.target.closest(
          "[data-toggle-portal]"
        );

      if (portalButton) {
        portalButton.disabled = true;

        try {
          await togglePortal(
            portalButton.dataset
              .togglePortal
          );
        } catch (error) {
          setPageMessage(
            error.message ||
            "Unable to update portal access.",
            "error"
          );
        } finally {
          portalButton.disabled = false;
        }

        return;
      }

      const locationButton =
        event.target.closest(
          "[data-add-location]"
        );

      if (locationButton) {
        openLocationModal(
          locationButton.dataset
            .addLocation
        );

        return;
      }

      const deleteLocationButton =
        event.target.closest(
          "[data-delete-location]"
        );

      if (deleteLocationButton) {
        deleteLocationButton.disabled =
          true;

        try {
          await deleteLocation(
            deleteLocationButton.dataset
              .deleteLocation
          );
        } catch (error) {
          setPageMessage(
            error.message ||
            "Unable to delete location.",
            "error"
          );
        } finally {
          deleteLocationButton.disabled =
            false;
        }
      }
    }
  );

  customerForm.addEventListener(
    "submit",
    saveCustomer
  );

  locationForm.addEventListener(
    "submit",
    saveLocation
  );

  customerSearch.addEventListener(
    "input",
    renderCustomers
  );

  customerFilter.addEventListener(
    "change",
    renderCustomers
  );

  document
    .getElementById(
      "newCustomerButton"
    )
    .addEventListener(
      "click",
      function () {
        openCustomerModal(null);
      }
    );

  document
    .getElementById(
      "closeCustomerModalButton"
    )
    .addEventListener(
      "click",
      closeCustomerModal
    );

  document
    .getElementById(
      "cancelCustomerButton"
    )
    .addEventListener(
      "click",
      closeCustomerModal
    );

  document
    .getElementById(
      "closeLocationModalButton"
    )
    .addEventListener(
      "click",
      closeLocationModal
    );

  document
    .getElementById(
      "cancelLocationButton"
    )
    .addEventListener(
      "click",
      closeLocationModal
    );

  document
    .getElementById(
      "refreshCustomersButton"
    )
    .addEventListener(
      "click",
      async function () {
        this.disabled = true;
        this.textContent =
          "Refreshing...";

        try {
          await loadCustomerData();

          setPageMessage(
            "Customer records refreshed.",
            "success"
          );
        } catch (error) {
          setPageMessage(
            error.message ||
            "Unable to refresh customers.",
            "error"
          );
        } finally {
          this.disabled = false;
          this.textContent =
            "Refresh";
        }
      }
    );

  customerModalOverlay.addEventListener(
    "click",
    function (event) {
      if (
        event.target ===
        customerModalOverlay
      ) {
        closeCustomerModal();
      }
    }
  );

  locationModalOverlay.addEventListener(
    "click",
    function (event) {
      if (
        event.target ===
        locationModalOverlay
      ) {
        closeLocationModal();
      }
    }
  );

  document.addEventListener(
    "keydown",
    function (event) {
      if (event.key === "Escape") {
        closeCustomerModal();
        closeLocationModal();
      }
    }
  );

  async function startPage() {
    try {
      const menuResult =
        await window.MG_MENU.initialize({
          buttonContainerSelector:
            ".topbar-inner"
        });

      if (!menuResult) {
        return;
      }

      const email =
        menuResult.authData
          ?.user?.email || "";

      document
        .getElementById("staffEmail")
        .textContent =
          email;

      await loadCustomerData();
    } catch (error) {
      customerList.innerHTML = `
        <div class="empty">
          ${escapeHtml(
            error.message ||
            "Unable to load customer CRM."
          )}
        </div>
      `;
    }
  }

  startPage();
})();
