const client = supabase.createClient(
  "https://dczlucwfjayymlwbzzdi.supabase.co",
  "sb_publishable_kcv_a78ZyUxMo2neKUANdw_XN7eAMpI"
);

window.mgDispatchClient = client;

const MODE_CONFIG = {
  pending_approval: {
    title: "Pending Approval",
    subtitle: "Waiting payment or approval",
    emptyText: "No deliveries pending approval.",
    sectionTitle: "Deliveries Waiting Approval",
    showCustomerSearch: true,
    showJobSearch: true,
    showRefresh: true,
    filterOptions: [
      { value: "all", label: "All" },
      { value: "waiting_payment", label: "Waiting Payment" },
      { value: "pending", label: "Pending" }
    ]
  },
  ready_to_dispatch: {
    title: "Ready to Dispatch",
    subtitle: "Ready for driver assignment",
    emptyText: "No deliveries ready to dispatch.",
    sectionTitle: "Ready for Driver Assignment",
    showCustomerSearch: false,
    showJobSearch: false,
    showRefresh: false,
    filterOptions: [
      { value: "all", label: "All" },
      { value: "unassigned", label: "Unassigned" },
      { value: "assigned", label: "Already Assigned" }
    ]
  },
  assigned: {
    title: "Assigned",
    subtitle: "Grouped by driver",
    emptyText: "No assigned deliveries.",
    sectionTitle: "Assigned by Driver",
    showCustomerSearch: false,
    showJobSearch: false,
    showRefresh: false,
    filterOptions: [
      { value: "all", label: "All" },
      { value: "accepted", label: "Accepted" },
      { value: "pending", label: "Awaiting Driver Response" }
    ]
  },
  closed_today: {
    title: "Closed Today",
    subtitle: "Completed deliveries for today",
    emptyText: "No deliveries closed today.",
    sectionTitle: "Closed Deliveries Today",
    showCustomerSearch: false,
    showJobSearch: false,
    showRefresh: false,
    filterOptions: [
      { value: "all", label: "All" },
      { value: "delivered", label: "Delivered" },
      { value: "cancelled", label: "Cancelled" }
    ]
  }
};

const workspaceMode = String(document.body.dataset.workspace || "pending_approval").trim();
const modeConfig = MODE_CONFIG[workspaceMode] || MODE_CONFIG.pending_approval;

const state = {
  drivers: [],
  rows: [],
  rejectedRows: [],
  recurringCustomers: [],
  customerDeliveryCounts: {},
  supportsEstimatedMiles: null,
  selectedJob: null,
  pendingAssignment: null,
  pendingRejectedReturnJobId: "",
  assignDriverFocusId: "",
  assignDriverFocusName: "",
  hasShownAssignFocusToast: false
};

const elements = {
  staffEmail: document.getElementById("staffEmail"),
  pageTitle: document.getElementById("pageTitle"),
  pageSubtitle: document.getElementById("pageSubtitle"),
  sectionTitle: document.getElementById("sectionTitle"),
  visibleCount: document.getElementById("visibleCount"),
  rowsHost: document.getElementById("rowsHost"),
  rejectedSection: document.getElementById("rejectedSection"),
  rejectedCount: document.getElementById("rejectedCount"),
  rejectedRows: document.getElementById("rejectedRows"),
  searchInput: document.getElementById("searchInput"),
  customerSearchInput: document.getElementById("customerSearchInput"),
  jobSearchInput: document.getElementById("jobSearchInput"),
  statusFilter: document.getElementById("statusFilter"),
  sortBy: document.getElementById("sortBy"),
  refreshBtn: document.getElementById("refreshBtn"),
  customerSearchField: document.getElementById("customerSearchField"),
  jobSearchField: document.getElementById("jobSearchField"),
  refreshWrap: document.getElementById("refreshWrap"),
  jobModal: document.getElementById("jobModal"),
  jobForm: document.getElementById("jobForm"),
  jobCustomerAccountId: document.getElementById("jobCustomerAccountId"),
  customerLookupInput: document.getElementById("customerLookupInput"),
  customerLookupResults: document.getElementById("customerLookupResults"),
  newDeliveryReviewList: document.getElementById("newDeliveryReviewList"),
  saveJobBtn: document.getElementById("saveJobBtn"),
  jobDetailsModal: document.getElementById("jobDetailsModal"),
  jobDetailsBody: document.getElementById("jobDetailsBody"),
  assignModal: document.getElementById("assignModal"),
  assignForm: document.getElementById("assignForm"),
  assignJobId: document.getElementById("assignJobId"),
  assignDriverSelect: document.getElementById("assignDriverSelect"),
  assignDriverPay: document.getElementById("assignDriverPay"),
  assignDriverSearch: document.getElementById("assignDriverSearch"),
  assignDriverFilter: document.getElementById("assignDriverFilter"),
  assignDriverCards: document.getElementById("assignDriverCards"),
  assignRecommendedCard: document.getElementById("assignRecommendedCard"),
  assignJobSummary: document.getElementById("assignJobSummary"),
  assignConfirmModal: document.getElementById("assignConfirmModal"),
  assignConfirmText: document.getElementById("assignConfirmText"),
  assignConfirmBtn: document.getElementById("assignConfirmBtn"),
  rejectedReturnConfirmModal: document.getElementById("rejectedReturnConfirmModal"),
  rejectedReturnConfirmText: document.getElementById("rejectedReturnConfirmText"),
  rejectedReturnConfirmBtn: document.getElementById("rejectedReturnConfirmBtn"),
  assignSubmitBtn: document.getElementById("assignSubmitBtn"),
  toastWrap: document.getElementById("toastWrap")
};

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function clean(value) {
  return String(value || "").trim().toLowerCase();
}

function emailUsernameFallback(email) {
  const text = String(email || "").trim();
  if (!text.includes("@")) {
    return "Driver";
  }

  const localPart = text.split("@")[0].replace(/[._-]+/g, " ").trim();
  return localPart || "Driver";
}

function parseMetadataObject(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "object") {
    return value;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }

  return null;
}

function driverDisplayName(driver) {
  if (!driver) {
    return "Driver";
  }

  const direct = String(driver.full_name || driver.display_name || "").trim();
  if (direct) {
    return direct;
  }

  const metadata =
    parseMetadataObject(driver.raw_user_meta_data) ||
    parseMetadataObject(driver.user_metadata) ||
    parseMetadataObject(driver.auth_metadata);

  const metaName = String(metadata?.full_name || metadata?.name || metadata?.display_name || "").trim();
  if (metaName) {
    return metaName;
  }

  return emailUsernameFallback(driver.email || "");
}

function isDriverActiveFlag(driver) {
  const activeFlag = driver.active ?? driver.is_active ?? driver.enabled;
  if (activeFlag === false) {
    return false;
  }

  const text = clean(driver.status || driver.availability_status);
  if (["inactive", "offline", "off_duty", "disabled"].includes(text)) {
    return false;
  }

  return true;
}

function readAssignDriverFocusFromQuery() {
  const params = new URLSearchParams(window.location.search || "");
  const id = String(params.get("assignDriverId") || params.get("driverId") || "").trim();
  const name = String(params.get("assignDriverName") || "").trim();

  state.assignDriverFocusId = id;
  state.assignDriverFocusName = name;
}

function money(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "-";
  }

  return number.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseCity(address) {
  const text = String(address || "").trim();
  if (!text) {
    return "Unknown";
  }

  const parts = text.split(",").map(part => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }

  return parts[0] || "Unknown";
}

function hasPaymentReceived(job) {
  return ["paid", "received", "completed"].includes(clean(job.payment_status));
}

function isDeliveryCompleted(job) {
  const status = clean(job.status);
  const flow = clean(job.driver_workflow_status);
  return ["completed", "delivered"].includes(status) || flow === "complete_delivery";
}

function isClosedStatus(job) {
  return ["cancelled", "canceled", "closed", "completed", "delivered"].includes(clean(job.status));
}

function getWorkflowStage(job) {
  if (isClosedStatus(job) || isDeliveryCompleted(job)) {
    return "closed";
  }

  const status = clean(job.status);
  const flow = clean(job.driver_workflow_status);

  if (["assigned", "in_progress"].includes(status) || flow) {
    return "assigned";
  }

  if (["ready", "ready_to_dispatch", "paid"].includes(status) || hasPaymentReceived(job)) {
    return "ready_to_dispatch";
  }

  return "pending_approval";
}

function isClosedToday(job) {
  if (!isDeliveryCompleted(job)) {
    return false;
  }

  const completed = parseDate(job.completed_at || job.updated_at || job.created_at);
  if (!completed) {
    return false;
  }

  const start = startOfToday().getTime();
  const end = start + (24 * 60 * 60 * 1000);
  const time = completed.getTime();
  return time >= start && time < end;
}

