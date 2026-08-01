const client = supabase.createClient(
  "https://dczlucwfjayymlwbzzdi.supabase.co",
  "sb_publishable_kcv_a78ZyUxMo2neKUANdw_XN7eAMpI"
);

window.mgDispatchClient = client;

const CLOSED_STATUSES = new Set(["completed", "delivered", "closed", "canceled", "cancelled"]);
const PICKUP_REMAINING_STATUSES = new Set(["assigned", "en_route_pickup", "arrived_pickup"]);
const DELIVERY_REMAINING_STATUSES = new Set(["picked_up", "en_route_delivery", "arrived_delivery"]);

const state = {
  drivers: [],
  quotes: [],
  summaries: [],
  searchQuery: "",
  availabilityFilter: "all",
  selectedDriverId: "",
  isLoading: false
};

const elements = {
  staffEmail: document.getElementById("staffEmail"),
  driverSearchInput: document.getElementById("driverSearchInput"),
  refreshDriversBtn: document.getElementById("refreshDriversBtn"),
  driversGrid: document.getElementById("driversGrid"),
  visibleDriversMeta: document.getElementById("visibleDriversMeta"),
  summaryTotal: document.getElementById("summaryTotal"),
  summaryAvailable: document.getElementById("summaryAvailable"),
  summaryBusy: document.getElementById("summaryBusy"),
  summaryOffline: document.getElementById("summaryOffline"),
  loadErrorBanner: document.getElementById("loadErrorBanner"),
  driverDetailsModal: document.getElementById("driverDetailsModal"),
  driverDetailsBody: document.getElementById("driverDetailsBody"),
  assignDeliveryBtn: document.getElementById("assignDeliveryBtn"),
  toastWrap: document.getElementById("toastWrap")
};

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}

