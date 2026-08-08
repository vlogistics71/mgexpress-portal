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
  activeInvoice: null,
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
  categoryFilter: document.getElementById("categoryFilter"),
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
  toastWrap: document.getElementById("toastWrap"),
  bolPreviewModal: null,
  bolPreviewBody: null,
  bolPrintBtn: null,
  invoicePreviewModal: null,
  invoicePreviewBody: null,
  invoicePrintBtn: null
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

function validHttpUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.origin);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch (_error) {
    return "";
  }
}

function resolvePaymentLink(job) {
  return [
    job?.payment_link_url,
    job?.customer_payment_link,
    job?.invoice_payment_link,
    job?.payment_url
  ].find(Boolean) || "";
}

function resolveBolLink(job) {
  return [
    job?.bol_url,
    job?.bill_of_lading_url,
    job?.bol_pdf_url,
    job?.bol_document_url
  ].find(Boolean) || "";
}

function firstPresentValue(values) {
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }

    const text = String(value).trim();
    if (text) {
      return text;
    }
  }

  return "";
}

function readJobField(job, keys) {
  return firstPresentValue(keys.map(key => job?.[key]));
}

function toDisplayDateTime(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return formatDateTime(text);
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

function normalizeJobCategory(value) {
  const cleanValue = clean(value);
  return ["medical", "pallet", "legal", "general", "special"].includes(cleanValue)
    ? cleanValue
    : "general";
}

function jobCategoryLabel(value) {
  const map = {
    medical: "Medical",
    pallet: "Pallet",
    legal: "Legal",
    general: "General",
    special: "Special"
  };

  return map[normalizeJobCategory(value)] || "General";
}

function jobCategoryClass(value) {
  return "category-" + normalizeJobCategory(value);
}

function deliveryTypeLabel(value) {
  const map = {
    business_to_business: "Business to Business",
    business_to_residential: "Business to Residential",
    residential_to_business: "Residential to Business",
    residential_to_residential: "Residential to Residential"
  };

  return map[clean(value)] || "-";
}

function serviceLevelLabel(value) {
  const map = {
    standard: "Standard",
    priority: "Priority",
    stat: "STAT",
    scheduled: "Scheduled",
    on_demand: "On Demand"
  };

  return map[clean(value)] || "-";
}

function returnRequiredFlag(value) {
  if (value === true) {
    return true;
  }

  const token = clean(value);
  return token === "true" || token === "1" || token === "yes";
}

function hasReturnRequired(job) {
  return returnRequiredFlag(job?.return_required);
}

function returnLocationLabel(value) {
  const map = {
    same_as_pickup: "Same as Original Pickup",
    different_location: "Different Return Location"
  };

  return map[clean(value)] || "Same as Original Pickup";
}

function returnTimingLabel(value) {
  const map = {
    immediate: "Immediately After Delivery",
    later_today: "Later Today",
    another_day: "Another Day"
  };

  return map[clean(value)] || "Immediately After Delivery";
}

function returnDestinationText(job) {
  if (!hasReturnRequired(job)) {
    return "No Return";
  }

  if (clean(job.return_location_type) !== "different_location") {
    return "Same as Original Pickup: " + String(job.pickup_address || "-");
  }

  const parts = [
    String(job.return_address || "").trim(),
    String(job.return_suite_floor || "").trim(),
    String(job.return_zip || "").trim()
  ].filter(Boolean);

  return parts.length ? parts.join(" • ") : "Different Return Location";
}

function categoryBadgesHtml(job) {
  const categoryBadge = `<span class="badge badge-category">${escapeHtml(jobCategoryLabel(job.job_category))}</span>`;
  const returnBadge = hasReturnRequired(job)
    ? '<span class="badge badge-return">RETURN REQUIRED</span>'
    : "";

  return categoryBadge + returnBadge;
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
  const categoryFilter = String(elements.categoryFilter?.value || "all");

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

    if (categoryFilter !== "all" && normalizeJobCategory(row.job_category) !== categoryFilter) {
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
          <button class="mini" type="button" id="viewBolBtn-${escapeHtml(String(row.id))}" data-view-bol="${escapeHtml(String(row.id))}">View BOL</button>
          <button class="mini" type="button" data-send-invoice="${escapeHtml(String(row.id))}">Send Invoice</button>
          <button class="mini" type="button" data-open-job-inline="${escapeHtml(String(row.id))}">View Details</button>
        </div>
      `
      : "";

    return `
      <div class="row ${escapeHtml(jobCategoryClass(row.job_category))}" data-open-job="${escapeHtml(String(row.id))}" data-readonly="${readOnly ? "true" : "false"}" tabindex="0" role="button">
        <span class="row-main">
          <span class="row-topline">
            <span class="row-id">${escapeHtml(row.job_number || "Delivery")}</span>
            <span class="badge ${escapeHtml(badgeClass(row))}">${escapeHtml(statusLabel(row))}</span>
            ${categoryBadgesHtml(row)}
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
            <div class="row ${escapeHtml(jobCategoryClass(row.job_category))}" data-open-job="${escapeHtml(String(row.id))}" tabindex="0" role="button">
              <span class="row-main">
                <span class="row-topline">
                  <span class="row-id">${escapeHtml(row.job_number || "Delivery")}</span>
                  <span class="badge ${escapeHtml(badgeClass(row))}">${escapeHtml(statusLabel(row))}</span>
                  ${categoryBadgesHtml(row)}
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
      <div class="rejected-row ${escapeHtml(jobCategoryClass(row.job_category))}" data-open-job="${escapeHtml(String(row.id))}" role="button" tabindex="0">
        <div class="rejected-main">
          <div class="rejected-topline">
            <span class="row-id">${escapeHtml(row.job_number || "Delivery")}</span>
            <span class="badge badge-rejected">REJECTED</span>
            ${categoryBadgesHtml(row)}
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
  const driverPayDraft = String(elements.assignDriverPay?.value || job.driver_pay || "").trim();
  elements.assignJobSummary.innerHTML = `
    <div class="kv"><strong>Job Number</strong><span>${escapeHtml(job.job_number || "-")}</span></div>
    <div class="kv"><strong>Customer</strong><span>${escapeHtml(job.customer_name || "-")}</span></div>
    <div class="kv"><strong>Pickup</strong><span>${escapeHtml(job.pickup_address || "-")}</span></div>
    <div class="kv"><strong>Delivery</strong><span>${escapeHtml(job.delivery_address || "-")}</span></div>
    <div class="kv"><strong>Customer Price</strong><span>${escapeHtml(money(job.approved_price ?? job.customer_charge))}</span></div>
    <div class="kv"><strong>Driver Pay</strong><span>
      <input
        id="assignPanelDriverPayInput"
        class="assign-pay-input"
        type="number"
        min="0"
        step="0.01"
        value="${escapeHtml(driverPayDraft)}"
        placeholder="0.00"
      >
    </span></div>
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
  const panelPayInput = document.getElementById("assignPanelDriverPayInput");
  const rawFromCard = String(payInput?.value || "").trim();
  const rawFromPanel = String(panelPayInput?.value || "").trim();
  const driverPayRaw = rawFromCard || rawFromPanel;

  if (driverPayRaw === "") {
    showToast("Enter driver pay before assigning this delivery.", "error");
    return;
  }

  const numeric = Number(driverPayRaw);
  if (!Number.isFinite(numeric) || numeric < 0) {
    showToast("Driver pay must be a valid number", "error");
    return;
  }
  if (numeric <= 0) {
    showToast("Driver pay must be greater than 0.", "error");
    return;
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

function syncReturnDetailsVisibility() {
  const form = elements.jobForm;
  if (!form || !form.return_required) {
    return;
  }

  const returnRequired = returnRequiredFlag(form.return_required.value);
  const locationType = clean(form.return_location_type?.value || "same_as_pickup");
  const differentLocation = locationType === "different_location";

  const returnDetails = document.getElementById("returnDetailsSection");
  const returnPickupReadback = document.getElementById("returnPickupReadback");
  const differentFields = form.querySelectorAll("[data-return-different]");

  if (returnDetails) {
    returnDetails.hidden = !returnRequired;
  }
  if (returnPickupReadback) {
    returnPickupReadback.hidden = !returnRequired || differentLocation;
  }
  differentFields.forEach(field => {
    field.hidden = !returnRequired || !differentLocation;
  });

  if (!returnRequired) {
    if (form.return_location_type) {
      form.return_location_type.value = "same_as_pickup";
    }
    if (form.return_address) {
      form.return_address.value = "";
    }
    if (form.return_suite_floor) {
      form.return_suite_floor.value = "";
    }
    if (form.return_zip) {
      form.return_zip.value = "";
    }
    if (form.return_timing) {
      form.return_timing.value = "immediate";
    }
  } else if (!differentLocation) {
    if (form.return_address) {
      form.return_address.value = "";
    }
    if (form.return_suite_floor) {
      form.return_suite_floor.value = "";
    }
    if (form.return_zip) {
      form.return_zip.value = "";
    }
  }
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
    ["Job Category", jobCategoryLabel(form.job_category?.value)],
    ["Delivery Type", deliveryTypeLabel(form.delivery_type?.value)],
    ["Service Level", serviceLevelLabel(form.service_level?.value)],
    ["Vehicle", form.vehicle_type.value || "-"],
    ["Service", deliverySpeedLabel(form.delivery_speed.value || "")],
    ["Return Service", returnRequiredFlag(form.return_required?.value) ? "Return Required" : "No Return"],
    ["Customer Price", money(form.approved_price.value)]
  ];

  if (returnRequiredFlag(form.return_required?.value)) {
    rows.push(["Return Location", returnLocationLabel(form.return_location_type?.value)]);
    rows.push(["Return Timing", returnTimingLabel(form.return_timing?.value)]);
  }

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

  const hasCategoryFields = Boolean(form.elements.namedItem("job_category"));
  if (hasCategoryFields) {
    payload.job_category = normalizeJobCategory(data.get("job_category"));
    payload.delivery_type = String(data.get("delivery_type") || "").trim() || null;
    payload.service_level = String(data.get("service_level") || "").trim() || null;
  }

  const hasReturnFields = Boolean(form.elements.namedItem("return_required"));
  if (hasReturnFields) {
    payload.return_required = returnRequiredFlag(data.get("return_required"));
    payload.return_location_type = String(data.get("return_location_type") || "same_as_pickup").trim() || "same_as_pickup";
    payload.return_address = String(data.get("return_address") || "").trim() || null;
    payload.return_suite_floor = String(data.get("return_suite_floor") || "").trim() || null;
    payload.return_zip = String(data.get("return_zip") || "").trim() || null;
    payload.return_timing = String(data.get("return_timing") || "immediate").trim() || "immediate";

    if (!payload.return_required) {
      payload.return_location_type = null;
      payload.return_address = null;
      payload.return_suite_floor = null;
      payload.return_zip = null;
      payload.return_timing = null;
    } else if (clean(payload.return_location_type) !== "different_location") {
      payload.return_address = null;
      payload.return_suite_floor = null;
      payload.return_zip = null;
      payload.return_location_type = "same_as_pickup";
    }
  }

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
  if (form.job_category) {
    form.job_category.value = normalizeJobCategory(job.job_category);
  }
  if (form.delivery_type) {
    form.delivery_type.value = job.delivery_type || "";
  }
  if (form.service_level) {
    form.service_level.value = job.service_level || "";
  }
  if (form.return_required) {
    form.return_required.value = returnRequiredFlag(job.return_required) ? "true" : "false";
  }
  if (form.return_location_type) {
    form.return_location_type.value = job.return_location_type || "same_as_pickup";
  }
  if (form.return_address) {
    form.return_address.value = job.return_address || "";
  }
  if (form.return_suite_floor) {
    form.return_suite_floor.value = job.return_suite_floor || "";
  }
  if (form.return_zip) {
    form.return_zip.value = job.return_zip || "";
  }
  if (form.return_timing) {
    form.return_timing.value = job.return_timing || "immediate";
  }
  form.package_type.value = job.package_type || "";
  form.package_weight.value = "";
  form.reference_number.value = "";
  form.approved_price.value = job.approved_price ?? job.customer_charge ?? "";
  form.estimated_miles.value = String(job.estimated_miles ?? "");
  form.special_instructions.value = job.special_instructions || "";
  elements.jobCustomerAccountId.value = String(job.customer_account_id || "");
  elements.customerLookupInput.value = job.customer_name || "";
  elements.saveJobBtn.textContent = "Save Delivery";
  syncReturnDetailsVisibility();
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
    primaryAction = `<button class="btn primary" type="button" data-send-invoice="${escapeHtml(String(job.id))}">Send Invoice</button>`;
  } else if (stage === "ready_to_dispatch") {
    primaryAction = `<button class="btn primary" type="button" data-assign-job="${escapeHtml(String(job.id))}">Assign Driver</button>`;
  } else if (stage === "assigned") {
    primaryAction = `<button class="btn primary" type="button" data-assign-job="${escapeHtml(String(job.id))}">Assign / Reassign Driver</button>`;
  }

  const menuActions = [
    `<button class="menu-item" type="button" data-edit-job="${escapeHtml(String(job.id))}">Edit Delivery</button>`,
    `<button class="menu-item" type="button" data-send-invoice="${escapeHtml(String(job.id))}">View Invoice</button>`,
    `<button class="menu-item" type="button" data-send-payment-email="${escapeHtml(String(job.id))}">Send Invoice by Email</button>`,
    `<button class="menu-item" type="button" data-send-payment-text="${escapeHtml(String(job.id))}">Text Payment Link</button>`,
    `<button class="menu-item" type="button" data-copy-payment-link="${escapeHtml(String(job.id))}">Copy Payment Link</button>`,
    `<button class="menu-item" type="button" data-mark-paid-manual="${escapeHtml(String(job.id))}">Mark Paid Manually</button>`
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
        <div class="kv"><strong>Job Category</strong><span>${escapeHtml(jobCategoryLabel(job.job_category))}</span></div>
        <div class="kv"><strong>Return Service</strong><span>${hasReturnRequired(job) ? "RETURN REQUIRED" : "No Return"}</span></div>
        ${(stage === "ready_to_dispatch" || stage === "assigned") ? `<div class="kv"><strong>Driver Pay</strong><span><input type="number" data-driver-pay-detail="${escapeHtml(String(job.id))}" min="0" step="0.01" placeholder="0.00" value="${escapeHtml(String(job.driver_pay ?? ""))}"></span></div>` : ""}
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

    <details class="card"><summary>Package and Service</summary>
      <div class="card-body">
        <div class="kv"><strong>Category</strong><span>${escapeHtml(jobCategoryLabel(job.job_category))}</span></div>
        <div class="kv"><strong>Delivery Type</strong><span>${escapeHtml(deliveryTypeLabel(job.delivery_type))}</span></div>
        <div class="kv"><strong>Service Level</strong><span>${escapeHtml(serviceLevelLabel(job.service_level))}</span></div>
        <div class="kv"><strong>Delivery Speed</strong><span>${escapeHtml(deliverySpeedLabel(job.delivery_speed))}</span></div>
      </div>
    </details>

    <details class="card"><summary>Return Service</summary>
      <div class="card-body">
        <div class="kv"><strong>Return Required</strong><span>${hasReturnRequired(job) ? "Yes" : "No"}</span></div>
        <div class="kv"><strong>Return Location</strong><span>${hasReturnRequired(job) ? escapeHtml(returnLocationLabel(job.return_location_type)) : "-"}</span></div>
        <div class="kv"><strong>Return Destination</strong><span>${escapeHtml(returnDestinationText(job))}</span></div>
        <div class="kv"><strong>Return Timing</strong><span>${hasReturnRequired(job) ? escapeHtml(returnTimingLabel(job.return_timing)) : "-"}</span></div>
      </div>
    </details>

    <details class="card"><summary>Payment and BOL</summary>
      <div class="card-body">
        <div class="kv"><strong>Payment</strong><span>${escapeHtml(String(job.payment_status || "-").toUpperCase())}</span></div>
        <div class="kv"><strong>Invoice</strong><span>${escapeHtml(String(job.invoice_status || "-").toUpperCase())}</span></div>
        <div class="kv"><strong>BOL</strong><span>${escapeHtml(String(job.bol_status || "Unknown"))}</span></div>
        <div class="kv"><strong>BOL Category</strong><span>${escapeHtml(jobCategoryLabel(job.job_category))}</span></div>
        <div class="kv"><strong>BOL Return</strong><span>${hasReturnRequired(job) ? "RETURN REQUIRED" : "No Return"}</span></div>
        <div class="form-actions">
          <button class="btn primary" type="button" id="viewBolBtn-${escapeHtml(String(job.id))}" data-view-bol="${escapeHtml(String(job.id))}">View BOL</button>
        </div>
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

function openAssignModal(jobId, suggestedDriverPay = "") {
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
  const seedPay = String(suggestedDriverPay || job.driver_pay || "").trim();
  elements.assignDriverPay.value = seedPay;
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

  if (driverPayRaw === "") {
    showToast("Enter driver pay before assigning this delivery.", "error");
    return;
  }

  const driverPay = driverPayRaw === "" ? null : Number(driverPayRaw);
  if (driverPay !== null && (!Number.isFinite(driverPay) || driverPay < 0)) {
    showToast("Driver pay must be a valid number", "error");
    return;
  }
  if (driverPay === null || driverPay <= 0) {
    showToast("Driver pay must be greater than 0.", "error");
    return;
  }

  const payload = {
    assigned_driver_id: driverId,
    driver_pay: driverPay,
    status: "assigned",
    driver_acceptance_status: "pending",
    driver_workflow_status: "assigned",
    driver_accepted_at: null,
    driver_rejected_at: null
  };

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
    try {
      localStorage.setItem("mg_dispatch_refresh", new Date().toISOString());
    } catch (_error) {
      // Non-blocking storage refresh signal.
    }
    openJobDetails(jobId, false);
    showToast("Driver assigned successfully", "success");
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

function ensureBolModalElements() {
  if (elements.bolPreviewModal && elements.bolPreviewBody && elements.bolPrintBtn) {
    return;
  }

  let modal = document.getElementById("bolPreviewModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.className = "modal-backdrop bol-modal-backdrop";
    modal.id = "bolPreviewModal";
    modal.innerHTML = `
      <section class="modal-panel bol-modal-panel" role="dialog" aria-modal="true" aria-labelledby="bolPreviewTitle">
        <div class="modal-head bol-modal-head">
          <div>
            <div class="bol-head-brand">MG EXPRESS</div>
            <h3 class="modal-title" id="bolPreviewTitle">Bill of Lading</h3>
          </div>
          <div class="bol-modal-actions no-print">
            <button class="btn" type="button" id="bolPrintBtn">Print / Save PDF</button>
            <button class="btn primary" type="button" data-close-modal="bolPreviewModal">Close</button>
          </div>
        </div>
        <div class="modal-body bol-modal-body" id="bolPreviewBody"></div>
      </section>
    `;
    document.body.appendChild(modal);
  }

  elements.bolPreviewModal = modal;
  elements.bolPreviewBody = modal.querySelector("#bolPreviewBody");
  elements.bolPrintBtn = modal.querySelector("#bolPrintBtn");

  if (elements.bolPrintBtn && elements.bolPrintBtn.dataset.bound !== "true") {
    elements.bolPrintBtn.addEventListener("click", printBolModal);
    elements.bolPrintBtn.dataset.bound = "true";
  }

  if (elements.bolPreviewModal && elements.bolPreviewModal.dataset.printBound !== "true") {
    const cleanup = () => {
      document.body.classList.remove("bol-printing");
    };

    window.addEventListener("afterprint", cleanup);
    elements.bolPreviewModal.dataset.printBound = "true";
  }
}

function compactMultilineText(value) {
  const text = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!text) {
    return "";
  }

  return text
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .join("\n");
}

function toCleanDisplayValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }

  return compactMultilineText(value);
}

function bolFieldRow(label, value) {
  const cleanValue = toCleanDisplayValue(value);
  if (!cleanValue) {
    return "";
  }

  return `
    <div class="bol-kv">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(cleanValue)}</span>
    </div>
  `;
}

function buildBolSection(title, rows, sectionClass = "") {
  const filteredRows = rows.filter(Boolean);
  if (!filteredRows.length) {
    return "";
  }

  return `
    <section class="bol-section ${escapeHtml(sectionClass)}">
      <h4>${escapeHtml(title)}</h4>
      <div class="bol-grid">
        ${filteredRows.join("")}
      </div>
    </section>
  `;
}

function renderBolDeliveryData(selectedDelivery) {
  ensureBolModalElements();

  const selectedId = String(selectedDelivery?.id || "").trim();
  if (!selectedId) {
    showToast("Unable to open BOL: selected delivery not found", "error");
    return false;
  }

  const job = getRowById(selectedId);
  if (!job || !job.id) {
    showToast("Unable to open BOL: selected delivery not found", "error");
    return false;
  }

  const pickupScheduled = toDisplayDateTime(readJobField(job, [
    "scheduled_pickup_at",
    "pickup_scheduled_at",
    "requested_pickup_at",
    "pickup_window_start"
  ]));
  const deliveryScheduled = toDisplayDateTime(readJobField(job, [
    "scheduled_delivery_at",
    "delivery_scheduled_at",
    "requested_delivery_at",
    "delivery_window_start"
  ]));

  const customerRows = [
    bolFieldRow("Customer Name", String(job.customer_name || "-"))
  ];

  const companyName = readJobField(job, ["company_name"]);
  if (companyName) {
    customerRows.push(bolFieldRow("Company Name", companyName));
  }

  const customerPhone = readJobField(job, ["customer_phone", "phone"]);
  if (customerPhone) {
    customerRows.push(bolFieldRow("Customer Phone", customerPhone));
  }

  const customerEmail = readJobField(job, ["customer_email", "email"]);
  if (customerEmail) {
    customerRows.push(bolFieldRow("Customer Email", customerEmail));
  }

  const customerReference = readJobField(job, ["reference_number", "customer_reference_number"]);
  if (customerReference) {
    customerRows.push(bolFieldRow("Reference Number", customerReference));
  }

  const pickupRows = [
    bolFieldRow("Pickup Address", job.pickup_address),
    bolFieldRow("Suite / Floor", job.pickup_suite_floor),
    bolFieldRow("City", parseCity(job.pickup_address || "")),
    bolFieldRow("ZIP", job.pickup_zip)
  ];

  const pickupContactName = readJobField(job, ["pickup_contact_name"]);
  if (pickupContactName) {
    pickupRows.push(bolFieldRow("Pickup Contact", pickupContactName));
  }

  const pickupContactPhone = readJobField(job, ["pickup_contact_phone"]);
  if (pickupContactPhone) {
    pickupRows.push(bolFieldRow("Pickup Phone", pickupContactPhone));
  }

  const pickupInstructions = readJobField(job, ["pickup_instructions"]);
  if (pickupInstructions) {
    pickupRows.push(bolFieldRow("Pickup Instructions", pickupInstructions));
  }

  if (pickupScheduled) {
    pickupRows.push(bolFieldRow("Scheduled Pickup Date / Time", pickupScheduled));
  }

  const deliveryRows = [
    bolFieldRow("Delivery Address", job.delivery_address),
    bolFieldRow("Suite / Floor", job.delivery_suite_floor),
    bolFieldRow("City", parseCity(job.delivery_address || "")),
    bolFieldRow("ZIP", job.delivery_zip)
  ];

  const recipientName = readJobField(job, ["delivery_recipient_name"]);
  if (recipientName) {
    deliveryRows.push(bolFieldRow("Delivery Recipient", recipientName));
  }

  const deliveryContactPhone = readJobField(job, ["delivery_contact_phone"]);
  if (deliveryContactPhone) {
    deliveryRows.push(bolFieldRow("Delivery Phone", deliveryContactPhone));
  }

  const deliveryInstructions = readJobField(job, ["delivery_instructions"]);
  if (deliveryInstructions) {
    deliveryRows.push(bolFieldRow("Delivery Instructions", deliveryInstructions));
  }

  if (deliveryScheduled) {
    deliveryRows.push(bolFieldRow("Scheduled Delivery Date / Time", deliveryScheduled));
  }

  const podRecipientName = readJobField(job, ["pod_recipient_name"]);
  if (podRecipientName) {
    deliveryRows.push(bolFieldRow("POD Recipient Name", podRecipientName));
  }

  const packageRows = [
    bolFieldRow("Package Type / Description", job.package_type),
    bolFieldRow("Vehicle Type", job.vehicle_type),
    bolFieldRow("Delivery Type", deliveryTypeLabel(job.delivery_type)),
    bolFieldRow("Service Level", serviceLevelLabel(job.service_level)),
    bolFieldRow("Delivery Speed", deliverySpeedLabel(job.delivery_speed))
  ];

  const quantity = readJobField(job, ["package_quantity", "quantity", "item_quantity"]);
  if (quantity) {
    packageRows.push(bolFieldRow("Quantity", quantity));
  }

  const weight = readJobField(job, ["package_weight", "weight"]);
  if (weight) {
    packageRows.push(bolFieldRow("Weight", weight));
  }

  const estimatedMiles = readJobField(job, ["estimated_miles"]);
  if (estimatedMiles) {
    packageRows.push(bolFieldRow("Estimated Miles", estimatedMiles));
  }

  const specialHandling = readJobField(job, [
    "special_handling_instructions",
    "handling_instructions"
  ]);
  if (specialHandling) {
    packageRows.push(bolFieldRow("Special Handling Instructions", specialHandling));
  }

  let returnSection = "";
  if (hasReturnRequired(job)) {
    const returnRows = [
      bolFieldRow("Return Timing", returnTimingLabel(job.return_timing)),
      bolFieldRow("Return Destination Type", returnLocationLabel(job.return_location_type))
    ];

    if (clean(job.return_location_type) === "same_as_pickup") {
      returnRows.push(bolFieldRow("Return Destination", "Original Pickup Location"));
    } else {
      returnRows.push(bolFieldRow("Return Address", job.return_address));
      returnRows.push(bolFieldRow("Return Suite / Floor", job.return_suite_floor));
      returnRows.push(bolFieldRow("Return ZIP", job.return_zip));
    }

    const returnInstructions = readJobField(job, ["return_instructions"]);
    if (returnInstructions) {
      returnRows.push(bolFieldRow("Return Instructions", returnInstructions));
    }

    returnSection = buildBolSection("Return Service", returnRows);
  }

  const returnBadge = hasReturnRequired(job)
    ? '<span class="badge badge-return bol-return-badge">RETURN REQUIRED</span>'
    : "";

  elements.bolPreviewBody.innerHTML = `
    <article class="bol-sheet" id="bolPrintContainer" data-bol-id="${escapeHtml(String(job.id))}">
      <header class="bol-header">
        <div class="bol-title-wrap">
          <div class="bol-brand">MG EXPRESS</div>
          <h2 class="bol-title">BILL OF LADING</h2>
        </div>
        <div class="bol-head-grid">
          ${bolFieldRow("Job / Delivery Number", String(job.job_number || "-"))}
          ${bolFieldRow("Created Date", formatDate(job.created_at))}
          ${bolFieldRow("Job Category", jobCategoryLabel(job.job_category))}
        </div>
        ${returnBadge}
      </header>

      <div class="bol-layout bol-screen-grid bol-print-grid">
        <div class="bol-column">
          ${buildBolSection("Customer", customerRows, "bol-section-compact")}
          ${buildBolSection("Pickup", pickupRows, "bol-section-compact")}
        </div>
        <div class="bol-column">
          ${buildBolSection("Delivery", deliveryRows, "bol-section-compact")}
          ${buildBolSection("Package and Service", packageRows, "bol-section-compact")}
        </div>
      </div>

      ${returnSection}
    </article>
  `;

  return true;
}

function openBolModalForJob(selectedDelivery) {
  if (!selectedDelivery || !selectedDelivery.id) {
    showToast("Unable to open BOL: selected delivery not found", "error");
    return false;
  }

  const rendered = renderBolDeliveryData(selectedDelivery);
  if (!rendered) {
    return false;
  }

  openModal("bolPreviewModal");
  return true;
}

function openBolForJob(selectedDelivery) {
  if (!selectedDelivery || !selectedDelivery.id) {
    showToast("Unable to open BOL: selected delivery not found", "error");
    return false;
  }

  const id = String(selectedDelivery.id).trim();
  if (!id) {
    showToast("Unable to open BOL: missing delivery id", "error");
    return false;
  }

  window.open("/bol.html?id=" + encodeURIComponent(id), "_blank");
  return true;
}

function printBolModal(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (!elements.bolPreviewModal || !elements.bolPreviewModal.classList.contains("open")) {
    showToast("Open a BOL before printing.", "info");
    return;
  }

  if (!elements.bolPreviewBody || elements.bolPreviewBody.querySelectorAll("#bolPrintContainer").length !== 1) {
    showToast("Unable to print BOL: printable layout is not ready.", "error");
    return;
  }

  document.body.classList.add("bol-printing");

  window.print();
}

function handleViewBolClick(event, buttonElement) {
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }

  const selectedDelivery = state.selectedJob && state.selectedJob.id
    ? state.selectedJob
    : getRowById(buttonElement?.getAttribute("data-view-bol"));

  return openBolForJob(selectedDelivery);
}

function normalizePaymentStatusLabel(value) {
  const token = clean(value);
  const map = {
    unpaid: "Unpaid",
    payment_sent: "Payment Sent",
    sent: "Payment Sent",
    pending: "Payment Sent",
    paid: "Paid",
    received: "Paid",
    refunded: "Refunded",
    failed: "Failed"
  };

  return map[token] || (String(value || "Unpaid").replaceAll("_", " ").trim() || "Unpaid");
}

function parseOptionalAmount(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function resolveInvoicePaymentLink(invoice, job) {
  const raw = firstPresentValue([
    invoice?.payment_link_url,
    invoice?.payment_url,
    invoice?.payment_link,
    invoice?.checkout_url,
    job?.payment_link_url,
    job?.customer_payment_link,
    job?.invoice_payment_link,
    job?.payment_url
  ]);
  return validHttpUrl(raw);
}

function resolveInvoiceUrl(invoice) {
  const raw = firstPresentValue([
    invoice?.invoice_url,
    invoice?.hosted_invoice_url,
    invoice?.pdf_url,
    invoice?.invoice_pdf_url
  ]);
  return validHttpUrl(raw);
}

async function fetchLatestInvoiceForJob(jobId) {
  const result = await client
    .from("invoices")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (result.error) {
    throw result.error;
  }

  return result.data?.[0] || null;
}

function ensureInvoiceModalElements() {
  if (elements.invoicePreviewModal && elements.invoicePreviewBody && elements.invoicePrintBtn) {
    return;
  }

  let modal = document.getElementById("invoicePreviewModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.className = "modal-backdrop invoice-modal-backdrop";
    modal.id = "invoicePreviewModal";
    modal.innerHTML = `
      <section class="modal-panel invoice-modal-panel" role="dialog" aria-modal="true" aria-labelledby="invoicePreviewTitle">
        <div class="modal-head invoice-modal-head">
          <div>
            <div class="invoice-head-brand">MG EXPRESS</div>
            <h3 class="modal-title" id="invoicePreviewTitle">Invoice</h3>
          </div>
          <div class="invoice-modal-actions no-print">
            <button class="btn" type="button" id="invoicePrintBtn">Print / Save PDF</button>
            <button class="btn" type="button" id="invoiceCopyLinkBtn">Copy Payment Link</button>
            <button class="btn" type="button" id="invoiceEmailBtn">Email Invoice</button>
            <button class="btn" type="button" id="invoiceTextBtn">Text Payment Link</button>
            <button class="btn primary" type="button" data-close-modal="invoicePreviewModal">Close</button>
          </div>
        </div>
        <div class="modal-body invoice-modal-body" id="invoicePreviewBody"></div>
      </section>
    `;
    document.body.appendChild(modal);
  }

  elements.invoicePreviewModal = modal;
  elements.invoicePreviewBody = modal.querySelector("#invoicePreviewBody");
  elements.invoicePrintBtn = modal.querySelector("#invoicePrintBtn");
  elements.invoiceCopyLinkBtn = modal.querySelector("#invoiceCopyLinkBtn");
  elements.invoiceEmailBtn = modal.querySelector("#invoiceEmailBtn");
  elements.invoiceTextBtn = modal.querySelector("#invoiceTextBtn");

  if (elements.invoicePrintBtn && elements.invoicePrintBtn.dataset.bound !== "true") {
    elements.invoicePrintBtn.addEventListener("click", printInvoiceModal);
    elements.invoicePrintBtn.dataset.bound = "true";
  }
  if (elements.invoiceCopyLinkBtn && elements.invoiceCopyLinkBtn.dataset.bound !== "true") {
    elements.invoiceCopyLinkBtn.addEventListener("click", () => copyPaymentLink(state.activeInvoice?.jobId || ""));
    elements.invoiceCopyLinkBtn.dataset.bound = "true";
  }
  if (elements.invoiceEmailBtn && elements.invoiceEmailBtn.dataset.bound !== "true") {
    elements.invoiceEmailBtn.addEventListener("click", () => sendPaymentLinkByEmail(state.activeInvoice?.jobId || ""));
    elements.invoiceEmailBtn.dataset.bound = "true";
  }
  if (elements.invoiceTextBtn && elements.invoiceTextBtn.dataset.bound !== "true") {
    elements.invoiceTextBtn.addEventListener("click", () => sendPaymentLinkByText(state.activeInvoice?.jobId || ""));
    elements.invoiceTextBtn.dataset.bound = "true";
  }

  if (elements.invoicePreviewModal && elements.invoicePreviewModal.dataset.printBound !== "true") {
    const cleanup = () => {
      document.body.classList.remove("invoice-printing");
    };
    window.addEventListener("afterprint", cleanup);
    elements.invoicePreviewModal.dataset.printBound = "true";
  }
}

function invoiceFieldRow(label, value, rowClass = "") {
  const cleanValue = toCleanDisplayValue(value);
  if (!cleanValue || cleanValue === "-") {
    return "";
  }

  return `
    <div class="invoice-kv ${escapeHtml(rowClass)}">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(cleanValue)}</span>
    </div>
  `;
}

function buildInvoiceSection(title, rows) {
  const filteredRows = rows.filter(Boolean);
  if (!filteredRows.length) {
    return "";
  }

  return `
    <section class="invoice-section">
      <h4>${escapeHtml(title)}</h4>
      <div class="invoice-grid">
        ${filteredRows.join("")}
      </div>
    </section>
  `;
}

function updateInvoicePaymentActionState(paymentLink) {
  const connected = Boolean(paymentLink);
  const hint = connected ? "" : "Payment integration not connected";

  [elements.invoiceCopyLinkBtn, elements.invoiceEmailBtn, elements.invoiceTextBtn].forEach(button => {
    if (!button) {
      return;
    }

    button.disabled = !connected;
    button.title = hint;
  });
}

function renderInvoiceData(context) {
  ensureInvoiceModalElements();

  const job = context?.job;
  if (!job || !job.id) {
    showToast("Unable to open invoice: selected delivery not found", "error");
    return false;
  }

  const invoice = context.invoice || null;
  const paymentLink = context.paymentLink || "";
  const invoiceUrl = context.invoiceUrl || "";
  const amount = parseOptionalAmount(firstPresentValue([invoice?.amount, job.approved_price, job.customer_charge]));
  const taxAmount = parseOptionalAmount(firstPresentValue([invoice?.tax_amount, invoice?.taxes]));
  const additionalFees = parseOptionalAmount(firstPresentValue([invoice?.additional_fees, invoice?.approved_fees]));
  const explicitTotal = parseOptionalAmount(firstPresentValue([invoice?.total_due, invoice?.total_amount]));
  const computedTotal = (amount || 0) + (taxAmount || 0) + (additionalFees || 0);
  const totalDue = explicitTotal !== null ? explicitTotal : computedTotal;

  const customerRows = [
    invoiceFieldRow("Customer Name", firstPresentValue([invoice?.customer_name, job.customer_name])),
    invoiceFieldRow("Company Name", firstPresentValue([invoice?.company_name, job.company_name])),
    invoiceFieldRow("Customer Email", firstPresentValue([invoice?.customer_email, job.customer_email])),
    invoiceFieldRow("Customer Phone", firstPresentValue([invoice?.customer_phone, job.customer_phone])),
    invoiceFieldRow("Billing Address", firstPresentValue([
      invoice?.billing_address,
      invoice?.billing_address_line1,
      job.billing_address,
      job.customer_billing_address
    ]))
  ];

  const deliveryRows = [
    invoiceFieldRow("Pickup Summary", firstPresentValue([job.pickup_address])),
    invoiceFieldRow("Delivery Summary", firstPresentValue([job.delivery_address])),
    invoiceFieldRow("Job Category", jobCategoryLabel(job.job_category)),
    invoiceFieldRow("Delivery Type", deliveryTypeLabel(job.delivery_type)),
    invoiceFieldRow("Service Level", serviceLevelLabel(job.service_level)),
    invoiceFieldRow("Delivery Speed", deliverySpeedLabel(job.delivery_speed)),
    invoiceFieldRow("Estimated Miles", firstPresentValue([job.estimated_miles]))
  ];

  const billingRows = [
    invoiceFieldRow("Customer Price", amount === null ? "" : money(amount)),
    invoiceFieldRow("Taxes", taxAmount === null ? "" : money(taxAmount)),
    invoiceFieldRow("Additional Fees", additionalFees === null ? "" : money(additionalFees)),
    invoiceFieldRow("Total Due", totalDue === null ? "" : money(totalDue), "invoice-total"),
    invoiceFieldRow("Payment Status", normalizePaymentStatusLabel(firstPresentValue([invoice?.payment_status, job.payment_status, "unpaid"]))),
    invoiceFieldRow("Payment Link", paymentLink)
  ];

  elements.invoicePreviewBody.innerHTML = `
    <section class="invoice-print-area" id="invoicePrintArea">
      <article class="invoice-sheet" id="invoicePrintContainer" data-invoice-job-id="${escapeHtml(String(job.id))}">
        <header class="invoice-header">
          <div>
            <div class="invoice-brand">MG EXPRESS</div>
            <h2 class="invoice-title">INVOICE</h2>
          </div>
          <div class="invoice-head-grid">
            ${invoiceFieldRow("Invoice Number", firstPresentValue([invoice?.invoice_number]))}
            ${invoiceFieldRow("Delivery / Job Number", firstPresentValue([job.job_number]))}
            ${invoiceFieldRow("Invoice Date", formatDate(firstPresentValue([invoice?.created_at, job.created_at])))}
            ${invoiceFieldRow("Invoice URL", invoiceUrl)}
          </div>
        </header>

        <div class="invoice-layout invoice-screen-grid invoice-print-grid">
          <div class="invoice-column">
            ${buildInvoiceSection("Customer", customerRows)}
            ${buildInvoiceSection("Billing", billingRows)}
          </div>
          <div class="invoice-column">
            ${buildInvoiceSection("Delivery Summary", deliveryRows)}
          </div>
        </div>
      </article>
    </section>
    ${!paymentLink ? '<div class="hint invoice-hint">Payment integration not connected</div>' : ""}
  `;

  updateInvoicePaymentActionState(paymentLink);
  return true;
}

async function openInvoiceModalForJob(job) {
  if (!job || !job.id) {
    showToast("Unable to open invoice: selected delivery not found", "error");
    return false;
  }

  ensureInvoiceModalElements();

  try {
    const invoice = await fetchLatestInvoiceForJob(job.id);
    const context = {
      job,
      invoice,
      jobId: String(job.id),
      paymentLink: resolveInvoicePaymentLink(invoice, job),
      invoiceUrl: resolveInvoiceUrl(invoice)
    };

    state.activeInvoice = context;

    const rendered = renderInvoiceData(context);
    if (!rendered) {
      return false;
    }

    openModal("invoicePreviewModal");
    return true;
  } catch (error) {
    showToast(error.message || "Unable to open invoice", "error");
    return false;
  }
}

function openInvoiceForJob(job) {
  if (!job || !job.id) {
    showToast("Unable to open invoice: selected delivery not found", "error");
    return false;
  }

  const id = String(job.id).trim();
  if (!id) {
    showToast("Unable to open invoice: missing delivery id", "error");
    return false;
  }

  window.open("/invoice.html?id=" + encodeURIComponent(id), "_blank");
  return true;
}

async function sendInvoiceForJob(jobId) {
  const job = getRowById(jobId);
  if (!job) {
    showToast("Unable to open invoice: selected delivery not found", "error");
    return;
  }

  try {
    openInvoiceForJob(job);
  } catch (error) {
    showToast(error.message || "Unable to open invoice", "error");
  }
}

function printInvoiceModal(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (!elements.invoicePreviewModal || !elements.invoicePreviewModal.classList.contains("open")) {
    showToast("Open an invoice before printing.", "info");
    return;
  }

  if (!elements.invoicePreviewBody || elements.invoicePreviewBody.querySelectorAll("#invoicePrintArea").length !== 1 || elements.invoicePreviewBody.querySelectorAll("#invoicePrintContainer").length !== 1) {
    showToast("Unable to print invoice: printable layout is not ready.", "error");
    return;
  }

  document.body.classList.add("invoice-printing");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.print();
    });
  });
}

function sendPaymentLinkByText(jobId) {
  const job = getRowById(jobId);
  if (!job) {
    showToast("Selected delivery not found", "error");
    return;
  }

  try {
    const safeLink = state.activeInvoice?.jobId === String(job.id)
      ? String(state.activeInvoice.paymentLink || "")
      : resolveInvoicePaymentLink(state.activeInvoice?.invoice || null, job);
    if (!safeLink) {
      throw new Error("Payment integration not connected");
    }

    const text = "MG Express delivery payment link: " + safeLink;
    window.location.href = "sms:?&body=" + encodeURIComponent(text);
  } catch (error) {
    showToast(error.message || "Unable to send payment link by text", "error");
  }
}

function sendPaymentLinkByEmail(jobId) {
  const job = getRowById(jobId);
  if (!job) {
    showToast("Selected delivery not found", "error");
    return;
  }

  try {
    const safeLink = state.activeInvoice?.jobId === String(job.id)
      ? String(state.activeInvoice.paymentLink || "")
      : resolveInvoicePaymentLink(state.activeInvoice?.invoice || null, job);
    if (!safeLink) {
      throw new Error("Payment integration not connected");
    }

    const subject = "Invoice Payment Link - " + String(job.job_number || "Delivery");
    const body = "Please use this payment link: " + safeLink;
    window.location.href = "mailto:?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
  } catch (error) {
    showToast(error.message || "Unable to send invoice by email", "error");
  }
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
    showToast("Selected delivery not found", "error");
    return;
  }

  const safeLink = state.activeInvoice?.jobId === String(job.id)
    ? String(state.activeInvoice.paymentLink || "")
    : resolveInvoicePaymentLink(state.activeInvoice?.invoice || null, job);
  if (!safeLink) {
    showToast("Invoice integration not connected", "error");
    return;
  }

  try {
    await navigator.clipboard.writeText(safeLink);
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

async function markPaidManually(jobId) {
  const job = getRowById(jobId);
  if (!job) {
    showToast("Selected delivery not found", "error");
    return;
  }

  const confirmed = window.confirm("Confirm payment has been received for this delivery?");
  if (!confirmed) {
    return;
  }

  try {
    const quoteResult = await client
      .from("quotes")
      .update({ payment_status: "paid", status: "ready" })
      .eq("id", jobId)
      .select("*")
      .maybeSingle();

    if (quoteResult.error) {
      throw quoteResult.error;
    }

    const latestInvoice = await fetchLatestInvoiceForJob(jobId);
    if (latestInvoice?.id) {
      const invoiceResult = await client
        .from("invoices")
        .update({ payment_status: "paid" })
        .eq("id", latestInvoice.id);

      if (invoiceResult.error) {
        throw invoiceResult.error;
      }
    }

    await loadRows();
    try {
      localStorage.setItem("mg_dispatch_refresh", new Date().toISOString());
    } catch (_error) {
      // Non-blocking cross-workspace refresh signal.
    }
    openJobDetails(jobId, false);
    showToast("Payment received. Delivery is ready to dispatch.", "success");
  } catch (error) {
    showToast(error.message || "Unable to mark payment as received", "error");
  }
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

  if (!elements.categoryFilter) {
    const statusField = elements.statusFilter?.closest(".field");
    const controls = statusField?.parentElement;
    if (statusField && controls) {
      const categoryField = document.createElement("div");
      categoryField.className = "field";
      categoryField.innerHTML = `
        <label>Category</label>
        <select id="categoryFilter">
          <option value="all">All</option>
          <option value="medical">Medical</option>
          <option value="pallet">Pallet</option>
          <option value="legal">Legal</option>
          <option value="general">General</option>
          <option value="special">Special</option>
        </select>
      `;
      statusField.insertAdjacentElement("afterend", categoryField);
      elements.categoryFilter = document.getElementById("categoryFilter");
    }
  }
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

  const viewBol = target.closest("[data-view-bol]");
  if (viewBol) {
    handleViewBolClick(event, viewBol);
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
    const detailPayInput = target.closest(".card-body")?.querySelector("[data-driver-pay-detail]");
    const payDraft = String(detailPayInput?.value || "").trim();
    openAssignModal(assignJob.getAttribute("data-assign-job"), payDraft);
    return;
  }

  const assignDriver = target.closest("[data-assign-driver]");
  if (assignDriver) {
    const panelPayInput = document.getElementById("assignPanelDriverPayInput");
    if (panelPayInput) {
      elements.assignDriverPay.value = String(panelPayInput.value || "").trim();
    }
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

  const markPaidManualBtn = target.closest("[data-mark-paid-manual]");
  if (markPaidManualBtn) {
    markPaidManually(markPaidManualBtn.getAttribute("data-mark-paid-manual"));
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
  ensureBolModalElements();
  ensureInvoiceModalElements();

  elements.searchInput.addEventListener("input", renderWorkspace);
  elements.customerSearchInput.addEventListener("input", renderWorkspace);
  elements.jobSearchInput.addEventListener("input", renderWorkspace);
  elements.statusFilter.addEventListener("change", renderWorkspace);
  if (elements.categoryFilter) {
    elements.categoryFilter.addEventListener("change", renderWorkspace);
  }
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
  elements.jobForm.addEventListener("input", () => {
    syncReturnDetailsVisibility();
    renderNewDeliveryReview();
  });
  if (elements.jobForm.return_required) {
    elements.jobForm.return_required.addEventListener("change", () => {
      syncReturnDetailsVisibility();
      renderNewDeliveryReview();
    });
  }
  if (elements.jobForm.return_location_type) {
    elements.jobForm.return_location_type.addEventListener("change", () => {
      syncReturnDetailsVisibility();
      renderNewDeliveryReview();
    });
  }
  elements.jobForm.addEventListener("submit", submitJobForm);
  elements.assignForm.addEventListener("submit", assignOrReassignDriver);

  document.removeEventListener("click", handleDocumentClick);
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

window.MG_DISPATCH_WORKSPACE = Object.freeze({
  client,
  state,
  getWorkflowStage,
  statusLabel,
  badgeClass,
  jobCategoryLabel,
  jobCategoryClass,
  deliverySpeedLabel,
  deliveryTypeLabel,
  serviceLevelLabel,
  hasReturnRequired,
  returnLocationLabel,
  returnTimingLabel,
  returnDestinationText,
  formatDate,
  formatDateTime,
  money,
  parseCity,
  getRowById,
  openJobDetails,
  openEditJobModal,
  openAssignModal,
  sendInvoiceForJob,
  openInvoiceForJob,
  sendPaymentLinkByText,
  sendPaymentLinkByEmail,
  copyPaymentLink,
  markPaidManually,
  deleteDelivery,
  changeDispatchStatus,
  resendToDriver,
  openBolForJob,
  handleDocumentClick,
  openRejectedReturnConfirm,
  returnRejectedToReady,
  loadDrivers,
  loadRows,
  renderWorkspace,
  openModal,
  closeModal,
  showToast
});

window.MGDeliveryDetails = window.MGDeliveryDetails || {};
window.MGDeliveryDetails.open = function openSharedDeliveryDetails(jobId, readOnly = false) {
  return openJobDetails(jobId, readOnly);
};

if (workspaceMode !== "deliveries_center") {
  (async function startPage() {
    try {
      readAssignDriverFocusFromQuery();

      const session = await requireDispatchAccess();
      if (!session) {
        return;
      }

      applyWorkspacePresentation();
      bindEvents();
      syncReturnDetailsVisibility();
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
}