function statusLabel(jobOrStatus) {
  if (typeof jobOrStatus === "object" && jobOrStatus) {
    const stage = getWorkflowStage(jobOrStatus);
    if (stage === "pending_approval") {
      return "PENDING APPROVAL";
    }
    if (stage === "ready_to_dispatch") {
      return "READY TO DISPATCH";
    }
    if (stage === "assigned") {
      return "ASSIGNED";
    }
    return "COMPLETED";
  }

  return String(jobOrStatus || "UNKNOWN").replaceAll("_", " ").toUpperCase();
}

function badgeClass(jobOrStatus) {
  if (typeof jobOrStatus !== "object" || !jobOrStatus) {
    return "badge badge-new";
  }

  const stage = getWorkflowStage(jobOrStatus);
  if (stage === "pending_approval") {
    return "badge badge-new";
  }
  if (stage === "ready_to_dispatch") {
    return "badge badge-ready";
  }
  if (stage === "assigned") {
    return "badge badge-assigned";
  }

  return "badge badge-cancel";
}

function driverNameById(driverId) {
  const id = String(driverId || "");
  const driver = state.drivers.find(item => String(item.id) === id);
  if (!driver) {
    return "Unassigned";
  }

  return driverDisplayName(driver);
}

function driverWorkflowLabel(job) {
  const flow = clean(job.driver_workflow_status);
  const accepted = clean(job.driver_acceptance_status);

  if (!job.assigned_driver_id) {
    return "Not assigned";
  }

  if (accepted === "accepted" && !flow) {
    return "Accepted";
  }

  if (accepted === "pending" && (!flow || flow === "assigned")) {
    return "Waiting for driver response";
  }

  const labelMap = {
    assigned: "Waiting for driver response",
    en_route_pickup: "En Route to Pickup",
    arrived_pickup: "At Pickup",
    picked_up: "Picked Up",
    en_route_delivery: "En Route to Delivery",
    arrived_delivery: "At Delivery",
    complete_delivery: "Completed"
  };

  return labelMap[flow] || String(flow || accepted || "-").replaceAll("_", " ");
}

function deliverySpeedLabel(value) {
  const map = {
    "2_hr": "2 Hour",
    "3_hr": "3 Hour",
    "4_hr": "4 Hour",
    "5_hr": "5 Hour",
    "6_hr": "6 Hour",
    next_day: "Next Day"
  };

  return map[value] || String(value || "Not set");
}

function displayNameFromEmail(email) {
  const local = String(email || "").split("@")[0] || "Dispatch";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Dispatch";
}

function setHeader(email) {
  const name = displayNameFromEmail(email);
  elements.pageTitle.textContent = modeConfig.title;
  elements.pageSubtitle.textContent = "Workspace for " + name + " • " + modeConfig.subtitle;
  elements.sectionTitle.textContent = modeConfig.sectionTitle;
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = "toast " + type;
  toast.textContent = message;
  elements.toastWrap.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 2800);
}

function setButtonLoading(button, isLoading, loadingText, idleText) {
  if (!button) {
    return;
  }

  button.disabled = Boolean(isLoading);
  button.textContent = isLoading ? loadingText : idleText;
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) {
    return;
  }

  modal.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) {
    return;
  }

  modal.classList.remove("open");
  if (![...document.querySelectorAll(".modal-backdrop.open")].length) {
    document.body.style.overflow = "";
  }
}

function closeAllMenus() {
  document.querySelectorAll(".row-menu.open").forEach(menu => {
    menu.classList.remove("open");
  });
}

function toggleMenu(button) {
  const menu = button.closest(".row-menu");
  if (!menu) {
    return;
  }

  const willOpen = !menu.classList.contains("open");
  closeAllMenus();
  if (willOpen) {
    menu.classList.add("open");
  }
}

async function requireDispatchAccess() {
  const sessionResult = await client.auth.getSession();
  const session = sessionResult.data.session;

  if (!session) {
    location.replace("/index.html");
    return null;
  }

  elements.staffEmail.textContent = session.user.email || "";
  setHeader(session.user.email || "");

  const profileResult = await client
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .maybeSingle();

  if (profileResult.error || !profileResult.data) {
    throw new Error(profileResult.error?.message || "No MG Express profile was found.");
  }

  const role = clean(profileResult.data.role);
  if (!["admin", "staff", "dispatcher"].includes(role)) {
    if (role === "driver") {
      location.replace("/driver.html");
      return null;
    }

    if (role === "customer") {
      location.replace("/customer.html");
      return null;
    }

    throw new Error("This account does not have dispatch access.");
  }

  return session;
}

async function loadDrivers() {
  const result = await client
    .from("drivers")
    .select("*")
    .order("full_name", { ascending: true });

  if (result.error) {
    throw result.error;
  }

  state.drivers = result.data || [];
  populateDriverSelects();
}

async function loadRecurringCustomers() {
  const customerResult = await client
    .from("customer_portal_accounts")
    .select("id,customer_name,company_name,email,phone,is_recurring_customer")
    .eq("is_recurring_customer", true)
    .order("customer_name", { ascending: true });

  if (customerResult.error) {
    throw customerResult.error;
  }

  state.recurringCustomers = customerResult.data || [];
}

function buildCustomerDeliveryCounts() {
  const counts = {};
  state.rows.forEach(row => {
    const key = String(row.customer_account_id || "").trim();
    if (!key) {
      return;
    }

    counts[key] = (counts[key] || 0) + 1;
  });

  state.customerDeliveryCounts = counts;
}

function buildAutomatedStatusPayload(job) {
  const current = clean(job.status);
  const target = {};

  if (["cancelled", "canceled", "closed", "assigned", "completed", "delivered"].includes(current)) {
    return target;
  }

  if (hasPaymentReceived(job) && !["ready", "paid"].includes(current)) {
    target.status = "ready";
    return target;
  }

  if (["new", "pending", "pending_approval", ""].includes(current)) {
    target.status = "waiting_payment";
  }

  return target;
}

async function syncAutomatedStatuses(rows) {
  const updates = rows
    .map(row => ({ id: row.id, payload: buildAutomatedStatusPayload(row) }))
    .filter(item => Object.keys(item.payload).length);

  if (!updates.length) {
    return false;
  }

  for (const item of updates) {
    const result = await client
      .from("quotes")
      .update(item.payload)
      .eq("id", item.id);

    if (result.error) {
      throw result.error;
    }
  }

  return true;
}

async function loadRows() {
  const result = await client
    .from("quotes")
    .select("*")
    .order("created_at", { ascending: false });

  if (result.error) {
    throw result.error;
  }

  state.rows = result.data || [];

  const changed = await syncAutomatedStatuses(state.rows);
  if (changed) {
    const refresh = await client
      .from("quotes")
      .select("*")
      .order("created_at", { ascending: false });

    if (refresh.error) {
      throw refresh.error;
    }

    state.rows = refresh.data || [];
  }

  if (workspaceMode === "assigned") {
    await loadRejectedJobs();
  }

  buildCustomerDeliveryCounts();
  renderWorkspace();
}

async function loadRejectedJobs() {
  const result = await client
    .from("quotes")
    .select("*")
    .eq("driver_acceptance_status", "rejected")
    .not("assigned_driver_id", "is", null)
    .order("driver_rejected_at", { ascending: false });

  if (result.error) {
    throw result.error;
  }

  state.rejectedRows = (result.data || []).filter(row => {
    return !isClosedStatus(row) && !isDeliveryCompleted(row);
  });
}

function filterRowsByMode() {
  if (workspaceMode === "pending_approval") {
    return state.rows.filter(row => getWorkflowStage(row) === "pending_approval");
  }

  if (workspaceMode === "ready_to_dispatch") {
    return state.rows.filter(row => getWorkflowStage(row) === "ready_to_dispatch");
  }

  if (workspaceMode === "assigned") {
    return state.rows.filter(row => {
      return getWorkflowStage(row) === "assigned" && clean(row.driver_acceptance_status) !== "rejected";
    });
  }

  return state.rows.filter(isClosedToday);
}