function clean(value) {
  return String(value || "").trim().toLowerCase();
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

function money(value) {
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

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function getDriverDisplayName(driver) {
  const preferred =
    driver.full_name ||
    driver.display_name ||
    driver.name;

  if (preferred) {
    return String(preferred);
  }

  const email = String(driver.email || "");
  if (!email.includes("@")) {
    return "Driver";
  }

  const localPart = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  return localPart || "Driver";
}

function toCity(addressText) {
  const text = String(addressText || "").trim();
  if (!text) {
    return "";
  }

  const parts = text.split(",").map(part => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }

  return parts[0] || "";
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfToday() {
  const date = startOfToday();
  date.setDate(date.getDate() + 1);
  return date;
}

function isQuoteClosed(quote) {
  return CLOSED_STATUSES.has(clean(quote.status));
}

function isRejectedAssignment(quote) {
  return clean(quote.driver_acceptance_status) === "rejected";
}

function pickQuoteTimestamp(quote) {
  return (
    quote.driver_rejected_at ||
    quote.driver_accepted_at ||
    quote.updated_at ||
    quote.created_at ||
    ""
  );
}

function getDriverLastActiveValue(driver, relatedQuotes) {
  const candidateFields = [
    "last_active_at",
    "last_seen_at",
    "status_updated_at",
    "updated_at"
  ];

  for (const field of candidateFields) {
    if (driver[field]) {
      return driver[field];
    }
  }

  const newestQuote = relatedQuotes
    .slice()
    .sort((a, b) => {
      const aDate = parseDate(pickQuoteTimestamp(a));
      const bDate = parseDate(pickQuoteTimestamp(b));
      return (bDate?.getTime() || 0) - (aDate?.getTime() || 0);
    })[0];

  return newestQuote ? pickQuoteTimestamp(newestQuote) : "";
}

function deriveVehicleText(driver) {
  return (
    driver.vehicle_type ||
    driver.vehicle ||
    [driver.vehicle_year, driver.vehicle_make, driver.vehicle_model]
      .filter(Boolean)
      .join(" ") ||
    ""
  );
}

function deriveAreaWhenAvailable(driver, relatedQuotes) {
  const fromDriver = driver.current_area || driver.area || driver.city || "";
  if (fromDriver) {
    return String(fromDriver);
  }

  const latest = relatedQuotes
    .slice()
    .sort((a, b) => {
      const aDate = parseDate(pickQuoteTimestamp(a));
      const bDate = parseDate(pickQuoteTimestamp(b));
      return (bDate?.getTime() || 0) - (aDate?.getTime() || 0);
    })[0];

  if (!latest) {
    return "";
  }

  return toCity(latest.pickup_address) || toCity(latest.delivery_address) || "";
}

function quoteWorkflowStatus(quote) {
  return clean(quote.driver_workflow_status) || "assigned";
}

function isDriverInactive(driver) {
  const activeFlag =
    driver.active ??
    driver.is_active ??
    driver.enabled;

  if (activeFlag === false) {
    return true;
  }

  const statusText = clean(driver.status || driver.availability_status);
  return ["inactive", "offline", "off_duty", "disabled"].includes(statusText);
}

function calculateDriverWorkload(relatedQuotes) {
  const activeQuotes = relatedQuotes.filter(quote => {
    if (isRejectedAssignment(quote)) {
      return false;
    }
    return !isQuoteClosed(quote);
  });

  const pickupRemaining = activeQuotes.filter(quote => PICKUP_REMAINING_STATUSES.has(quoteWorkflowStatus(quote))).length;
  const deliveryRemaining = activeQuotes.filter(quote => DELIVERY_REMAINING_STATUSES.has(quoteWorkflowStatus(quote))).length;

  return {
    activeAssignedJobs: activeQuotes.length,
    pickupRemaining,
    deliveryRemaining
  };
}

function getAvailabilityState(driver, workload) {
  if (isDriverInactive(driver)) {
    return "offline";
  }

  if (workload.activeAssignedJobs > 0) {
    return "busy";
  }

  return "available";
}

function getRejectedLastJobFlag(relatedQuotes) {
  if (!relatedQuotes.length) {
    return false;
  }

  const latestAssignment = relatedQuotes
    .slice()
    .sort((a, b) => {
      const aDate = parseDate(pickQuoteTimestamp(a));
      const bDate = parseDate(pickQuoteTimestamp(b));
      return (bDate?.getTime() || 0) - (aDate?.getTime() || 0);
    })[0];

  return clean(latestAssignment?.driver_acceptance_status) === "rejected";
}

function completedTodayCount(relatedQuotes) {
  const start = startOfToday();
  const end = endOfToday();

  return relatedQuotes.filter(quote => {
    const workflow = clean(quote.driver_workflow_status);
    const status = clean(quote.status);
    const isComplete =
      status === "completed" ||
      status === "delivered" ||
      status === "closed" ||
      workflow === "delivered";

    if (!isComplete) {
      return false;
    }

    const completedAt = parseDate(quote.completed_at || quote.updated_at || quote.created_at);
    if (!completedAt) {
      return false;
    }

    return completedAt >= start && completedAt < end;
  }).length;
}

function weeklyEarnings(relatedQuotes) {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - 6);

  return relatedQuotes.reduce((sum, quote) => {
    const status = clean(quote.status);
    const workflow = clean(quote.driver_workflow_status);
    const isComplete =
      status === "completed" ||
      status === "delivered" ||
      status === "closed" ||
      workflow === "delivered";

    if (!isComplete) {
      return sum;
    }

    const when = parseDate(quote.completed_at || quote.updated_at || quote.created_at);
    if (!when || when < weekStart) {
      return sum;
    }

    return sum + Number(quote.driver_pay || 0);
  }, 0);
}

function todayEarnings(relatedQuotes) {
  const start = startOfToday();
  const end = endOfToday();

  return relatedQuotes.reduce((sum, quote) => {
    const status = clean(quote.status);
    const workflow = clean(quote.driver_workflow_status);
    const isComplete =
      status === "completed" ||
      status === "delivered" ||
      status === "closed" ||
      workflow === "delivered";

    if (!isComplete) {
      return sum;
    }

    const when = parseDate(quote.completed_at || quote.updated_at || quote.created_at);
    if (!when || when < start || when >= end) {
      return sum;
    }

    return sum + Number(quote.driver_pay || 0);
  }, 0);
}

function buildDriverSummaries() {
  const summaries = state.drivers.map(driver => {
    const driverId = String(driver.id || "");
    const relatedQuotes = state.quotes.filter(quote => String(quote.assigned_driver_id || "") === driverId);
    const workload = calculateDriverWorkload(relatedQuotes);
    const availability = getAvailabilityState(driver, workload);
    const completedToday = completedTodayCount(relatedQuotes);

    return {
      id: driverId,
      name: getDriverDisplayName(driver),
      availability,
      areaWhenAvailable: availability === "available" ? deriveAreaWhenAvailable(driver, relatedQuotes) : "",
      activeAssignedJobs: workload.activeAssignedJobs,
      pickupRemaining: workload.pickupRemaining,
      deliveryRemaining: workload.deliveryRemaining,
      completedToday,
      lastActiveAt: getDriverLastActiveValue(driver, relatedQuotes),
      vehicleTypeWhenAvailable: availability === "available" ? deriveVehicleText(driver) : "",
      rejectedLastJob: getRejectedLastJobFlag(relatedQuotes),
      driver,
      relatedQuotes,
      earningsToday: todayEarnings(relatedQuotes),
      earningsWeek: weeklyEarnings(relatedQuotes)
    };
  });

  const availabilityOrder = {
    available: 0,
    busy: 1,
    offline: 2
  };

  summaries.sort((a, b) => {
    const groupDelta = (availabilityOrder[a.availability] || 99) - (availabilityOrder[b.availability] || 99);
    if (groupDelta !== 0) {
      return groupDelta;
    }

    if (a.availability === "busy" && b.availability === "busy") {
      if (a.activeAssignedJobs !== b.activeAssignedJobs) {
        return a.activeAssignedJobs - b.activeAssignedJobs;
      }
      const aRemaining = a.pickupRemaining + a.deliveryRemaining;
      const bRemaining = b.pickupRemaining + b.deliveryRemaining;
      if (aRemaining !== bRemaining) {
        return aRemaining - bRemaining;
      }
    }

    return a.name.localeCompare(b.name);
  });

  state.summaries = summaries;
}

function availabilityLabel(status) {
  if (status === "available") {
    return "Available";
  }
  if (status === "busy") {
    return "Busy";
  }
  return "Offline";
}

function filteredSummaries() {
  const query = clean(state.searchQuery);
  const filter = state.availabilityFilter;

  return state.summaries.filter(summary => {
    if (filter !== "all" && summary.availability !== filter) {
      return false;
    }

    if (!query) {
      return true;
    }

    const text = [
      summary.name,
      summary.areaWhenAvailable,
      summary.vehicleTypeWhenAvailable,
      availabilityLabel(summary.availability)
    ].join(" ").toLowerCase();

    return text.includes(query);
  });
}

function renderSummaryCounts() {
  elements.summaryTotal.textContent = String(state.summaries.length);
  elements.summaryAvailable.textContent = String(state.summaries.filter(item => item.availability === "available").length);
  elements.summaryBusy.textContent = String(state.summaries.filter(item => item.availability === "busy").length);
  elements.summaryOffline.textContent = String(state.summaries.filter(item => item.availability === "offline").length);
}

function renderDriversGrid() {
  const list = filteredSummaries();
  elements.visibleDriversMeta.textContent = list.length + (list.length === 1 ? " driver" : " drivers");

  if (!list.length) {
    elements.driversGrid.innerHTML = '<div class="empty">No drivers match the selected filters.</div>';
    return;
  }

  elements.driversGrid.innerHTML = list.map(summary => {
    const areaMetric = summary.availability === "available" && summary.areaWhenAvailable
      ? `<div class="metric"><div class="metric-label">Current Area</div><div class="metric-value">${escapeHtml(summary.areaWhenAvailable)}</div></div>`
      : "";

    const vehicleMetric = summary.availability === "available" && summary.vehicleTypeWhenAvailable
      ? `<div class="metric"><div class="metric-label">Vehicle</div><div class="metric-value">${escapeHtml(summary.vehicleTypeWhenAvailable)}</div></div>`
      : "";

    const rejectedWarning = summary.rejectedLastJob
      ? '<span class="warning-badge">Rejected last job</span>'
      : "";

    return `
      <button class="driver-card" type="button" data-driver-open="${escapeHtml(summary.id)}">
        <div class="card-top">
          <h3 class="driver-name">${escapeHtml(summary.name)}</h3>
          <span class="status-badge ${escapeHtml(summary.availability)}">${escapeHtml(availabilityLabel(summary.availability))}</span>
        </div>
        ${rejectedWarning}
        <div class="card-grid">
          ${areaMetric}
          <div class="metric"><div class="metric-label">Active Assigned</div><div class="metric-value">${escapeHtml(String(summary.activeAssignedJobs))}</div></div>
          <div class="metric"><div class="metric-label">Pickups Remaining</div><div class="metric-value">${escapeHtml(String(summary.pickupRemaining))}</div></div>
          <div class="metric"><div class="metric-label">Deliveries Remaining</div><div class="metric-value">${escapeHtml(String(summary.deliveryRemaining))}</div></div>
          <div class="metric"><div class="metric-label">Completed Today</div><div class="metric-value">${escapeHtml(String(summary.completedToday))}</div></div>
          <div class="metric"><div class="metric-label">Last Active</div><div class="metric-value">${escapeHtml(formatDateTime(summary.lastActiveAt))}</div></div>
          ${vehicleMetric}
        </div>
        <div class="card-foot">
          <span>View</span>
          <span class="chevron">></span>
        </div>
      </button>
    `;
  }).join("");
}

function nonEmptyRows(pairs) {
  return pairs
    .filter(pair => pair.value !== null && pair.value !== undefined && String(pair.value).trim() !== "")
    .map(pair => `
      <div class="kv-row">
        <span class="kv-key">${escapeHtml(pair.key)}</span>
        <span class="kv-value">${escapeHtml(String(pair.value))}</span>
      </div>
    `)
    .join("");
}

function jobStatusText(quote) {
  const workflow = clean(quote.driver_workflow_status);
  if (workflow) {
    return workflow.replaceAll("_", " ");
  }
  return clean(quote.status).replaceAll("_", " ") || "assigned";
}

function renderCurrentJobsSection(summary) {
  const activeJobs = summary.relatedQuotes.filter(quote => {
    if (isRejectedAssignment(quote)) {
      return false;
    }
    return !isQuoteClosed(quote);
  });

  if (!activeJobs.length) {
    return '<div class="empty">No active jobs.</div>';
  }

  return activeJobs.map(job => {
    const route = [toCity(job.pickup_address) || "Pickup", toCity(job.delivery_address) || "Delivery"].join(" to ");
    return `
      <div class="job-row">
        <div class="job-title">
          <span>${escapeHtml(job.job_number || "Job")}</span>
          <span>${escapeHtml(jobStatusText(job))}</span>
        </div>
        <div class="job-meta">${escapeHtml(route)}</div>
        <div class="job-meta">Customer: ${escapeHtml(job.customer_name || "-")}</div>
        <div class="job-meta">Driver Pay: ${escapeHtml(money(job.driver_pay || 0))}</div>
        <div class="job-actions">
          <a class="job-link" href="/assigned.html?job=${encodeURIComponent(String(job.id))}">View Delivery</a>
        </div>
      </div>
    `;
  }).join("");
}

function renderCompletedTodaySection(summary) {
  const completed = summary.relatedQuotes.filter(quote => {
    const status = clean(quote.status);
    const workflow = clean(quote.driver_workflow_status);
    const isComplete = status === "completed" || status === "delivered" || status === "closed" || workflow === "delivered";
    if (!isComplete) {
      return false;
    }

    const when = parseDate(quote.completed_at || quote.updated_at || quote.created_at);
    if (!when) {
      return false;
    }

    const start = startOfToday();
    const end = endOfToday();
    return when >= start && when < end;
  });

  if (!completed.length) {
    return '<div class="empty">No completed jobs today.</div>';
  }

  return completed.map(job => `
    <div class="job-row">
      <div class="job-title">
        <span>${escapeHtml(job.job_number || "Job")}</span>
        <span>${escapeHtml(formatDateTime(job.completed_at || job.updated_at || job.created_at))}</span>
      </div>
      <div class="job-meta">${escapeHtml((toCity(job.pickup_address) || "Pickup") + " to " + (toCity(job.delivery_address) || "Delivery"))}</div>
      <div class="job-meta">Driver Pay: ${escapeHtml(money(job.driver_pay || 0))}</div>
    </div>
  `).join("");
}

function renderDriverDetails(summary) {
  const driver = summary.driver;
  const notes = driver.notes || driver.internal_notes || driver.dispatch_notes || "";

  const summaryRows = nonEmptyRows([
    { key: "Name", value: summary.name },
    { key: "Availability", value: availabilityLabel(summary.availability) },
    { key: "Current Area", value: summary.areaWhenAvailable },
    { key: "Active Assigned Jobs", value: String(summary.activeAssignedJobs) },
    { key: "Pickups Remaining", value: String(summary.pickupRemaining) },
    { key: "Deliveries Remaining", value: String(summary.deliveryRemaining) },
    { key: "Completed Today", value: String(summary.completedToday) },
    { key: "Last Active", value: formatDateTime(summary.lastActiveAt) }
  ]);

  const vehicleRows = nonEmptyRows([
    { key: "Vehicle Type", value: deriveVehicleText(driver) },
    { key: "Plate", value: driver.plate || driver.license_plate || "" },
    { key: "Color", value: driver.vehicle_color || "" }
  ]);

  const contactRows = nonEmptyRows([
    { key: "Email", value: driver.email || "" },
    { key: "Phone", value: driver.phone || driver.mobile_phone || "" }
  ]);

  const earningsRows = nonEmptyRows([
    { key: "Today", value: money(summary.earningsToday) },
    { key: "Last 7 Days", value: money(summary.earningsWeek) }
  ]);

  const notesRows = nonEmptyRows([
    { key: "Driver Notes", value: notes }
  ]);

  elements.driverDetailsBody.innerHTML = `
    <details class="detail-section" open>
      <summary>1. Driver Summary</summary>
      <div class="detail-body">${summaryRows || '<div class="empty">No summary fields available.</div>'}</div>
    </details>

    <details class="detail-section">
      <summary>2. Current Jobs</summary>
      <div class="detail-body">${renderCurrentJobsSection(summary)}</div>
    </details>

    <details class="detail-section">
      <summary>3. Today's Completed Jobs</summary>
      <div class="detail-body">${renderCompletedTodaySection(summary)}</div>
    </details>

    <details class="detail-section">
      <summary>4. Vehicle</summary>
      <div class="detail-body">${vehicleRows || '<div class="empty">No vehicle fields available.</div>'}</div>
    </details>

    <details class="detail-section">
      <summary>5. Contact</summary>
      <div class="detail-body">${contactRows || '<div class="empty">No contact fields available.</div>'}</div>
    </details>

    <details class="detail-section">
      <summary>6. Earnings Summary</summary>
      <div class="detail-body">${earningsRows || '<div class="empty">No earnings fields available.</div>'}</div>
    </details>

    <details class="detail-section">
      <summary>7. Notes</summary>
      <div class="detail-body">${notesRows || '<div class="empty">No notes available.</div>'}</div>
    </details>
  `;
}

function openDriverDetails(driverId) {
  const summary = state.summaries.find(item => item.id === String(driverId));
  if (!summary) {
    showToast("Driver details were not found.", "error");
    return;
  }

  state.selectedDriverId = summary.id;
  renderDriverDetails(summary);
  elements.driverDetailsModal.classList.add("open");
  elements.driverDetailsModal.setAttribute("aria-hidden", "false");
}

function closeDriverDetails() {
  elements.driverDetailsModal.classList.remove("open");
  elements.driverDetailsModal.setAttribute("aria-hidden", "true");
}

function openAssignDeliveryForSelectedDriver() {
  if (!state.selectedDriverId) {
    showToast("Select a driver first.", "error");
    return;
  }

  const summary = state.summaries.find(item => item.id === state.selectedDriverId);
  const driverName = summary ? summary.name : "";
  const url =
    "/ready-to-dispatch.html?assignDriverId=" +
    encodeURIComponent(state.selectedDriverId) +
    "&assignDriverName=" +
    encodeURIComponent(driverName);

  window.location.href = url;
}

async function requireDispatchAccess() {
  const sessionResult = await client.auth.getSession();
  const session = sessionResult.data.session;

  if (!session) {
    window.location.replace("/index.html");
    return null;
  }

  elements.staffEmail.textContent = session.user.email || "";

  const profileResult = await client
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .maybeSingle();

  if (profileResult.error || !profileResult.data) {
    throw new Error(profileResult.error?.message || "No profile was found for this account.");
  }

  const role = clean(profileResult.data.role);
  if (!["admin", "staff", "dispatcher"].includes(role)) {
    if (role === "customer") {
      window.location.replace("/customer.html");
      return null;
    }

    throw new Error("This account does not have dispatch access.");
  }

  return session;
}

async function loadDrivers() {
  try {
    const result = await client
      .from("drivers")
      .select("*")
      .order("full_name", { ascending: true });

    if (result.error) {
      throw result.error;
    }

    return result.data || [];
  } catch (error) {
    throw new Error(error.message || "Unable to load drivers.");
  }
}

async function loadQuotes() {
  try {
    const result = await client
      .from("quotes")
      .select("id,job_number,assigned_driver_id,status,customer_name,pickup_address,delivery_address,driver_pay,driver_acceptance_status,driver_workflow_status,driver_accepted_at,driver_rejected_at,completed_at,updated_at,created_at")
      .not("assigned_driver_id", "is", null)
      .order("updated_at", { ascending: false });

    if (result.error) {
      throw result.error;
    }

    return result.data || [];
  } catch (error) {
    throw new Error(error.message || "Unable to load quotes.");
  }
}

function setRefreshLoading(loading) {
  state.isLoading = loading;
  elements.refreshDriversBtn.disabled = loading;
  elements.refreshDriversBtn.textContent = loading ? "Refreshing..." : "Refresh";
}

function renderWorkspace() {
  renderSummaryCounts();
  renderDriversGrid();
}

function setLoadError(message) {
  if (!message) {
    elements.loadErrorBanner.classList.add("hidden");
    elements.loadErrorBanner.textContent = "";
    return;
  }

  elements.loadErrorBanner.classList.remove("hidden");
  elements.loadErrorBanner.textContent = message;
}

async function loadAvailabilityWorkspace() {
  setRefreshLoading(true);
  setLoadError("");
  elements.driversGrid.innerHTML = '<div class="empty">Loading drivers...</div>';

  try {
    const [drivers, quotes] = await Promise.all([
      loadDrivers(),
      loadQuotes()
    ]);

    state.drivers = drivers;
    state.quotes = quotes;
    buildDriverSummaries();
    renderWorkspace();
  } catch (error) {
    const message = error.message || "Unable to load driver availability.";
    state.drivers = [];
    state.quotes = [];
    state.summaries = [];
    renderWorkspace();
    setLoadError(message);
    showToast(message, "error");
  } finally {
    setRefreshLoading(false);
  }
}

function updateActiveChip() {
  document.querySelectorAll("[data-filter]").forEach(chip => {
    chip.classList.toggle("active", chip.getAttribute("data-filter") === state.availabilityFilter);
  });
}

function bindEvents() {
  elements.driverSearchInput.addEventListener("input", () => {
    state.searchQuery = elements.driverSearchInput.value || "";
    renderDriversGrid();
  });

  document.querySelectorAll("[data-filter]").forEach(chip => {
    chip.addEventListener("click", () => {
      state.availabilityFilter = chip.getAttribute("data-filter") || "all";
      updateActiveChip();
      renderDriversGrid();
    });
  });

  elements.refreshDriversBtn.addEventListener("click", loadAvailabilityWorkspace);

  document.addEventListener("click", event => {
    const openDriver = event.target.closest("[data-driver-open]");
    if (openDriver) {
      openDriverDetails(openDriver.getAttribute("data-driver-open"));
      return;
    }

    if (event.target.matches("[data-close-driver-modal]")) {
      closeDriverDetails();
      return;
    }

    if (event.target === elements.driverDetailsModal) {
      closeDriverDetails();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && elements.driverDetailsModal.classList.contains("open")) {
      closeDriverDetails();
    }
  });

  elements.assignDeliveryBtn.addEventListener("click", openAssignDeliveryForSelectedDriver);
}

(async function startPage() {
  try {
    const session = await requireDispatchAccess();
    if (!session) {
      return;
    }

    bindEvents();
    updateActiveChip();
    await loadAvailabilityWorkspace();
  } catch (error) {
    const message = error.message || "Unable to open Driver Availability workspace.";
    setLoadError(message);
    elements.driversGrid.innerHTML = '<div class="empty">' + escapeHtml(message) + "</div>";
    showToast(message, "error");
  }
})();
