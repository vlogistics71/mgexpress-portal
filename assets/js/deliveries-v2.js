 (function () {
  "use strict";

  const client = window.mgSupabase || window.supabase.createClient(
    "https://dczlucwfjayymlwbzzdi.supabase.co",
    "sb_publishable_kcv_a78ZyUxMo2neKUANdw_XN7eAMpI"
  );

  window.mgDispatchClient = client;

  const state = {
    session: null,
    profile: null,
    deliveries: [],
    drivers: [],
    activeCategory: "all",
    search: "",
    sort: "newest",
    selectedDelivery: null,
    deliveryDetailsRequestToken: 0,
    assignDriverId: "",
    assignDriverPay: "",
    assignSearch: "",
    assignFilter: "all",
    loadError: "",
    isAssigning: false
  };

  const elements = {
    staffEmail: document.getElementById("staffEmail"),
    newDeliveryButton: document.getElementById("newDeliveryButton"),
    statusFilter: document.getElementById("statusFilter"),
    tabs: document.getElementById("tabs"),
    categoryFilters: document.getElementById("categoryFilters"),
    searchInput: document.getElementById("searchInput"),
    sortSelect: document.getElementById("sortSelect"),
    refreshButton: document.getElementById("refreshButton"),
    statusSummary: document.getElementById("statusSummary"),
    summaryTotalOpen: document.getElementById("summaryTotalOpen"),
    summaryUnassigned: document.getElementById("summaryUnassigned"),
    summaryInTransit: document.getElementById("summaryInTransit"),
    summaryWaitingPayment: document.getElementById("summaryWaitingPayment"),
    workspaceLabel: document.getElementById("workspaceLabel"),
    visibleCount: document.getElementById("visibleCount"),
    deliveryList: document.getElementById("deliveryList"),
    toastWrap: document.getElementById("toastWrap"),
    deliveryDetailsModal: document.getElementById("deliveryDetailsModal"),
    deliveryDetailsBody: document.getElementById("deliveryDetailsBody"),
    deliveryDetailsSubtitle: document.getElementById("deliveryDetailsSubtitle"),
    deliveryDetailsTitle: document.getElementById("deliveryDetailsTitle"),
    newDeliveryModal: document.getElementById("newDeliveryModal"),
    assignModal: document.getElementById("assignModal"),
    assignJobSummary: document.getElementById("assignJobSummary"),
    assignRecommendedCard: document.getElementById("assignRecommendedCard"),
    assignDriverSearch: document.getElementById("assignDriverSearch"),
    assignDriverFilter: document.getElementById("assignDriverFilter"),
    assignDriverCards: document.getElementById("assignDriverCards"),
    assignForm: document.getElementById("assignForm"),
    assignJobId: document.getElementById("assignJobId"),
    assignDriverSelect: document.getElementById("assignDriverSelect"),
    assignDriverPay: document.getElementById("assignDriverPay"),
    assignNote: document.getElementById("assignNote"),
    assignSubmitBtn: document.getElementById("assignSubmitBtn"),
    assignConfirmModal: document.getElementById("assignConfirmModal"),
    assignConfirmText: document.getElementById("assignConfirmText"),
    assignConfirmBtn: document.getElementById("assignConfirmBtn"),
    rejectedReturnConfirmModal: document.getElementById("rejectedReturnConfirmModal"),
    rejectedReturnConfirmText: document.getElementById("rejectedReturnConfirmText"),
    rejectedReturnConfirmBtn: document.getElementById("rejectedReturnConfirmBtn")
  };

  function clean(value) {
    return String(value || "").trim().toLowerCase();
  }

  function readInitialTabFromUrl() {
    const params = new URLSearchParams(window.location.search || "");
    const requested = clean(params.get("tab"));
    const allowed = new Set(["all_open", "waiting_payment", "ready", "assigned", "in_transit", "rejected", "completed", "search", "pending"]);
    if (requested === "pending") {
      return "all_open";
    }
    return allowed.has(requested) ? requested : "all_open";
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }

  function parseDate(value) {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDateTime(value) {
    const date = parseDate(value);
    if (!date) {
      return "-";
    }

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  function formatDateOnly(value) {
    const date = parseDate(value);
    if (!date) {
      return "-";
    }

    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric"
    }).format(date);
  }

  function formatTimeOnly(value) {
    const date = parseDate(value);
    if (!date) {
      return "-";
    }

    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit"
    }).format(date);
  }

  function scheduledDeliveryDateTime(delivery) {
    return delivery?.scheduled_at || delivery?.pickup_time || delivery?.delivery_time || null;
  }

  function formatMoney(value) {
    const amount = Number(value || 0);
    return amount.toLocaleString("en-US", {
      style: "currency",
      currency: "USD"
    });
  }

  function showToast(message, type = "info") {
    if (!elements.toastWrap) {
      return;
    }

    const toast = document.createElement("div");
    toast.className = "toast " + type;
    toast.textContent = message;
    elements.toastWrap.appendChild(toast);

    window.setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  function openModal(modal) {
    if (!modal) {
      return;
    }

    modal.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeModal(modal) {
    if (!modal) {
      return;
    }

    modal.classList.remove("open");
    if (!document.querySelector(".modal-backdrop.open")) {
      document.body.style.overflow = "";
    }
  }

  function isComplete(delivery) {
    const status = clean(delivery?.status);
    const workflow = clean(delivery?.driver_workflow_status);
    return ["completed", "delivered", "closed"].includes(status) || workflow === "delivered";
  }

  function isCancelled(delivery) {
    return ["cancelled", "canceled"].includes(clean(delivery?.status));
  }

  function isRejected(delivery) {
    return clean(delivery?.driver_acceptance_status) === "rejected";
  }

  function isAssigned(delivery) {
    return Boolean(String(delivery?.assigned_driver_id || "").trim()) && !isComplete(delivery) && !isCancelled(delivery);
  }

  function isReady(delivery) {
    const status = clean(delivery?.status);
    return status === "ready" || status === "ready_to_dispatch";
  }

  function isInTransit(delivery) {
    const status = clean(delivery?.status);
    const workflow = clean(delivery?.driver_workflow_status);
    return ["assigned", "in_progress", "en_route", "en_route_pickup", "arrived_pickup", "picked_up", "en_route_delivery", "arrived_delivery"].includes(status)
      || ["in_progress", "en_route", "en_route_pickup", "arrived_pickup", "picked_up", "en_route_delivery", "arrived_delivery"].includes(workflow);
  }

  function getCategoryClass(category) {
    const value = clean(category);
    if (value === "medical") {
      return "category-medical";
    }
    if (value === "legal") {
      return "category-legal";
    }
    if (value === "pallet") {
      return "category-pallet";
    }
    if (value === "special") {
      return "category-special";
    }
    return "category-general";
  }

  function getCategoryLabel(category) {
    const value = clean(category);
    if (value === "medical") {
      return "Medical";
    }
    if (value === "legal") {
      return "Legal";
    }
    if (value === "pallet") {
      return "Pallet";
    }
    if (value === "special") {
      return "Special";
    }
    return "General";
  }

  function getStatusLabel(delivery) {
    if (isComplete(delivery)) {
      return "Completed";
    }
    if (isCancelled(delivery)) {
      return "Cancelled";
    }
    if (isRejected(delivery)) {
      return "Rejected";
    }
    if (isAssigned(delivery)) {
      return "Assigned";
    }
    if (isReady(delivery)) {
      return "Ready";
    }
    return "Pending";
  }

  function getDriverDisplayName(driver) {
    return String(
      driver?.full_name ||
      driver?.display_name ||
      driver?.name ||
      driver?.email ||
      "Driver"
    ).trim() || "Driver";
  }

  function driverNameById(driverId) {
    const id = String(driverId || "").trim();
    if (!id) {
      return "";
    }

    const match = state.drivers.find(driver => String(driver.id || "") === id);
    return match ? getDriverDisplayName(match) : "";
  }

  function getDriverAvailability(driver) {
    const status = clean(driver?.availability_status || driver?.status);
    if (["off_duty", "inactive", "offline"].includes(status)) {
      return "off_duty";
    }
    if (["busy", "assigned", "working", "en_route"].includes(status)) {
      return "busy";
    }
    if (["available", "active", "ready"].includes(status)) {
      return "available";
    }

    const activeFlag = driver?.active ?? driver?.is_active ?? driver?.enabled;
    if (activeFlag === false) {
      return "off_duty";
    }

    return "available";
  }

  function deliverySearchText(delivery) {
    return [
      delivery.job_number,
      delivery.customer_name,
      delivery.company_name,
      delivery.email,
      delivery.phone,
      delivery.pickup_address,
      delivery.delivery_address,
      delivery.reference_number,
      delivery.package_type,
      delivery.vehicle_type,
      delivery.delivery_speed,
      delivery.status,
      delivery.driver_workflow_status,
      delivery.driver_acceptance_status,
      delivery.job_category
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function matchesCategory(delivery) {
    if (state.activeCategory === "all") {
      return true;
    }

    if (state.activeCategory === "return_jobs") {
      return clean(delivery.return_required) === "true" || delivery.return_required === true;
    }

    if (state.activeCategory === "stat") {
      return clean(delivery.service_level) === "stat" || clean(delivery.delivery_speed) === "2_hr" || clean(delivery.delivery_speed) === "stat";
    }

    return clean(delivery.job_category) === state.activeCategory;
  }

  function matchesSearch(delivery) {
    const query = state.search.trim().toLowerCase();
    if (!query) {
      return true;
    }

    return deliverySearchText(delivery).includes(query);
  }

  function visibleDeliveries() {
    const rows = state.deliveries.filter(delivery => isActiveJob(delivery) && matchesCategory(delivery) && matchesSearch(delivery));

    const sorted = rows.slice();
    sorted.sort((left, right) => {
      if (state.sort === "customer") {
        return String(left.customer_name || "").localeCompare(String(right.customer_name || ""));
      }
      if (state.sort === "pickup_time") {
        return (parseDate(left.pickup_time)?.getTime() || 0) - (parseDate(right.pickup_time)?.getTime() || 0);
      }
      if (state.sort === "delivery_time") {
        return (parseDate(left.delivery_time)?.getTime() || 0) - (parseDate(right.delivery_time)?.getTime() || 0);
      }
      if (state.sort === "oldest") {
        return (parseDate(left.created_at)?.getTime() || 0) - (parseDate(right.created_at)?.getTime() || 0);
      }

      return (parseDate(right.created_at)?.getTime() || 0) - (parseDate(left.created_at)?.getTime() || 0);
    });

    return sorted;
  }

  function countsForTab(tab) {
    return state.deliveries.filter(delivery => {
      const previousTab = state.activeTab;
      state.activeTab = tab;
      const result = matchesTab(delivery);
      state.activeTab = previousTab;
      return result;
    }).length;
  }

  function countsForCategory(category) {
    const previousCategory = state.activeCategory;
    state.activeCategory = category;
    const result = state.deliveries.filter(delivery => matchesCategory(delivery)).length;
    state.activeCategory = previousCategory;
    return result;
  }

    elements.tabs.innerHTML = tabs.map(([value, label]) => {
      const count = countsForTab(value);
      const active = value === state.activeTab ? "active" : "";
      return `<button class="tab ${active}" type="button" data-tab="${value}"><span>${escapeHtml(label)}</span><span class="tab-count">(${count})</span></button>`;
    }).join("");
  }

  }

  function renderWorkspaceSummary() {
    const visible = visibleDeliveries();
    const activeRows = state.deliveries.filter(isActiveJob);
    const total = activeRows.length;
    const assigned = activeRows.filter(isAssigned).length;
    const ready = activeRows.filter(isReady).length;
    const openRows = activeRows.filter(delivery => !isComplete(delivery) && !isCancelled(delivery));
    const unassigned = openRows.filter(delivery => !isAssigned(delivery)).length;
    const inTransit = activeRows.filter(isInTransit).length;
    const waitingPayment = openRows.filter(delivery => clean(delivery.payment_status) !== "paid").length;

    if (elements.summaryTotalOpen) {
      elements.summaryTotalOpen.textContent = String(openRows.length);
    }
    if (elements.summaryUnassigned) {
      elements.summaryUnassigned.textContent = String(unassigned);
    }
    if (elements.summaryInTransit) {
      elements.summaryInTransit.textContent = String(inTransit);
    }
    if (elements.summaryWaitingPayment) {
      elements.summaryWaitingPayment.textContent = String(waitingPayment);
    }

    if (elements.workspaceLabel) {
      elements.workspaceLabel.textContent = "Active Jobs";
    }
    if (elements.visibleCount) {
      elements.visibleCount.textContent = `${visible.length} visible of ${total}`;
    }
    if (elements.statusSummary) {
      elements.statusSummary.textContent = `Open ${openRows.length} • Ready ${ready} • Assigned ${assigned}`;
    }
  }

  function canAssignDriver(delivery) {
    return !isComplete(delivery) && !isCancelled(delivery) && (isReady(delivery) || isAssigned(delivery) || isRejected(delivery));
  }

  function canMarkReady(delivery) {
    return !isReady(delivery) && !isAssigned(delivery) && !isComplete(delivery) && !isCancelled(delivery) && !isRejected(delivery);
  }

  function canMarkPaid(delivery) {
    return clean(delivery.payment_status) !== "paid" && !isComplete(delivery) && !isCancelled(delivery);
  }

  function canCancelDelivery(delivery) {
    return !isCancelled(delivery) && !isComplete(delivery);
  }

  function workflowActionButtons(delivery) {
    const id = escapeHtml(String(delivery.id || ""));
    const buttons = [];

    if (canAssignDriver(delivery)) {
      buttons.push(`<button class="action-btn secondary" type="button" data-details-action="assign" data-delivery-id="${id}">${delivery.assigned_driver_id ? "Reassign Driver" : "Assign Driver"}</button>`);
    }
    if (canMarkReady(delivery)) {
      buttons.push(`<button class="action-btn secondary" type="button" data-details-action="ready" data-delivery-id="${id}">Mark Ready</button>`);
    }
    if (canMarkPaid(delivery)) {
      buttons.push(`<button class="action-btn secondary" type="button" data-details-action="paid" data-delivery-id="${id}">Mark Paid</button>`);
    }
    if (canCancelDelivery(delivery)) {
      buttons.push(`<button class="action-btn danger-btn" type="button" data-details-action="cancel" data-delivery-id="${id}">Cancel Delivery</button>`);
    }

    return buttons.join("");
  }

  function documentActionButtons(delivery) {
    const id = escapeHtml(String(delivery.id || ""));
    const bolDisabled = delivery?.id ? "" : " disabled";
    const invoiceDisabled = delivery?.id ? "" : " disabled";

    return `
      <button class="action-btn secondary${bolDisabled}" type="button" data-details-action="bol" data-delivery-id="${id}">View BOL</button>
      <button class="action-btn secondary${invoiceDisabled}" type="button" data-details-action="invoice" data-delivery-id="${id}">View Invoice</button>
    `;
  }

  function renderDeliveries() {
    const list = visibleDeliveries();
    if (!list.length) {
      elements.deliveryList.innerHTML = `
        <div class="empty">
          <div>
            <div class="empty-title">No deliveries match your filters.</div>
            <div class="empty-copy">Try another tab, category, or search term.</div>
          </div>
        </div>
      `;
      renderWorkspaceSummary();
      return;
    }

    elements.deliveryList.innerHTML = list.map(delivery => {
      const categoryClass = getCategoryClass(delivery.job_category);
      const categoryLabel = getCategoryLabel(delivery.job_category);
      const statusLabel = getStatusLabel(delivery);
      const pickupAddress = escapeHtml(delivery.pickup_address || "Pickup pending");
      const deliveryAddress = escapeHtml(delivery.delivery_address || "Delivery pending");
      const driverName = driverNameById(delivery.assigned_driver_id);
      const assignedTo = delivery.assigned_driver_id ? `Driver: ${escapeHtml(driverName || "Driver Assigned")}` : "";
      const createdAt = formatDateTime(delivery.created_at);
      const pay = delivery.driver_pay != null && delivery.driver_pay !== "" ? formatMoney(delivery.driver_pay) : "-";
      const statusClass = isComplete(delivery) ? "stat" : isRejected(delivery) ? "return" : "";
      const serviceLabel = [delivery.delivery_speed, delivery.service_level].filter(Boolean).join(" • ");
      return `
        <div class="card ${categoryClass}" data-delivery-id="${escapeHtml(String(delivery.id || ""))}" role="button" tabindex="0" aria-label="Open ${escapeHtml(delivery.job_number || "delivery")} details">
          <div class="card-main">
            <div class="card-topline">
              <span class="category-dot ${categoryClass}"></span>
              <span class="badge">${escapeHtml(categoryLabel)}</span>
              <span class="badge ${statusClass}">${escapeHtml(statusLabel)}</span>
              ${clean(delivery.return_required) === "true" || delivery.return_required === true ? '<span class="badge return">Return</span>' : ""}
            </div>
            <div class="job-number">${escapeHtml(delivery.job_number || "Delivery")}</div>
            <div class="customer">${escapeHtml(delivery.customer_name || delivery.company_name || "Customer")}</div>
            <div class="route">${pickupAddress}<br>↓<br>${deliveryAddress}</div>
            <div class="meta">
              <span>Created ${escapeHtml(createdAt)}</span>
              ${serviceLabel ? `<span>${escapeHtml(serviceLabel)}</span>` : ""}
            </div>
            <div class="meta">
              ${assignedTo ? `<span>${assignedTo}</span>` : ""}
              ${pay !== "-" ? `<span>Pay: ${escapeHtml(pay)}</span>` : ""}
            </div>
          </div>
          <div class="card-chevron" aria-hidden="true">&gt;</div>
        </div>
      `;
    }).join("");

    renderWorkspaceSummary();
  }

  function detailsRow(label, value) {
    return `<div class="details-kv"><strong>${escapeHtml(label)}</strong><span>${value ? escapeHtml(value) : "-"}</span></div>`;
  }

  function detailsBlock(label, value) {
    return `<div class="details-kv"><strong>${escapeHtml(label)}</strong><span>${value ? escapeHtml(value) : "-"}</span></div>`;
  }

  function renderDeliveryDetailsModal(delivery, message = "") {
    if (!elements.deliveryDetailsBody) {
      return;
    }

    if (!delivery) {
      elements.deliveryDetailsTitle.textContent = "Delivery Details";
      elements.deliveryDetailsSubtitle.textContent = message || "";
      elements.deliveryDetailsBody.innerHTML = `
        <section class="details-card">
          <h4>Delivery</h4>
          <div class="details-card-body">
            <div class="empty" style="min-height:120px;padding:0;place-items:start;text-align:left;">
              <div>
                <div class="empty-title">Delivery not found.</div>
                <div class="empty-copy">${escapeHtml(message || "The selected delivery could not be loaded.")}</div>
              </div>
            </div>
          </div>
        </section>
      `;
      return;
    }

    const route = [delivery.pickup_address, delivery.delivery_address].filter(Boolean).join(" → ");
    const assignedDriverName = driverNameById(delivery.assigned_driver_id);
    const assignedDriver = delivery.assigned_driver_id ? (assignedDriverName || "Driver Assigned") : "Unassigned";
    const notes = [delivery.special_instructions, delivery.delivery_instructions, delivery.pickup_instructions, delivery.notes].filter(Boolean).join("\n\n");
    const scheduledValue = scheduledDeliveryDateTime(delivery);
    const scheduledBlocks = clean(delivery.service_level) === "scheduled" && scheduledValue ? `
          ${detailsBlock("Scheduled Delivery", formatDateOnly(scheduledValue))}
          ${detailsBlock("Scheduled Time", formatTimeOnly(scheduledValue))}
    ` : "";
    const workflowButtons = workflowActionButtons(delivery);
    const documentButtons = documentActionButtons(delivery);

    elements.deliveryDetailsTitle.textContent = delivery.job_number || "Delivery Details";
    elements.deliveryDetailsSubtitle.textContent = `${delivery.customer_name || delivery.company_name || "Customer"} • ${getStatusLabel(delivery)}`;
    elements.deliveryDetailsBody.innerHTML = `
      <section class="details-card">
        <h4>Delivery</h4>
        <div class="details-card-body">
          ${detailsBlock("Job Number", delivery.job_number)}
          ${detailsBlock("Customer", delivery.customer_name || delivery.company_name || "-")}
          ${detailsBlock("Status", getStatusLabel(delivery))}
          ${detailsBlock("Category", getCategoryLabel(delivery.job_category))}
          ${detailsBlock("Vehicle", delivery.vehicle_type || "-")}
          ${detailsBlock("Speed", delivery.delivery_speed || delivery.service_level || "-")}
          ${scheduledBlocks}
          ${detailsBlock("Reference", delivery.reference_number || "-")}
          ${detailsBlock("Assigned Driver", assignedDriver)}
          ${detailsBlock("Driver Pay", delivery.driver_pay != null && delivery.driver_pay !== "" ? formatMoney(delivery.driver_pay) : "-")}
          ${detailsBlock("Payment", delivery.payment_status || "-")}
          ${detailsBlock("Created", formatDateTime(delivery.created_at))}
          ${detailsBlock("Updated", formatDateTime(delivery.updated_at || delivery.modified_at || delivery.created_at))}
        </div>
      </section>

      <section class="details-card">
        <h4>Addresses</h4>
        <div class="details-card-body">
          ${detailsBlock("Route", route || "-")}
          ${detailsBlock("Pickup", delivery.pickup_address)}
          ${detailsBlock("Delivery", delivery.delivery_address)}
          ${detailsBlock("Pickup Contact", [delivery.pickup_contact_name, delivery.pickup_contact_phone].filter(Boolean).join(" • "))}
          ${detailsBlock("Delivery Contact", [delivery.delivery_contact_name, delivery.delivery_contact_phone].filter(Boolean).join(" • "))}
          ${detailsBlock("Return Required", clean(delivery.return_required) === "true" || delivery.return_required === true ? "Yes" : "No")}
          ${detailsBlock("Return Address", delivery.return_address || "-")}
        </div>
      </section>

      <section class="details-card">
        <h4>Notes</h4>
        <div class="details-card-body">
          ${detailsBlock("Special Instructions", notes || "-")}
          ${detailsBlock("Created By", delivery.created_by || delivery.created_by_email || "-")}
        </div>
      </section>

      <section class="details-card">
        <h4>Workflow Actions</h4>
        <div class="details-actions-section">
          ${workflowButtons ? `<div class="details-action-grid">${workflowButtons}</div>` : '<div class="sheet-note">No workflow actions available for this delivery.</div>'}
        </div>
      </section>

      <section class="details-card">
        <h4>Documents</h4>
        <div class="details-actions-section">
          <div class="details-action-grid">${documentButtons}</div>
        </div>
      </section>
    `;
  }

  async function openDeliveryDetails(deliveryId) {
    const requestToken = ++state.deliveryDetailsRequestToken;

    elements.deliveryDetailsTitle.textContent = "Delivery Details";
    elements.deliveryDetailsSubtitle.textContent = "Loading delivery...";
    elements.deliveryDetailsBody.innerHTML = `
      <section class="details-card">
        <h4>Delivery</h4>
        <div class="details-card-body">
          <div class="empty" style="min-height:120px;padding:0;place-items:start;text-align:left;">
            <div>
              <div class="empty-title">Loading delivery...</div>
            </div>
          </div>
        </div>
      </section>
    `;
    openModal(elements.deliveryDetailsModal);

    const result = await client
      .from("quotes")
      .select("*")
      .eq("id", deliveryId)
      .maybeSingle();

    if (requestToken !== state.deliveryDetailsRequestToken) {
      return;
    }

    if (result.error || !result.data) {
      renderDeliveryDetailsModal(null, "Delivery not found.");
      return;
    }

    state.selectedDelivery = result.data;
    renderDeliveryDetailsModal(result.data);
  }

  async function requireDispatchAccess() {
    const sessionResult = await client.auth.getSession();
    const session = sessionResult.data?.session || null;
    if (!session?.user) {
      window.location.href = "/index.html";
      return null;
    }

    state.session = session;
    if (elements.staffEmail) {
      elements.staffEmail.textContent = session.user.email || "";
    }

    try {
      const profileResult = await client
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!profileResult.error) {
        state.profile = profileResult.data || null;
      }
    } catch (_error) {
      state.profile = null;
    }

    const role = clean(state.profile?.role);
    if (role && !["admin", "staff", "dispatcher"].includes(role)) {
      window.location.href = "/index.html";
      return null;
    }

    return session;
  }

  async function loadDeliveries() {
    console.log("[Deliveries] query started");
    const result = await client
      .from("quotes")
      .select("*")
      .order("created_at", { ascending: false });

    if (result.error) {
      console.error("[Deliveries] query failed", result.error);
      throw result.error;
    }

    const deliveries = result.data || [];
    console.log("[Deliveries] query completed");
    console.log("[Deliveries] rows:", deliveries?.length);
    return deliveries;
  }

  async function loadDrivers() {
    const result = await client
      .from("drivers")
      .select("*")
      .order("full_name", { ascending: true });

    if (result.error) {
      throw result.error;
    }

    return result.data || [];
  }

  function driverSummary(driver) {
    const availability = getDriverAvailability(driver);
    const name = getDriverDisplayName(driver);
    const area = driver.current_area || driver.area || driver.city || "";
    const vehicle = driver.vehicle_type || driver.vehicle_make || driver.vehicle_model || "";
    return {
      id: String(driver.id || ""),
      name,
      availability,
      area,
      vehicle,
      driver
    };
  }

  function sortDrivers(drivers) {
    const order = { available: 0, busy: 1, off_duty: 2 };
    return drivers.slice().sort((left, right) => {
      const group = (order[left.availability] || 99) - (order[right.availability] || 99);
      if (group !== 0) {
        return group;
      }
      return left.name.localeCompare(right.name);
    });
  }

  function renderAssignModal() {
    if (!state.selectedDelivery) {
      return;
    }

    const summary = state.selectedDelivery;
    const drivers = sortDrivers(
      state.drivers.map(driverSummary).filter(driver => {
        const search = state.assignSearch.trim().toLowerCase();
        const filter = state.assignFilter;
        if (filter !== "all" && driver.availability !== filter) {
          return false;
        }
        if (!search) {
          return true;
        }
        return [driver.name, driver.area, driver.vehicle].filter(Boolean).join(" ").toLowerCase().includes(search);
      })
    );

    elements.assignJobId.value = String(summary.id || "");
    elements.assignDriverSelect.value = state.assignDriverId;
    elements.assignDriverPay.value = state.assignDriverPay;

    elements.assignJobSummary.innerHTML = `
      <div class="details-kv"><strong>Job Number</strong><span>${escapeHtml(summary.job_number || "-")}</span></div>
      <div class="details-kv"><strong>Customer</strong><span>${escapeHtml(summary.customer_name || summary.company_name || "-")}</span></div>
      <div class="details-kv"><strong>Route</strong><span>${escapeHtml([summary.pickup_address, summary.delivery_address].filter(Boolean).join(" → ") || "-")}</span></div>
      <div class="details-kv"><strong>Driver Pay</strong><span><input id="assignDriverPayInput" type="number" min="0" step="0.01" value="${escapeHtml(String(state.assignDriverPay || summary.driver_pay || ""))}" placeholder="0.00"></span></div>
    `;

    const recommended = drivers.find(driver => driver.id === String(summary.assigned_driver_id || "")) || drivers.find(driver => driver.availability === "available") || drivers[0] || null;

    if (recommended) {
      elements.assignRecommendedCard.innerHTML = `
        <div class="details-card">
          <h4>Recommended Driver</h4>
          <div class="details-card-body">
            <div class="details-kv"><strong>Name</strong><span>${escapeHtml(recommended.name)}</span></div>
            <div class="details-kv"><strong>Status</strong><span>${escapeHtml(recommended.availability)}</span></div>
            <div class="details-kv"><strong>Area</strong><span>${escapeHtml(recommended.area || "-")}</span></div>
            <div class="details-kv"><strong>Vehicle</strong><span>${escapeHtml(recommended.vehicle || "-")}</span></div>
            <div class="details-inline-actions">
              <button class="action-btn" type="button" data-pick-driver="${escapeHtml(recommended.id)}">Select Recommended</button>
            </div>
          </div>
        </div>
      `;
    } else {
      elements.assignRecommendedCard.innerHTML = "";
    }

    if (!drivers.length) {
      elements.assignDriverCards.innerHTML = '<div class="empty"><div><div class="empty-title">No drivers found.</div></div></div>';
      return;
    }

    elements.assignDriverCards.innerHTML = drivers.map(driver => {
      const badgeClass = driver.availability === "available" ? "" : driver.availability === "busy" ? "return" : "stat";
      return `
        <button class="card" type="button" data-pick-driver="${escapeHtml(driver.id)}">
          <div class="card-main">
            <div class="card-topline">
              <span class="badge ${badgeClass}">${escapeHtml(driver.availability.replace("_", " "))}</span>
            </div>
            <div class="customer">${escapeHtml(driver.name)}</div>
            <div class="route">${escapeHtml([driver.area, driver.vehicle].filter(Boolean).join(" • ") || "No extra details")}</div>
          </div>
          <div class="actions">
            <span class="badge">Select</span>
          </div>
        </button>
      `;
    }).join("");
  }

  async function openAssignModal(delivery) {
    state.selectedDelivery = delivery;
    state.assignDriverId = String(delivery.assigned_driver_id || "");
    state.assignDriverPay = String(delivery.driver_pay ?? "");
    state.assignSearch = "";
    state.assignFilter = "all";

    if (elements.assignDriverSearch) {
      elements.assignDriverSearch.value = "";
    }
    if (elements.assignDriverFilter) {
      elements.assignDriverFilter.value = "all";
    }

    if (!state.drivers.length) {
      try {
        state.drivers = await loadDrivers();
      } catch (error) {
        showToast(error.message || "Unable to load drivers", "error");
        return;
      }
    }

    renderAssignModal();
    openModal(elements.assignModal);
  }

  async function saveAssignment() {
    const driverId = String(state.assignDriverId || elements.assignDriverSelect.value || "").trim();
    await assignDriverToDelivery(driverId, null);
  }

  function resolveSelectedDeliveryForAssignment() {
    const selectedId = String(state.selectedDelivery?.id || elements.assignJobId?.value || "").trim();
    if (!selectedId) {
      return null;
    }

    return state.deliveries.find(item => String(item.id || "") === selectedId)
      || state.selectedDelivery
      || null;
  }

  function setAssignButtonsState(assigning, triggerButton) {
    const assignButtons = elements.assignModal.querySelectorAll("[data-pick-driver]");
    assignButtons.forEach(button => {
      button.disabled = assigning;
    });

    if (elements.assignSubmitBtn) {
      elements.assignSubmitBtn.disabled = assigning;
      elements.assignSubmitBtn.textContent = assigning ? "Assigning..." : "Assign Driver";
    }

    if (elements.assignConfirmBtn) {
      elements.assignConfirmBtn.disabled = assigning;
      elements.assignConfirmBtn.textContent = assigning ? "Assigning..." : "Confirm Assignment";
    }

    if (triggerButton) {
      triggerButton.textContent = assigning ? "Assigning..." : (triggerButton.dataset.originalLabel || triggerButton.textContent);
    }
  }

  async function assignDriverToDelivery(driverId, triggerButton) {
    if (state.isAssigning) {
      return;
    }

    const delivery = resolveSelectedDeliveryForAssignment();
    const selectedDriverId = String(driverId || "").trim();
    const payInput = document.getElementById("assignDriverPayInput");
    const payValue = String(payInput?.value || state.assignDriverPay || elements.assignDriverPay.value || "").trim();

    console.log("[MG Assign] delivery id:", String(delivery?.id || ""));
    console.log("[MG Assign] driver clicked:", selectedDriverId);
    console.log("[MG Assign] driver pay:", payValue);

    if (!delivery?.id) {
      showToast("Unable to assign driver.", "error");
      return;
    }

    if (!selectedDriverId) {
      showToast("Select a driver first.", "error");
      return;
    }

    const driverPay = Number(payValue);
    if (payValue === "" || !Number.isFinite(driverPay) || driverPay < 0) {
      showToast("Enter a valid driver pay amount.", "error");
      return;
    }

    const confirmed = window.confirm(`Assign ${delivery.job_number || "this delivery"} to the selected driver?`);
    if (!confirmed) {
      return;
    }

    state.isAssigning = true;
    state.assignDriverId = selectedDriverId;
    state.assignDriverPay = payValue;

    if (triggerButton) {
      triggerButton.dataset.originalLabel = triggerButton.dataset.originalLabel || triggerButton.textContent;
    }

    setAssignButtonsState(true, triggerButton);

    try {
      const result = await client
        .from("quotes")
        .update({
          assigned_driver_id: selectedDriverId,
          driver_pay: driverPay,
          status: "assigned",
          driver_acceptance_status: "pending",
          driver_workflow_status: "assigned",
          driver_accepted_at: null,
          driver_rejected_at: null
        })
        .eq("id", delivery.id)
        .select("*")
        .maybeSingle();

      if (result.error) {
        throw result.error;
      }

      closeModal(elements.assignModal);
      showToast("Driver assigned successfully.", "success");
      await refreshDeliveries({ keepSelection: delivery.id });
      await openDeliveryDetails(delivery.id);
    } catch (error) {
      console.error("[MG Assign] assignment update failed", error);
      showToast("Unable to assign driver.", "error");
    } finally {
      state.isAssigning = false;
      setAssignButtonsState(false, triggerButton);
    }
  }

  async function markReady(deliveryId) {
    const delivery = state.deliveries.find(item => String(item.id) === String(deliveryId));
    if (!delivery) {
      return;
    }

    const confirmed = window.confirm(`Mark ${delivery.job_number || "this delivery"} as Ready to Dispatch?`);
    if (!confirmed) {
      return;
    }

    const result = await client
      .from("quotes")
      .update({ status: "ready" })
      .eq("id", deliveryId)
      .select("*")
      .maybeSingle();

    if (result.error) {
      throw result.error;
    }

    showToast("Delivery moved to Ready to Dispatch.", "success");
    await refreshDeliveries({ keepSelection: deliveryId });
  }

  async function markPaid(deliveryId) {
    const delivery = state.deliveries.find(item => String(item.id) === String(deliveryId));
    if (!delivery) {
      return;
    }

    const confirmed = window.confirm(`Confirm payment has been received for ${delivery.job_number || "this delivery"}?`);
    if (!confirmed) {
      return;
    }

    const result = await client
      .from("quotes")
      .update({ payment_status: "paid", status: "ready" })
      .eq("id", deliveryId)
      .select("*")
      .maybeSingle();

    if (result.error) {
      throw result.error;
    }

    showToast("Payment marked as received.", "success");
    await refreshDeliveries({ keepSelection: deliveryId });
  }

  async function cancelDelivery(deliveryId) {
    const delivery = state.deliveries.find(item => String(item.id) === String(deliveryId));
    if (!delivery) {
      return;
    }

    const confirmed = window.confirm(`Cancel ${delivery.job_number || "this delivery"}?`);
    if (!confirmed) {
      return;
    }

    const result = await client
      .from("quotes")
      .update({ status: "cancelled" })
      .eq("id", deliveryId)
      .select("*")
      .maybeSingle();

    if (result.error) {
      throw result.error;
    }

    showToast("Delivery cancelled.", "success");
    await refreshDeliveries({ keepSelection: deliveryId });
  }

  function openBol(deliveryId) {
    const id = String(deliveryId || "").trim();
    if (!id) {
      showToast("Unable to open BOL: missing delivery id.", "error");
      return;
    }

    window.open(`/bol.html?id=${encodeURIComponent(id)}`, "_blank");
  }

  function openInvoice(deliveryId) {
    const id = String(deliveryId || "").trim();
    if (!id) {
      showToast("Unable to open invoice: missing delivery id.", "error");
      return;
    }

    window.open(`/invoice.html?id=${encodeURIComponent(id)}`, "_blank");
  }

  async function copyDeliveryLink(delivery) {
    const link = new URL(`bol.html?id=${encodeURIComponent(String(delivery.id || ""))}`, window.location.href).toString();
    try {
      await navigator.clipboard.writeText(link);
      showToast("Job link copied.", "success");
    } catch (_error) {
      showToast("Unable to copy link on this device.", "error");
    }
  }

  async function handleDeliveryListClick(event) {
    const target = event.target;

    const card = target.closest("[data-delivery-id]");
    if (card) {
      const deliveryId = String(card.getAttribute("data-delivery-id") || "").trim();
      if (deliveryId) {
        openDeliveryDetails(deliveryId).catch(error => {
          renderDeliveryDetailsModal(null, error.message || "Delivery not found.");
        });
      }
      return;
    }

    const pickDriver = target.closest("[data-pick-driver]");
    if (pickDriver) {
      const selectedDriverId = String(pickDriver.getAttribute("data-pick-driver") || "").trim();
      if (selectedDriverId) {
        state.assignDriverId = selectedDriverId;
        renderAssignModal();
      }
      return;
    }
  }

  function handleDeliveryDetailsAction(action, delivery) {
    if (!delivery) {
      return;
    }

    if (action === "assign") {
      closeModal(elements.deliveryDetailsModal);
      openAssignModal(delivery).catch(error => showToast(error.message || "Unable to open assign driver.", "error"));
      return;
    }

    if (action === "ready") {
      markReady(delivery.id).catch(error => showToast(error.message || "Unable to mark ready.", "error"));
      return;
    }

    if (action === "paid") {
      markPaid(delivery.id).catch(error => showToast(error.message || "Unable to mark paid.", "error"));
      return;
    }

    if (action === "cancel") {
      cancelDelivery(delivery.id).catch(error => showToast(error.message || "Unable to cancel delivery.", "error"));
      return;
    }

    if (action === "bol") {
      openBol(delivery.id);
      return;
    }

    if (action === "invoice") {
      openInvoice(delivery.id);
    }
  }

  function handleDeliveryDetailsModalClick(event) {
    const actionButton = event.target.closest("[data-details-action]");
    if (actionButton) {
      const deliveryId = String(actionButton.getAttribute("data-delivery-id") || state.selectedDelivery?.id || "");
      const delivery = state.deliveries.find(item => String(item.id || "") === deliveryId) || state.selectedDelivery;
      handleDeliveryDetailsAction(String(actionButton.getAttribute("data-details-action") || ""), delivery);
      return;
    }

    if (event.target === elements.deliveryDetailsModal || event.target.closest("[data-close-delivery-details]")) {
      closeModal(elements.deliveryDetailsModal);
    }
  }

  async function refreshDeliveries(options = {}) {
    const keepSelection = options.keepSelection || null;
    elements.deliveryList.innerHTML = `
      <div class="empty"><div><div class="empty-title">Loading deliveries...</div></div></div>
    `;

    try {
      const deliveries = await loadDeliveries();
      try {
        state.drivers = await loadDrivers();
      } catch (driverError) {
        console.error("Unable to load drivers for delivery display", driverError);
      }
      state.deliveries = deliveries;
      state.loadError = "";
      renderCategories();
      renderDeliveries();

      if (keepSelection) {
        const selection = state.deliveries.find(item => String(item.id) === String(keepSelection));
        if (selection) {
          state.selectedDelivery = selection;
          if (elements.deliveryDetailsModal.classList.contains("open")) {
            renderDeliveryDetailsModal(selection);
          }
        }
      }
    } catch (error) {
      console.error("[Deliveries] refresh failed", error);
      state.deliveries = [];
      state.loadError = error.message || "Unable to load deliveries.";
      elements.deliveryList.innerHTML = `
        <div class="empty"><div><div class="empty-title">Unable to load deliveries.</div><div class="empty-copy">${escapeHtml(state.loadError)}</div></div></div>
      `;
      showToast(state.loadError, "error");
    }
  }

  function bindEvents() {
    elements.searchInput.addEventListener("input", () => {
      state.search = elements.searchInput.value || "";
      renderCategories();
      renderDeliveries();
    });

    if (elements.statusFilter) {
      elements.statusFilter.addEventListener("change", renderDeliveries);
    }

    elements.sortSelect.addEventListener("change", () => {
      state.sort = elements.sortSelect.value;
      renderDeliveries();
    });

    elements.refreshButton.addEventListener("click", () => {
      refreshDeliveries({ keepSelection: state.selectedDelivery?.id || null });
    });

    elements.newDeliveryButton.addEventListener("click", () => {
      window.location.href = "request.html";
    });

    elements.categoryFilters.addEventListener("click", event => {
      const button = event.target.closest("[data-category]");
      if (!button) {
        return;
      }
      state.activeCategory = button.getAttribute("data-category") || "all";
      renderCategories();
      renderDeliveries();
    });

    elements.deliveryList.removeEventListener("click", handleDeliveryListClick);
    elements.deliveryList.addEventListener("click", handleDeliveryListClick);
    elements.deliveryList.addEventListener("keydown", event => {
      const card = event.target.closest("[data-delivery-id]");
      if (!card) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDeliveryDetails(card.getAttribute("data-delivery-id")).catch(error => {
          renderDeliveryDetailsModal(null, error.message || "Delivery not found.");
        });
      }
    });

    elements.deliveryDetailsModal.removeEventListener("click", handleDeliveryDetailsModalClick);
    elements.deliveryDetailsModal.addEventListener("click", handleDeliveryDetailsModalClick);

    elements.newDeliveryModal.addEventListener("click", event => {
      if (event.target === elements.newDeliveryModal || event.target.closest("[data-close-modal='newDeliveryModal']")) {
        closeModal(elements.newDeliveryModal);
      }
    });

    elements.assignModal.addEventListener("click", event => {
      if (event.target === elements.assignModal || event.target.closest("[data-close-modal='assignModal']")) {
        closeModal(elements.assignModal);
        return;
      }

      const pickDriver = event.target.closest("[data-pick-driver]");
      if (pickDriver) {
        const selectedDriverId = String(pickDriver.getAttribute("data-pick-driver") || "").trim();
        const buttonLabel = clean(pickDriver.textContent || "");
        if (buttonLabel.includes("recommended")) {
          console.log("[MG Assign] recommended clicked");
        }

        state.assignDriverId = selectedDriverId;
        state.assignDriverPay = String(document.getElementById("assignDriverPayInput")?.value || state.assignDriverPay || "");
        assignDriverToDelivery(selectedDriverId, pickDriver).catch(error => {
          console.error("[MG Assign] assign click handler failed", error);
          showToast("Unable to assign driver.", "error");
        });
      }
    });

    elements.assignDriverSearch.addEventListener("input", () => {
      state.assignSearch = elements.assignDriverSearch.value || "";
      renderAssignModal();
    });

    elements.assignDriverFilter.addEventListener("change", () => {
      state.assignFilter = elements.assignDriverFilter.value || "all";
      renderAssignModal();
    });

    elements.assignForm.addEventListener("submit", event => {
      event.preventDefault();
      saveAssignment().catch(error => showToast(error.message || "Unable to assign driver.", "error"));
    });

    elements.assignConfirmBtn.addEventListener("click", () => {
      saveAssignment().catch(error => showToast(error.message || "Unable to assign driver.", "error"));
    });

    elements.rejectedReturnConfirmBtn.addEventListener("click", () => {
      closeModal(elements.rejectedReturnConfirmModal);
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        closeModal(elements.deliveryDetailsModal);
        closeModal(elements.assignModal);
        closeModal(elements.newDeliveryModal);
        closeModal(elements.assignConfirmModal);
        closeModal(elements.rejectedReturnConfirmModal);
      }
    });
  }

  async function boot() {
    console.log("[Deliveries] init started");
    const session = await requireDispatchAccess();
    if (!session) {
      return;
    }

    console.log("[Deliveries] auth ready");

    if (elements.statusFilter) {
      elements.statusFilter.value = readInitialTabFromUrl();
    }
    bindEvents();
    renderCategories();
    await refreshDeliveries();
  }

  boot().catch(error => {
    console.error("[Deliveries] boot failed", error);
    showToast(error.message || "Unable to start Deliveries v2.", "error");
    elements.deliveryList.innerHTML = `
      <div class="empty"><div><div class="empty-title">Unable to start Deliveries v2.</div><div class="empty-copy">${escapeHtml(error.message || "Unknown error")}</div></div></div>
    `;
  });
})();