function applyFilters(rows) {
  const q = clean(elements.searchInput.value);
  const customerQ = clean(elements.customerSearchInput.value);
  const jobQ = clean(elements.jobSearchInput.value);
  const statusFilter = String(elements.statusFilter.value || "all");

  return rows.filter(row => {
    const hay = [
      row.job_number,
      row.customer_name,
      row.customer_email,
      row.customer_phone,
      row.pickup_address,
      row.delivery_address,
      driverNameById(row.assigned_driver_id)
    ].filter(Boolean).join(" ").toLowerCase();

    if (q && !hay.includes(q)) {
      return false;
    }

    if (customerQ && !String(row.customer_name || "").toLowerCase().includes(customerQ)) {
      return false;
    }

    if (jobQ && !String(row.job_number || "").toLowerCase().includes(jobQ)) {
      return false;
    }

    if (workspaceMode === "pending_approval" && statusFilter !== "all") {
      const status = clean(row.status);
      if (statusFilter === "waiting_payment" && status !== "waiting_payment") {
        return false;
      }
      if (statusFilter === "pending" && !["pending", "new", "pending_approval"].includes(status)) {
        return false;
      }
    }

    if (workspaceMode === "ready_to_dispatch" && statusFilter !== "all") {
      const hasDriver = Boolean(row.assigned_driver_id);
      if (statusFilter === "unassigned" && hasDriver) {
        return false;
      }
      if (statusFilter === "assigned" && !hasDriver) {
        return false;
      }
    }

    if (workspaceMode === "assigned" && statusFilter !== "all") {
      const acceptance = clean(row.driver_acceptance_status || "pending");
      if (statusFilter === "accepted" && acceptance !== "accepted") {
        return false;
      }
      if (statusFilter === "pending" && acceptance !== "pending") {
        return false;
      }
    }

    if (workspaceMode === "closed_today" && statusFilter !== "all") {
      const status = clean(row.status);
      if (statusFilter === "delivered" && !["delivered", "completed"].includes(status)) {
        return false;
      }
      if (statusFilter === "cancelled" && !["cancelled", "canceled"].includes(status)) {
        return false;
      }
    }

    return true;
  });
}

function sortRows(rows) {
  const sortBy = String(elements.sortBy.value || "updated_desc");
  const sorted = rows.slice();

  sorted.sort((a, b) => {
    if (sortBy === "job_asc") {
      return String(a.job_number || "").localeCompare(String(b.job_number || ""));
    }

    if (sortBy === "job_desc") {
      return String(b.job_number || "").localeCompare(String(a.job_number || ""));
    }

    if (sortBy === "customer_asc") {
      return String(a.customer_name || "").localeCompare(String(b.customer_name || ""));
    }

    const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
    const bTime = new Date(b.updated_at || b.created_at || 0).getTime();

    if (sortBy === "updated_asc") {
      return aTime - bTime;
    }

    return bTime - aTime;
  });

  return sorted;
}

function renderCompactRows(rows, readOnly) {
  if (!rows.length) {
    elements.rowsHost.innerHTML = `<div class="empty">${escapeHtml(modeConfig.emptyText)}</div>`;
    return;
  }

  elements.rowsHost.innerHTML = rows.map(row => {
    const closedActions = workspaceMode === "closed_today"
      ? `
        <div class="closed-actions" data-prevent-row-open="true">
          <button class="mini" type="button" data-view-bol="${escapeHtml(String(row.id))}">Print BOL</button>
          <button class="mini" type="button" data-send-invoice="${escapeHtml(String(row.id))}">Invoice</button>
          <button class="mini" type="button" data-open-job-inline="${escapeHtml(String(row.id))}">View Details</button>
        </div>
      `
      : "";

    return `
      <div class="row" data-open-job="${escapeHtml(String(row.id))}" data-readonly="${readOnly ? "true" : "false"}" tabindex="0" role="button">
        <span class="row-main">
          <span class="row-topline">
            <span class="row-id">${escapeHtml(row.job_number || "Delivery")}</span>
            <span class="badge ${escapeHtml(badgeClass(row))}">${escapeHtml(statusLabel(row))}</span>
          </span>
          <span class="row-customer">${escapeHtml(row.customer_name || "Customer")}</span>
          <span class="row-meta">${escapeHtml(parseCity(row.pickup_address))} -> ${escapeHtml(parseCity(row.delivery_address))}</span>
          <span class="row-meta">${escapeHtml(driverNameById(row.assigned_driver_id))} • ${escapeHtml(money(row.approved_price ?? row.customer_charge))} • ${escapeHtml(formatDateTime(row.updated_at || row.created_at))}</span>
          ${closedActions}
        </span>
        <span class="row-chevron">›</span>
      </div>
    `;
  }).join("");
}

function renderAssignedGroupedRows(rows) {
  if (!rows.length) {
    elements.rowsHost.innerHTML = '<div class="empty">No assigned deliveries.</div>';
    return;
  }

  const groups = {};
  rows.forEach(row => {
    const driverKey = String(row.assigned_driver_id || "unassigned");
    if (!groups[driverKey]) {
      groups[driverKey] = [];
    }
    groups[driverKey].push(row);
  });

  const groupKeys = Object.keys(groups).sort((a, b) => {
    return driverNameById(a).localeCompare(driverNameById(b));
  });

  elements.rowsHost.innerHTML = groupKeys.map(driverId => {
    const deliveries = groups[driverId];
    const driverName = driverNameById(driverId);

    return `
      <details class="assigned-driver-group">
        <summary>
          <span class="assigned-driver-name">${escapeHtml(driverName)}</span>
          <span class="assigned-driver-count">${escapeHtml(String(deliveries.length))} deliveries</span>
        </summary>
        <div class="rows">
          ${deliveries.map(row => `
            <div class="row" data-open-job="${escapeHtml(String(row.id))}" tabindex="0" role="button">
              <span class="row-main">
                <span class="row-topline">
                  <span class="row-id">${escapeHtml(row.job_number || "Delivery")}</span>
                  <span class="badge ${escapeHtml(badgeClass(row))}">${escapeHtml(statusLabel(row))}</span>
                </span>
                <span class="row-customer">${escapeHtml(row.customer_name || "Customer")}</span>
                <span class="row-meta">${escapeHtml(parseCity(row.pickup_address))} -> ${escapeHtml(parseCity(row.delivery_address))}</span>
                <span class="row-meta">${escapeHtml(String(row.driver_acceptance_status || "pending").toUpperCase())} • ${escapeHtml(driverWorkflowLabel(row))}</span>
              </span>
              <span class="row-chevron">›</span>
            </div>
          `).join("")}
        </div>
      </details>
    `;
  }).join("");
}

function renderRejectedRows() {
  if (!elements.rejectedSection) {
    return;
  }

  if (workspaceMode !== "assigned") {
    elements.rejectedSection.style.display = "none";
    return;
  }

  elements.rejectedSection.style.display = "";
  elements.rejectedCount.textContent = String(state.rejectedRows.length);

  if (!state.rejectedRows.length) {
    elements.rejectedRows.innerHTML = '<div class="rejected-empty">No rejected jobs.</div>';
    return;
  }

  elements.rejectedRows.innerHTML = state.rejectedRows.map(row => {
    const driverName = driverNameById(row.assigned_driver_id);
    return `
      <div class="rejected-row" data-open-job="${escapeHtml(String(row.id))}" role="button" tabindex="0">
        <div class="rejected-main">
          <div class="rejected-topline">
            <span class="row-id">${escapeHtml(row.job_number || "Delivery")}</span>
            <span class="badge badge-rejected">REJECTED</span>
          </div>
          <div class="row-customer">${escapeHtml(row.customer_name || "Customer")}</div>
          <div class="rejected-meta">${escapeHtml(parseCity(row.pickup_address))} -> ${escapeHtml(parseCity(row.delivery_address))}</div>
          <div class="rejected-meta">Driver: ${escapeHtml(driverName)} • Rejected ${escapeHtml(formatDateTime(row.driver_rejected_at || row.updated_at || row.created_at))}</div>
          <div class="rejected-meta">Total: ${escapeHtml(money(row.approved_price ?? row.customer_charge))}</div>
          <div class="rejected-actions" data-prevent-row-open="true">
            <button class="btn primary" type="button" data-return-rejected-ready="${escapeHtml(String(row.id))}">Unassign & Return to Ready</button>
          </div>
        </div>
        <span class="row-chevron">›</span>
      </div>
    `;
  }).join("");
}

function renderWorkspace() {
  const modeRows = filterRowsByMode();
  const filtered = applyFilters(modeRows);
  const sorted = sortRows(filtered);

  elements.visibleCount.textContent = String(sorted.length) + " visible";

  if (workspaceMode === "assigned") {
    renderRejectedRows();
    renderAssignedGroupedRows(sorted);
    return;
  }

  renderCompactRows(sorted, workspaceMode === "closed_today");
}

function getRowById(id) {
  return state.rows.find(item => String(item.id) === String(id)) ||
    state.rejectedRows.find(item => String(item.id) === String(id)) ||
    null;
}

function openRejectedReturnConfirm(jobId) {
  const job = getRowById(jobId);
  if (!job) {
    return;
  }

  state.pendingRejectedReturnJobId = String(job.id);
  elements.rejectedReturnConfirmText.textContent =
    "Remove this job from " + driverNameById(job.assigned_driver_id) + " and return it to Ready to Dispatch?";
  openModal("rejectedReturnConfirmModal");
}

async function returnRejectedToReady() {
  const jobId = state.pendingRejectedReturnJobId;
  const job = getRowById(jobId);
  if (!job || !job.id) {
    showToast("Selected rejected job was not found.", "error");
    return;
  }

  const button = elements.rejectedReturnConfirmBtn;
  setButtonLoading(button, true, "Returning...", "Return to Ready");

  try {
    const payload = {
      assigned_driver_id: null,
      status: "ready",
      driver_workflow_status: null,
      driver_accepted_at: null
    };

    const result = await client
      .from("quotes")
      .update(payload)
      .eq("id", job.id)
      .select("*")
      .maybeSingle();

    if (result.error) {
      throw result.error;
    }

    closeModal("rejectedReturnConfirmModal");
    await loadRows();
    try {
      localStorage.setItem("mg_dispatch_refresh", new Date().toISOString());
    } catch (_error) {
      // Ignore storage write issues; main update already succeeded.
    }
    showToast("Job returned to Ready to Dispatch", "success");
  } catch (error) {
    showToast(error.message || "Unable to return rejected job", "error");
  } finally {
    setButtonLoading(button, false, "Returning...", "Return to Ready");
    state.pendingRejectedReturnJobId = "";
  }
}

function populateDriverSelects() {
  if (!elements.assignDriverSelect) {
    return;
  }

  elements.assignDriverSelect.value = "";
}

function deriveDriverStatus(driver, activeAssignments) {
  const isActive = isDriverActiveFlag(driver);
  if (!isActive) {
    return "off_duty";
  }
  if (activeAssignments > 0) {
    return "busy";
  }
  return "available";
}

function driverStatusLabel(status) {
  if (status === "available") {
    return "Available";
  }
  if (status === "busy") {
    return "Busy";
  }
  return "Off Duty";
}

function deterministicMinutes(seedText, floor, spread) {
  const text = String(seedText || "seed");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return floor + Math.abs(hash % spread);
}

function getDriverMetrics(driver, job) {
  const id = String(driver.id);
  const activeAssignments = state.rows.filter(row => {
    return getWorkflowStage(row) === "assigned" && String(row.assigned_driver_id || "") === id;
  });

  const todaysClosed = state.rows.filter(row => {
    return isClosedToday(row) && String(row.assigned_driver_id || "") === id;
  });

  const status = deriveDriverStatus(driver, activeAssignments.length);
  const area = activeAssignments[0]
    ? parseCity(activeAssignments[0].pickup_address || activeAssignments[0].delivery_address)
    : parseCity(job.pickup_address || "Unknown");

  const eta = status === "available"
    ? deterministicMinutes(id + (job.id || ""), 5, 8)
    : status === "busy"
      ? deterministicMinutes(id + (job.id || ""), 14, 12)
      : deterministicMinutes(id + (job.id || ""), 28, 16);

  const onTimePct = Math.max(82, 99 - (activeAssignments.length * 3));
  const rating = Math.max(4.2, 5 - (activeAssignments.length * 0.12));

  return {
    id,
    name: driverDisplayName(driver),
    status,
    statusLabel: driverStatusLabel(status),
    area,
    eta,
    todaysDeliveries: todaysClosed.length,
    onTimePct,
    rating: Number(rating.toFixed(1)),
    activeAssignments: activeAssignments.length
  };
}

function pickRecommendedDriver(metrics) {
  if (!metrics.length) {
    return null;
  }

  const assignable = metrics.filter(item => item.status !== "off_duty");
  if (!assignable.length) {
    return null;
  }

  const ranked = assignable.slice().sort((a, b) => {
    const statusRank = { available: 0, busy: 1, off_duty: 2 };
    if (statusRank[a.status] !== statusRank[b.status]) {
      return statusRank[a.status] - statusRank[b.status];
    }
    if (a.eta !== b.eta) {
      return a.eta - b.eta;
    }
    return b.onTimePct - a.onTimePct;
  });

  return ranked[0] || null;
}

function getRecommendedReasons(driverMetric) {
  if (!driverMetric) {
    return [];
  }

  const reasons = [];
  reasons.push("Closest available driver.");
  reasons.push("Minimal detour.");
  reasons.push("Fastest ETA.");
  return reasons;
}

function renderAssignJobSummary(job) {
  elements.assignJobSummary.innerHTML = `
    <div class="kv"><strong>Job Number</strong><span>${escapeHtml(job.job_number || "-")}</span></div>
    <div class="kv"><strong>Customer</strong><span>${escapeHtml(job.customer_name || "-")}</span></div>
    <div class="kv"><strong>Pickup</strong><span>${escapeHtml(job.pickup_address || "-")}</span></div>
    <div class="kv"><strong>Delivery</strong><span>${escapeHtml(job.delivery_address || "-")}</span></div>
    <div class="kv"><strong>Customer Price</strong><span>${escapeHtml(money(job.approved_price ?? job.customer_charge))}</span></div>
    <div class="kv"><strong>Driver Pay</strong><span>${escapeHtml(money(job.driver_pay))}</span></div>
  `;
}

function renderRecommendedDriver(job, driverMetric) {
  if (!driverMetric) {
    elements.assignRecommendedCard.innerHTML = '<div class="hint">No driver recommendation available.</div>';
    return;
  }

  const reasons = getRecommendedReasons(driverMetric);
  const driverPayValue = job.driver_pay ?? "";

  elements.assignRecommendedCard.innerHTML = `
    <div class="assign-rec-head">
      <span class="assign-rec-badge">⭐ Recommended</span>
      <span class="driver-status ${escapeHtml(driverMetric.status)}">${escapeHtml(driverMetric.statusLabel)}</span>
    </div>
    <h4 class="assign-rec-name">${escapeHtml(driverMetric.name)}</h4>
    <div class="assign-rec-meta">${escapeHtml(String(driverMetric.eta))} minutes away • ${escapeHtml(String(driverMetric.onTimePct))}% On-Time • Area: ${escapeHtml(driverMetric.area)}</div>
    <div class="field" style="margin-top:8px;">
      <label>Driver Pay</label>
      <input class="assign-pay-input" type="number" min="0" step="0.01" value="${escapeHtml(String(driverPayValue))}" data-assign-pay-input="${escapeHtml(driverMetric.id)}" placeholder="0.00">
    </div>
    <ul class="assign-rec-reasons">
      ${reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("")}
    </ul>
    <button class="btn primary" type="button" data-assign-driver="${escapeHtml(driverMetric.id)}">Assign ${escapeHtml(driverMetric.name.split(" ")[0] || "Driver")}</button>
  `;
}

function renderOtherDriverCards(job, driverMetrics, recommendedId) {
  const query = clean(elements.assignDriverSearch.value);
  const filter = String(elements.assignDriverFilter.value || "all");

  const cards = driverMetrics
    .filter(item => item.id !== String(recommendedId || ""))
    .filter(item => {
      if (filter !== "all" && item.status !== filter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const hay = [item.name, item.area, item.statusLabel].join(" ").toLowerCase();
      return hay.includes(query);
    });

  if (!cards.length) {
    elements.assignDriverCards.innerHTML = '<div class="empty">No drivers match the current filter.</div>';
    return;
  }

  elements.assignDriverCards.innerHTML = cards.map(item => `
    <article class="assign-driver-card">
      <div class="assign-driver-top">
        <h5 class="assign-driver-name">${escapeHtml(item.name)}</h5>
        <span class="driver-status ${escapeHtml(item.status)}">${escapeHtml(item.statusLabel)}</span>
      </div>
      <div class="assign-driver-meta">Area: ${escapeHtml(item.area)} • ETA: ${escapeHtml(String(item.eta))} min</div>
      <div class="assign-driver-meta">Today's Deliveries: ${escapeHtml(String(item.todaysDeliveries))} • On-Time: ${escapeHtml(String(item.onTimePct))}% • Rating: ${escapeHtml(String(item.rating))}</div>
      <div class="assign-driver-actions">
        <div class="field" style="margin:0;">
          <label>Driver Pay</label>
          <input class="assign-pay-input" type="number" min="0" step="0.01" value="${escapeHtml(String(job.driver_pay ?? ""))}" data-assign-pay-input="${escapeHtml(item.id)}" placeholder="0.00">
        </div>
        <button class="btn" type="button" data-assign-driver="${escapeHtml(item.id)}" ${item.status === "off_duty" ? "disabled" : ""}>${item.status === "off_duty" ? "Inactive" : "Assign"}</button>
      </div>
    </article>
  `).join("");
}

function renderAssignPanelDrivers(job) {
  const metrics = state.drivers.map(driver => getDriverMetrics(driver, job));
  const focused = state.assignDriverFocusId
    ? metrics.find(item => item.id === String(state.assignDriverFocusId))
    : null;
  const recommended = focused || pickRecommendedDriver(metrics);
  renderRecommendedDriver(job, recommended);
  renderOtherDriverCards(job, metrics, recommended?.id || "");
}

function queueAssignment(driverId) {
  const job = getRowById(elements.assignJobId.value);
  if (!job) {
    return;
  }

  const driver = state.drivers.find(item => String(item.id) === String(driverId));
  if (!driver) {
    showToast("Selected driver was not found.", "error");
    return;
  }

  const activeAssignments = state.rows.filter(row => {
    return getWorkflowStage(row) === "assigned" && String(row.assigned_driver_id || "") === String(driver.id);
  }).length;

  if (deriveDriverStatus(driver, activeAssignments) === "off_duty") {
    showToast("Inactive drivers cannot be assigned.", "error");
    return;
  }

  const payInput = document.querySelector(`[data-assign-pay-input="${CSS.escape(String(driverId))}"]`);
  const driverPayRaw = String(payInput?.value || "").trim();

  if (driverPayRaw !== "") {
    const numeric = Number(driverPayRaw);
    if (!Number.isFinite(numeric) || numeric < 0) {
      showToast("Driver pay must be a valid number", "error");
      return;
    }
  }

  elements.assignDriverSelect.value = String(driverId);
  elements.assignDriverPay.value = driverPayRaw;

  state.pendingAssignment = {
    driverId: String(driverId),
    driverName: driverDisplayName(driver),
    jobNumber: job.job_number || "this delivery"
  };

  elements.assignConfirmText.textContent = "Assign " + state.pendingAssignment.driverName + " to " + state.pendingAssignment.jobNumber + "?";
  openModal("assignConfirmModal");
}

function confirmQueuedAssignment() {
  if (!state.pendingAssignment) {
    return;
  }

  closeModal("assignConfirmModal");
  elements.assignForm.requestSubmit();
}

function renderCustomerLookupResults(list, showNewOneTime) {
  const rows = list.map(customer => {
    const id = String(customer.id);
    const count = Number(state.customerDeliveryCounts[id] || 0);
    return `
      <button class="lookup-row" type="button" data-customer-select="${escapeHtml(id)}">
        <div class="lookup-title">${escapeHtml(customer.customer_name || "Customer")}</div>
        <div class="lookup-meta">${escapeHtml(customer.company_name || "No company")}</div>
        <div class="lookup-meta">${escapeHtml(customer.phone || "No phone")} • ${escapeHtml(customer.email || "No email")}</div>
        <div class="lookup-meta">${escapeHtml(String(count))} previous deliveries</div>
      </button>
    `;
  });

  if (showNewOneTime) {
    rows.push(`
      <button class="lookup-row" type="button" data-customer-one-time="true">
        <div class="lookup-title">+ New One-Time Customer</div>
        <div class="lookup-meta">This will not create a recurring customer profile.</div>
      </button>
    `);
  }

  elements.customerLookupResults.innerHTML = rows.join("");
  elements.customerLookupResults.classList.toggle("open", rows.length > 0);
}

function handleCustomerLookupInput() {
  const query = clean(elements.customerLookupInput.value);
  if (!query) {
    elements.customerLookupResults.classList.remove("open");
    return;
  }

  const found = state.recurringCustomers.filter(customer => {
    return [customer.customer_name, customer.company_name, customer.phone, customer.email]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  }).slice(0, 8);

  renderCustomerLookupResults(found, found.length === 0);
}

function applyRecurringCustomer(customerId) {
  const found = state.recurringCustomers.find(item => String(item.id) === String(customerId));
  if (!found) {
    return;
  }

  elements.jobCustomerAccountId.value = String(found.id);
  elements.jobForm.customer_name.value = found.customer_name || "";
  elements.jobForm.customer_phone.value = found.phone || "";
  elements.jobForm.customer_email.value = found.email || "";
  elements.customerLookupInput.value = found.customer_name || found.company_name || "";
  elements.customerLookupResults.classList.remove("open");
  renderNewDeliveryReview();
  showToast("Recurring customer selected", "success");
}

function chooseOneTimeCustomer() {
  elements.jobCustomerAccountId.value = "";
  elements.customerLookupResults.classList.remove("open");
  showToast("Using one-time customer", "info");
}

function renderNewDeliveryReview() {
  if (!elements.newDeliveryReviewList) {
    return;
  }

  const form = elements.jobForm;
  const rows = [
    ["Customer", form.customer_name.value || "-"],
    ["Pickup", form.pickup_address.value || "-"],
    ["Delivery", form.delivery_address.value || "-"],
    ["Vehicle", form.vehicle_type.value || "-"],
    ["Service", deliverySpeedLabel(form.delivery_speed.value || "")],
    ["Customer Price", money(form.approved_price.value)]
  ];

  elements.newDeliveryReviewList.innerHTML = rows.map(item => {
    return `<div><strong>${escapeHtml(item[0])}:</strong> ${escapeHtml(String(item[1]))}</div>`;
  }).join("");
}

function formToPayload(form) {
  const data = new FormData(form);

  const priceRaw = String(data.get("approved_price") || "").trim();
  const payRaw = String(data.get("driver_pay") || "").trim();
  const estimatedMilesRaw = String(data.get("estimated_miles") || "").trim();

  const pickupContactName = String(data.get("pickup_contact_name") || "").trim();
  const pickupContactPhone = String(data.get("pickup_contact_phone") || "").trim();
  const pickupInstructions = String(data.get("pickup_instructions") || "").trim();

  const deliveryContactName = String(data.get("delivery_contact_name") || "").trim();
  const deliveryContactPhone = String(data.get("delivery_contact_phone") || "").trim();
  const deliveryInstructions = String(data.get("delivery_instructions") || "").trim();

  const packageWeight = String(data.get("package_weight") || "").trim();
  const referenceNumber = String(data.get("reference_number") || "").trim();

  const internalNotes = String(data.get("special_instructions") || "").trim();
  const billingMeta = [];
  const instructions = [];

  const estimatedMilesValue = estimatedMilesRaw === "" ? null : Number(estimatedMilesRaw);
  if (estimatedMilesRaw !== "" && (!Number.isFinite(estimatedMilesValue) || estimatedMilesValue < 0)) {
    throw new Error("Estimated miles must be a valid number.");
  }

  if (pickupContactName) {
    billingMeta.push("Pickup Contact: " + pickupContactName);
  }
  if (pickupContactPhone) {
    billingMeta.push("Pickup Contact Phone: " + pickupContactPhone);
  }
  if (deliveryContactPhone) {
    billingMeta.push("Delivery Contact Phone: " + deliveryContactPhone);
  }
  if (packageWeight) {
    billingMeta.push("Weight: " + packageWeight);
  }
  if (referenceNumber) {
    billingMeta.push("Reference #: " + referenceNumber);
  }
  if (pickupInstructions) {
    instructions.push("Pickup Instructions: " + pickupInstructions);
  }
  if (deliveryInstructions) {
    instructions.push("Delivery Instructions: " + deliveryInstructions);
  }

  const payload = {
    customer_account_id: String(data.get("customer_account_id") || "").trim() || null,
    customer_name: String(data.get("customer_name") || "").trim(),
    customer_email: String(data.get("customer_email") || "").trim(),
    customer_phone: String(data.get("customer_phone") || "").trim(),
    pickup_address: String(data.get("pickup_address") || "").trim(),
    pickup_suite_floor: String(data.get("pickup_suite_floor") || "").trim() || null,
    pickup_zip: String(data.get("pickup_zip") || "").trim() || null,
    delivery_address: String(data.get("delivery_address") || "").trim(),
    delivery_suite_floor: String(data.get("delivery_suite_floor") || "").trim() || null,
    delivery_zip: String(data.get("delivery_zip") || "").trim() || null,
    delivery_recipient_name: deliveryContactName || String(data.get("delivery_recipient_name") || "").trim() || null,
    vehicle_type: String(data.get("vehicle_type") || "").trim(),
    delivery_speed: String(data.get("delivery_speed") || "").trim(),
    package_type: String(data.get("package_type") || "").trim(),
    delivery_method: String(data.get("delivery_method") || "").trim(),
    special_instructions: [internalNotes].concat(instructions).filter(Boolean).join("\n") || null,
    approved_price: priceRaw === "" ? null : Number(priceRaw),
    driver_pay: payRaw === "" ? null : Number(payRaw),
    assigned_driver_id: String(data.get("assigned_driver_id") || "").trim() || null,
    invoice_delivery_method: String(data.get("invoice_delivery_method") || "none").trim(),
    billing_notes: billingMeta.join("\n") || null
  };

  payload._estimated_miles_value = estimatedMilesValue;

  return payload;
}

function validatePayload(payload) {
  if (!payload.customer_name) {
    return "Customer name is required.";
  }

  if (!payload.pickup_address || !payload.delivery_address) {
    return "Pickup and delivery addresses are required.";
  }

  if (payload.approved_price !== null && (!Number.isFinite(payload.approved_price) || payload.approved_price < 0)) {
    return "Total amount billed must be a valid number.";
  }

  if (payload.driver_pay !== null && (!Number.isFinite(payload.driver_pay) || payload.driver_pay < 0)) {
    return "Driver pay must be a valid number.";
  }

  return "";
}

async function detectEstimatedMilesFieldSupport() {
  if (state.supportsEstimatedMiles !== null) {
    return state.supportsEstimatedMiles;
  }

  const probe = await client
    .from("quotes")
    .select("estimated_miles")
    .limit(1);

  if (!probe.error) {
    state.supportsEstimatedMiles = true;
    return true;
  }

  const message = String(probe.error.message || "").toLowerCase();
  if (message.includes("column") && message.includes("estimated_miles")) {
    state.supportsEstimatedMiles = false;
    return false;
  }

  throw probe.error;
}

function openEditJobModal(jobId) {
  const job = getRowById(jobId);
  if (!job) {
    return;
  }

  closeModal("jobDetailsModal");
  openModal("jobModal");

  document.getElementById("jobModalTitle").textContent = "Edit Job";
  document.getElementById("jobRecordId").value = String(job.id);

  const form = elements.jobForm;
  form.customer_name.value = job.customer_name || "";
  form.customer_email.value = job.customer_email || "";
  form.customer_phone.value = job.customer_phone || "";
  form.pickup_address.value = job.pickup_address || "";
  form.pickup_suite_floor.value = job.pickup_suite_floor || "";
  form.pickup_zip.value = job.pickup_zip || "";
  form.pickup_contact_name.value = "";
  form.pickup_contact_phone.value = "";
  form.pickup_instructions.value = "";
  form.delivery_address.value = job.delivery_address || "";
  form.delivery_suite_floor.value = job.delivery_suite_floor || "";
  form.delivery_zip.value = job.delivery_zip || "";
  form.delivery_contact_name.value = job.delivery_recipient_name || "";
  form.delivery_contact_phone.value = "";
  form.delivery_instructions.value = "";
  form.vehicle_type.value = job.vehicle_type || "";
  form.delivery_speed.value = job.delivery_speed || "";
  form.package_type.value = job.package_type || "";
  form.package_weight.value = "";
  form.reference_number.value = "";
  form.approved_price.value = job.approved_price ?? job.customer_charge ?? "";
  form.estimated_miles.value = String(job.estimated_miles ?? "");
  form.special_instructions.value = job.special_instructions || "";
  elements.jobCustomerAccountId.value = String(job.customer_account_id || "");
  elements.customerLookupInput.value = job.customer_name || "";
  elements.saveJobBtn.textContent = "Save Delivery";
  renderNewDeliveryReview();
}

async function submitJobForm(event) {
  event.preventDefault();
  const saveBtn = elements.saveJobBtn;
  setButtonLoading(saveBtn, true, "Saving...", saveBtn.textContent || "Save Delivery");

  try {
    const recordId = document.getElementById("jobRecordId").value;
    const payload = formToPayload(elements.jobForm);
    const estimatedMilesValue = payload._estimated_miles_value;
    delete payload._estimated_miles_value;

    const supportsEstimatedMiles = await detectEstimatedMilesFieldSupport();
    if (supportsEstimatedMiles) {
      payload.estimated_miles = estimatedMilesValue;
    }

    const validationError = validatePayload(payload);
    if (validationError) {
      showToast(validationError, "error");
      return;
    }

    const original = getRowById(recordId);
    if (original) {
      payload.status = original.status;
      payload.assigned_driver_id = original.assigned_driver_id;
      payload.driver_pay = original.driver_pay;
      payload.driver_acceptance_status = original.driver_acceptance_status;
      payload.driver_workflow_status = original.driver_workflow_status;
      payload.driver_accepted_at = original.driver_accepted_at;
      payload.driver_rejected_at = original.driver_rejected_at;
    }

    const updateResult = await client
      .from("quotes")
      .update(payload)
      .eq("id", recordId)
      .select("*")
      .maybeSingle();

    if (updateResult.error) {
      throw updateResult.error;
    }

    closeModal("jobModal");
    await loadRows();
    showToast("Delivery updated successfully", "success");
  } catch (error) {
    showToast(error.message || "Unable to save delivery", "error");
  } finally {
    setButtonLoading(saveBtn, false, "Saving...", "Save Delivery");
  }
}

function openJobDetails(jobId, readOnly = false) {
  const job = getRowById(jobId);
  if (!job) {
    return;
  }

  state.selectedJob = job;
  const stage = getWorkflowStage(job);
  const summaryHint = readOnly ? '<div class="hint">Closed job view.</div>' : "";

  const statusValue = clean(job.status);
  const canDelete = ["new", "pending", "waiting_payment", "quoted", "quote"].includes(statusValue);

  let primaryAction = "";
  if (stage === "pending_approval") {
    primaryAction = `<button class="btn primary" type="button" data-mark-ready="${escapeHtml(String(job.id))}">Mark Ready to Dispatch</button>`;
  } else if (stage === "ready_to_dispatch") {
    primaryAction = `<button class="btn primary" type="button" data-assign-job="${escapeHtml(String(job.id))}">Assign Driver</button>`;
  } else {
    primaryAction = `<button class="btn" type="button" data-view-bol="${escapeHtml(String(job.id))}">View / Create BOL</button>`;
  }

  const menuActions = [
    `<button class="menu-item" type="button" data-edit-job="${escapeHtml(String(job.id))}">Edit Delivery</button>`,
    `<button class="menu-item" type="button" data-send-invoice="${escapeHtml(String(job.id))}">Email Invoice</button>`,
    `<button class="menu-item" type="button" data-send-payment-email="${escapeHtml(String(job.id))}">Send Payment Link</button>`,
    `<button class="menu-item" type="button" data-send-payment-text="${escapeHtml(String(job.id))}">Text Invoice</button>`,
    `<button class="menu-item" type="button" data-copy-payment-link="${escapeHtml(String(job.id))}">Copy Payment Link</button>`,
    `<button class="menu-item" type="button" data-view-payment="${escapeHtml(String(job.id))}">View Payment</button>`,
    `<button class="menu-item" type="button" data-view-bol="${escapeHtml(String(job.id))}">Print / View BOL</button>`
  ];

  if (stage === "ready_to_dispatch" || stage === "assigned") {
    menuActions.push(`<button class="menu-item" type="button" data-assign-job="${escapeHtml(String(job.id))}">Assign / Reassign Driver</button>`);
  }

  if (job.assigned_driver_id) {
    menuActions.push(`<button class="menu-item" type="button" data-resend-driver="${escapeHtml(String(job.id))}">Resend to Driver</button>`);
  }

  if (canDelete) {
    menuActions.push(`<button class="menu-item" type="button" data-delete-delivery="${escapeHtml(String(job.id))}">Delete Delivery</button>`);
  }

  if (!readOnly) {
    menuActions.push(`<button class="menu-item" type="button" data-cancel-job="${escapeHtml(String(job.id))}">Cancel Delivery</button>`);
  }

  elements.jobDetailsBody.innerHTML = `
    ${summaryHint}

    <details class="card" open>
      <summary>Summary</summary>
      <div class="card-body">
        <div class="kv"><strong>Job #</strong><span>${escapeHtml(job.job_number || "-")}</span></div>
        <div class="kv"><strong>Status</strong><span class="${escapeHtml(badgeClass(job))}">${escapeHtml(statusLabel(job))}</span></div>
        <div class="kv"><strong>Customer</strong><span>${escapeHtml(job.customer_name || "-")}</span></div>
        <div class="kv"><strong>Pickup</strong><span>${escapeHtml(job.pickup_address || "-")}</span></div>
        <div class="kv"><strong>Delivery</strong><span>${escapeHtml(job.delivery_address || "-")}</span></div>
        <div class="kv"><strong>Customer Price</strong><span>${escapeHtml(money(job.approved_price ?? job.customer_charge))}</span></div>
        <div class="kv"><strong>Driver</strong><span>${escapeHtml(driverNameById(job.assigned_driver_id))}</span></div>
        <div class="kv"><strong>Driver Workflow</strong><span>${escapeHtml(driverWorkflowLabel(job))}</span></div>
      </div>
    </details>

    <details class="card"><summary>Pickup</summary>
      <div class="card-body">
        <div class="kv"><strong>Address</strong><span>${escapeHtml(job.pickup_address || "-")}</span></div>
        <div class="kv"><strong>Suite / Floor</strong><span>${escapeHtml(job.pickup_suite_floor || "-")}</span></div>
        <div class="kv"><strong>ZIP</strong><span>${escapeHtml(job.pickup_zip || "-")}</span></div>
      </div>
    </details>

    <details class="card"><summary>Delivery</summary>
      <div class="card-body">
        <div class="kv"><strong>Address</strong><span>${escapeHtml(job.delivery_address || "-")}</span></div>
        <div class="kv"><strong>Suite / Floor</strong><span>${escapeHtml(job.delivery_suite_floor || "-")}</span></div>
        <div class="kv"><strong>ZIP</strong><span>${escapeHtml(job.delivery_zip || "-")}</span></div>
        <div class="kv"><strong>Recipient</strong><span>${escapeHtml(job.delivery_recipient_name || job.pod_recipient_name || "-")}</span></div>
      </div>
    </details>

    <details class="card"><summary>Payment and BOL</summary>
      <div class="card-body">
        <div class="kv"><strong>Payment</strong><span>${escapeHtml(String(job.payment_status || "-").toUpperCase())}</span></div>
        <div class="kv"><strong>Invoice</strong><span>${escapeHtml(String(job.invoice_status || "-").toUpperCase())}</span></div>
        <div class="kv"><strong>BOL</strong><span>${escapeHtml(String(job.bol_status || "Unknown"))}</span></div>
      </div>
    </details>

    <div class="form-actions">
      ${primaryAction}
      <span class="row-menu">
        <button class="menu-trigger" type="button" data-menu-toggle>⋯</button>
        <span class="menu-list">
          ${menuActions.join("")}
        </span>
      </span>
    </div>
  `;

  openModal("jobDetailsModal");
}

function openAssignModal(jobId) {
  const job = getRowById(jobId);
  if (!job) {
    return;
  }

  const stage = getWorkflowStage(job);
  if (!["ready_to_dispatch", "assigned"].includes(stage)) {
    showToast("Driver assignment is available only when a job is Ready to Dispatch or already Assigned.", "info");
    return;
  }

  elements.assignJobId.value = String(job.id);
  elements.assignDriverSelect.value = "";
  elements.assignDriverPay.value = String(job.driver_pay ?? "");
  if (state.assignDriverFocusId) {
    const focusedName = driverNameById(state.assignDriverFocusId);
    elements.assignDriverSearch.value = focusedName !== "Unassigned"
      ? focusedName
      : state.assignDriverFocusName;
  } else {
    elements.assignDriverSearch.value = "";
  }
  elements.assignDriverFilter.value = "all";
  document.getElementById("assignNote").value = "";
  state.pendingAssignment = null;
  renderAssignJobSummary(job);
  renderAssignPanelDrivers(job);
  openModal("assignModal");
}

async function assignOrReassignDriver(event) {
  event.preventDefault();

  const jobId = elements.assignJobId.value;
  const job = getRowById(jobId);
  if (!job) {
    return;
  }

  const driverId = String(elements.assignDriverSelect.value || "").trim();
  const driverPayRaw = String(elements.assignDriverPay.value || "").trim();

  if (!driverId) {
    showToast("Select a driver first", "error");
    return;
  }

  const driverPay = driverPayRaw === "" ? null : Number(driverPayRaw);
  if (driverPay !== null && (!Number.isFinite(driverPay) || driverPay < 0)) {
    showToast("Driver pay must be a valid number", "error");
    return;
  }

  const shouldResetWorkflow =
    String(job.assigned_driver_id || "") !== driverId ||
    clean(job.status) !== "assigned" ||
    clean(job.driver_acceptance_status) === "rejected";

  const payload = {
    assigned_driver_id: driverId,
    driver_pay: driverPay,
    status: "assigned"
  };

  if (shouldResetWorkflow) {
    payload.driver_acceptance_status = "pending";
    payload.driver_workflow_status = "assigned";
    payload.driver_accepted_at = null;
    payload.driver_rejected_at = null;
  }

  setButtonLoading(elements.assignSubmitBtn, true, "Sending...", "Assign Driver");

  try {
    const result = await client
      .from("quotes")
      .update(payload)
      .eq("id", jobId)
      .select("*")
      .maybeSingle();

    if (result.error) {
      throw result.error;
    }

    closeModal("assignConfirmModal");
    closeModal("assignModal");
    await loadRows();
    openJobDetails(jobId, false);
    showToast("Driver assigned successfully.", "success");
  } catch (error) {
    showToast(error.message || "Unable to assign driver", "error");
  } finally {
    setButtonLoading(elements.assignSubmitBtn, false, "Sending...", "Assign Driver");
    state.pendingAssignment = null;
  }
}

async function findNotificationField(jobId) {
  const candidates = [
    "assignment_notified_at",
    "driver_notified_at",
    "driver_notification_sent_at",
    "resent_to_driver_at"
  ];

  for (const field of candidates) {
    const probe = await client
      .from("quotes")
      .select(field)
      .eq("id", jobId)
      .maybeSingle();

    if (!probe.error) {
      return field;
    }

    const message = String(probe.error.message || "").toLowerCase();
    if (!message.includes("column") && !message.includes("exist") && !message.includes("schema")) {
      throw probe.error;
    }
  }

  return "";
}

async function resendToDriver(jobId) {
  const job = getRowById(jobId);
  if (!job || !job.assigned_driver_id) {
    showToast("No assigned driver to resend", "error");
    return;
  }

  const confirmed = window.confirm("Resend this job to " + driverNameById(job.assigned_driver_id) + "?");
  if (!confirmed) {
    return;
  }

  try {
    const timestampField = await findNotificationField(jobId);

    if (timestampField) {
      const now = new Date().toISOString();
      const update = {};
      update[timestampField] = now;

      const result = await client
        .from("quotes")
        .update(update)
        .eq("id", jobId);

      if (result.error) {
        throw result.error;
      }

      await loadRows();
      openJobDetails(jobId, false);
      showToast("Job resent to driver", "success");
      return;
    }

    showToast("Resend action is visible, but notification transport is not connected yet.", "info");
  } catch (error) {
    showToast(error.message || "Unable to resend job", "error");
  }
}

function openBolForJob(jobId) {
  const url = "/job.html?id=" + encodeURIComponent(String(jobId));
  window.open(url, "_blank", "noopener");
}

function sendInvoiceForJob(jobId) {
  const job = getRowById(jobId);
  if (!job) {
    return;
  }

  showToast("Invoice action is visible. Transport automation is not connected yet.", "info");
}

function sendPaymentLinkByText(jobId) {
  const job = getRowById(jobId);
  if (!job) {
    return;
  }

  showToast("Payment link (text) action is visible. SMS transport is not connected yet.", "info");
}

function sendPaymentLinkByEmail(jobId) {
  const job = getRowById(jobId);
  if (!job) {
    return;
  }

  showToast("Payment link (email) action is visible. Email transport is not connected yet.", "info");
}

async function markDeliveryReady(jobId) {
  const job = getRowById(jobId);
  if (!job) {
    return;
  }

  const confirmed = window.confirm("Mark " + (job.job_number || "this delivery") + " as Ready to Dispatch?");
  if (!confirmed) {
    return;
  }

  try {
    const result = await client
      .from("quotes")
      .update({ status: "ready" })
      .eq("id", jobId);

    if (result.error) {
      throw result.error;
    }

    await loadRows();
    openJobDetails(jobId, false);
    showToast("Delivery moved to Ready to Dispatch", "success");
  } catch (error) {
    showToast(error.message || "Unable to update delivery", "error");
  }
}

async function copyPaymentLink(jobId) {
  const job = getRowById(jobId);
  if (!job) {
    return;
  }

  const maybeLink = [
    job.payment_link_url,
    job.customer_payment_link,
    job.invoice_payment_link,
    job.payment_url
  ].find(Boolean);

  if (!maybeLink) {
    showToast("Payment link backend field is not connected yet.", "info");
    return;
  }

  try {
    await navigator.clipboard.writeText(String(maybeLink));
    showToast("Payment link copied", "success");
  } catch (error) {
    showToast("Unable to copy payment link on this device", "error");
  }
}

async function deleteDelivery(jobId) {
  const job = getRowById(jobId);
  if (!job) {
    return;
  }

  const status = clean(job.status);
  const allowed = ["new", "pending", "waiting_payment", "quoted", "quote"];

  if (!allowed.includes(status)) {
    showToast("Delete is only allowed for new/pending/waiting/quoted deliveries.", "info");
    return;
  }

  const confirmed = window.confirm("Delete " + (job.job_number || "this delivery") + " permanently?");
  if (!confirmed) {
    return;
  }

  try {
    const result = await client
      .from("quotes")
      .delete()
      .eq("id", jobId);

    if (result.error) {
      throw result.error;
    }

    closeModal("jobDetailsModal");
    await loadRows();
    showToast("Delivery deleted", "success");
  } catch (error) {
    showToast(error.message || "Unable to delete delivery", "error");
  }
}

async function changeDispatchStatus(jobId, nextStatus, buttonRef) {
  const job = getRowById(jobId);
  if (!job) {
    return;
  }

  if (clean(nextStatus) !== "cancelled") {
    showToast("Status changes are automated. Dispatch can only cancel manually.", "info");
    return;
  }

  const confirmed = window.confirm("Cancel " + (job.job_number || "this job") + "?");
  if (!confirmed) {
    return;
  }

  const button = buttonRef || null;
  setButtonLoading(button, true, "Saving...", "Update Status");

  try {
    const result = await client
      .from("quotes")
      .update({ status: nextStatus })
      .eq("id", jobId)
      .select("*")
      .maybeSingle();

    if (result.error) {
      throw result.error;
    }

    await loadRows();

    const refreshed = getRowById(jobId);
    if (refreshed) {
      openJobDetails(jobId, getWorkflowStage(refreshed) === "closed");
    }

    showToast("Job status updated", "success");
  } catch (error) {
    showToast(error.message || "Unable to update status", "error");
  } finally {
    setButtonLoading(button, false, "Saving...", "Update Status");
  }
}

function viewPayment(jobId) {
  const job = getRowById(jobId);
  if (!job) {
    return;
  }

  showToast("Payment status: " + String(job.payment_status || "unknown").toUpperCase(), "info");
}

function applyWorkspacePresentation() {
  if (!modeConfig.showCustomerSearch) {
    elements.customerSearchField.classList.add("hidden");
  }

  if (!modeConfig.showJobSearch) {
    elements.jobSearchField.classList.add("hidden");
  }

  if (!modeConfig.showRefresh) {
    elements.refreshWrap.classList.add("hidden");
  }

  elements.statusFilter.innerHTML = modeConfig.filterOptions
    .map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
    .join("");
}

async function loadWorkspace() {
  elements.rowsHost.innerHTML = '<div class="empty">Loading deliveries...</div>';

  try {
    await loadDrivers();
    await loadRecurringCustomers();
    await loadRows();
  } catch (error) {
    elements.rowsHost.innerHTML = '<div class="empty">' + escapeHtml(error.message || "Unable to load workspace") + '</div>';
    showToast(error.message || "Unable to load workspace", "error");
  }
}

function handleDocumentClick(event) {
  const target = event.target;

  if (target.matches("[data-close-modal]")) {
    closeModal(target.getAttribute("data-close-modal"));
    return;
  }

  if (target.matches(".modal-backdrop")) {
    closeModal(target.id);
    return;
  }

  if (target.matches("[data-menu-toggle]")) {
    event.stopPropagation();
    toggleMenu(target);
    return;
  }

  const openInline = target.closest("[data-open-job-inline]");
  if (openInline) {
    openJobDetails(openInline.getAttribute("data-open-job-inline"), workspaceMode === "closed_today");
    return;
  }

  const returnRejected = target.closest("[data-return-rejected-ready]");
  if (returnRejected) {
    openRejectedReturnConfirm(returnRejected.getAttribute("data-return-rejected-ready"));
    return;
  }

  const rowAction = target.closest("[data-prevent-row-open]");
  if (rowAction) {
    return;
  }

  const jobRow = target.closest("[data-open-job]");
  if (jobRow) {
    openJobDetails(jobRow.getAttribute("data-open-job"), jobRow.getAttribute("data-readonly") === "true");
    return;
  }

  const editFromDetails = target.closest("[data-edit-job]");
  if (editFromDetails) {
    openEditJobModal(editFromDetails.getAttribute("data-edit-job"));
    return;
  }

  const assignJob = target.closest("[data-assign-job]");
  if (assignJob) {
    openAssignModal(assignJob.getAttribute("data-assign-job"));
    return;
  }

  const assignDriver = target.closest("[data-assign-driver]");
  if (assignDriver) {
    queueAssignment(assignDriver.getAttribute("data-assign-driver"));
    return;
  }

  const markReadyBtn = target.closest("[data-mark-ready]");
  if (markReadyBtn) {
    markDeliveryReady(markReadyBtn.getAttribute("data-mark-ready"));
    return;
  }

  const resendDriver = target.closest("[data-resend-driver]");
  if (resendDriver) {
    resendToDriver(resendDriver.getAttribute("data-resend-driver"));
    return;
  }

  const sendInvoice = target.closest("[data-send-invoice]");
  if (sendInvoice) {
    sendInvoiceForJob(sendInvoice.getAttribute("data-send-invoice"));
    return;
  }

  const sendPayText = target.closest("[data-send-payment-text]");
  if (sendPayText) {
    sendPaymentLinkByText(sendPayText.getAttribute("data-send-payment-text"));
    return;
  }

  const sendPayEmail = target.closest("[data-send-payment-email]");
  if (sendPayEmail) {
    sendPaymentLinkByEmail(sendPayEmail.getAttribute("data-send-payment-email"));
    return;
  }

  const copyPayment = target.closest("[data-copy-payment-link]");
  if (copyPayment) {
    copyPaymentLink(copyPayment.getAttribute("data-copy-payment-link"));
    return;
  }

  const viewBol = target.closest("[data-view-bol]");
  if (viewBol) {
    openBolForJob(viewBol.getAttribute("data-view-bol"));
    return;
  }

  const deleteDeliveryBtn = target.closest("[data-delete-delivery]");
  if (deleteDeliveryBtn) {
    deleteDelivery(deleteDeliveryBtn.getAttribute("data-delete-delivery"));
    return;
  }

  const cancelJob = target.closest("[data-cancel-job]");
  if (cancelJob) {
    changeDispatchStatus(cancelJob.getAttribute("data-cancel-job"), "cancelled", cancelJob);
    return;
  }

  const paymentView = target.closest("[data-view-payment]");
  if (paymentView) {
    viewPayment(paymentView.getAttribute("data-view-payment"));
    return;
  }

  const pickCustomer = target.closest("[data-customer-select]");
  if (pickCustomer) {
    applyRecurringCustomer(pickCustomer.getAttribute("data-customer-select"));
    return;
  }

  const pickOneTime = target.closest("[data-customer-one-time]");
  if (pickOneTime) {
    chooseOneTimeCustomer();
    return;
  }

  closeAllMenus();
  elements.customerLookupResults.classList.remove("open");
}

function bindEvents() {
  elements.searchInput.addEventListener("input", renderWorkspace);
  elements.customerSearchInput.addEventListener("input", renderWorkspace);
  elements.jobSearchInput.addEventListener("input", renderWorkspace);
  elements.statusFilter.addEventListener("change", renderWorkspace);
  elements.sortBy.addEventListener("change", renderWorkspace);
  elements.refreshBtn.addEventListener("click", loadWorkspace);
  elements.assignDriverSearch.addEventListener("input", () => {
    const job = getRowById(elements.assignJobId.value);
    if (job) {
      renderAssignPanelDrivers(job);
    }
  });
  elements.assignDriverFilter.addEventListener("change", () => {
    const job = getRowById(elements.assignJobId.value);
    if (job) {
      renderAssignPanelDrivers(job);
    }
  });
  elements.assignConfirmBtn.addEventListener("click", confirmQueuedAssignment);
  if (elements.rejectedReturnConfirmBtn) {
    elements.rejectedReturnConfirmBtn.addEventListener("click", returnRejectedToReady);
  }

  elements.customerLookupInput.addEventListener("input", handleCustomerLookupInput);
  elements.jobForm.addEventListener("input", renderNewDeliveryReview);
  elements.jobForm.addEventListener("submit", submitJobForm);
  elements.assignForm.addEventListener("submit", assignOrReassignDriver);

  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      document.querySelectorAll(".modal-backdrop.open").forEach(modal => closeModal(modal.id));
    }
  });

  window.addEventListener("storage", event => {
    if (event.key === "mg_dispatch_refresh" && event.newValue) {
      loadRows().catch(error => {
        showToast(error.message || "Unable to refresh workspace", "error");
      });
      return;
    }

    if (event.key === "mg_driver_profile_refresh" && event.newValue) {
      loadDrivers()
        .then(() => {
          renderWorkspace();
          const job = getRowById(elements.assignJobId.value);
          if (job && elements.assignModal.classList.contains("open")) {
            renderAssignPanelDrivers(job);
          }
        })
        .catch(error => {
          showToast(error.message || "Unable to refresh drivers", "error");
        });
    }
  });
}

(async function startPage() {
  try {
    readAssignDriverFocusFromQuery();

    const session = await requireDispatchAccess();
    if (!session) {
      return;
    }

    applyWorkspacePresentation();
    bindEvents();
    renderNewDeliveryReview();
    await loadWorkspace();

    if (workspaceMode === "ready_to_dispatch" && state.assignDriverFocusId && !state.hasShownAssignFocusToast) {
      const label = state.assignDriverFocusName || driverNameById(state.assignDriverFocusId);
      showToast("Driver focus active: " + label + ". Open a Ready job and tap Assign / Reassign Driver.", "info");
      state.hasShownAssignFocusToast = true;
    }
  } catch (error) {
    elements.rowsHost.innerHTML = '<div class="empty">' + escapeHtml(error.message || "Unable to load workspace") + '</div>';
    showToast(error.message || "Unable to load workspace", "error");
  }
})();
