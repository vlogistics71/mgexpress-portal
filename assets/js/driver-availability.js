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
  profiles: [],
  profilesById: new Map(),
  summaries: [],
  searchQuery: "",
  availabilityFilter: "all",
  selectedDriverId: "",
  isEditMode: false,
  savingDriver: false,
  isLoading: false,
  schema: {
    drivers: new Set(),
    quotes: new Set(),
    profiles: new Set(),
    quoteOrderColumn: "",
    driverOrderColumn: "",
    profileOrderColumn: ""
  }
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
  editDriverBtn: document.getElementById("editDriverBtn"),
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

function missingColumnError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("column") && (message.includes("does not exist") || message.includes("not found"));
}

async function detectExistingColumns(tableName, candidateColumns) {
  const existing = [];

  for (const column of candidateColumns) {
    const probe = await client
      .from(tableName)
      .select(column)
      .limit(1);

    if (!probe.error) {
      existing.push(column);
      continue;
    }

    if (missingColumnError(probe.error)) {
      continue;
    }

    throw probe.error;
  }

  return existing;
}

function hasDriverColumn(columnName) {
  return state.schema.drivers.has(columnName);
}

function hasQuoteColumn(columnName) {
  return state.schema.quotes.has(columnName);
}

function hasProfileColumn(columnName) {
  return state.schema.profiles.has(columnName);
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

function firstExistingQuoteValue(quote, keys) {
  for (const key of keys) {
    if (!hasQuoteColumn(key)) {
      continue;
    }

    const value = quote?.[key];
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
  }

  return "";
}

async function inspectWorkspaceSchema() {
  const driverColumns = await detectExistingColumns("drivers", [
    "id",
    "full_name",
    "display_name",
    "name",
    "email",
    "active",
    "is_active",
    "enabled",
    "status",
    "availability_status",
    "current_area",
    "area",
    "city",
    "vehicle_type",
    "vehicle",
    "vehicle_year",
    "vehicle_make",
    "vehicle_model",
    "plate",
    "license_plate",
    "vehicle_color",
    "phone",
    "mobile_phone",
    "notes",
    "internal_notes",
    "dispatch_notes",
    "last_active_at",
    "last_seen_at",
    "created_at"
  ]);

  const quoteColumns = await detectExistingColumns("quotes", [
    "id",
    "job_number",
    "assigned_driver_id",
    "status",
    "customer_name",
    "pickup_address",
    "delivery_address",
    "driver_pay",
    "driver_acceptance_status",
    "driver_workflow_status",
    "driver_accepted_at",
    "driver_rejected_at",
    "completed_at",
    "created_at",
    "scheduled_at",
    "pickup_time",
    "delivery_time"
  ]);

  const profileColumns = await detectExistingColumns("profiles", [
    "id",
    "full_name",
    "display_name",
    "name",
    "user_metadata",
    "raw_user_meta_data",
    "created_at"
  ]);

  state.schema.drivers = new Set(driverColumns);
  state.schema.quotes = new Set(quoteColumns);
  state.schema.profiles = new Set(profileColumns);

  state.schema.driverOrderColumn = ["full_name", "email", "created_at"].find(hasDriverColumn) || "";
  state.schema.profileOrderColumn = ["full_name", "display_name", "created_at"].find(hasProfileColumn) || "";
  state.schema.quoteOrderColumn = [
    "created_at",
    "scheduled_at",
    "pickup_time",
    "delivery_time",
    "completed_at",
    "driver_rejected_at",
    "driver_accepted_at"
  ].find(hasQuoteColumn) || "";
}

function driverAuthId(driver) {
  if (hasDriverColumn("auth_user_id") && driver.auth_user_id) {
    return String(driver.auth_user_id);
  }

  if (hasDriverColumn("user_id") && driver.user_id) {
    return String(driver.user_id);
  }

  return "";
}

function linkedProfileForDriver(driver) {
  const authId = driverAuthId(driver);
  if (!authId) {
    return null;
  }

  return state.profilesById.get(authId) || null;
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
    (hasDriverColumn("full_name") ? driver.full_name : "") ||
    (hasDriverColumn("display_name") ? driver.display_name : "") ||
    (hasDriverColumn("name") ? driver.name : "");

  if (preferred) {
    return String(preferred);
  }

  const profile = linkedProfileForDriver(driver);
  if (profile) {
    const profileName =
      (hasProfileColumn("full_name") ? profile.full_name : "") ||
      (hasProfileColumn("display_name") ? profile.display_name : "") ||
      "";
    if (profileName) {
      return String(profileName);
    }

    const metadata =
      parseMetadataObject(hasProfileColumn("raw_user_meta_data") ? profile.raw_user_meta_data : null) ||
      parseMetadataObject(hasProfileColumn("user_metadata") ? profile.user_metadata : null);

    const metaName =
      String(metadata?.full_name || "").trim() ||
      String(metadata?.name || "").trim() ||
      String(metadata?.display_name || "").trim();

    if (metaName) {
      return metaName;
    }
  }

  const email = hasDriverColumn("email") ? String(driver.email || "") : "";
  return emailUsernameFallback(email);
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
  return firstExistingQuoteValue(quote, [
    "driver_rejected_at",
    "driver_accepted_at",
    "created_at",
    "scheduled_at",
    "pickup_time",
    "delivery_time",
    "completed_at"
  ]);
}

function getDriverLastActiveValue(driver, relatedQuotes) {
  const candidateFields = [
    "last_active_at",
    "last_seen_at",
    "created_at"
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
  const directType =
    (hasDriverColumn("vehicle_type") ? driver.vehicle_type : "") ||
    (hasDriverColumn("vehicle") ? driver.vehicle : "");

  const parts = [
    hasDriverColumn("vehicle_year") ? driver.vehicle_year : "",
    hasDriverColumn("vehicle_make") ? driver.vehicle_make : "",
    hasDriverColumn("vehicle_model") ? driver.vehicle_model : ""
  ].filter(Boolean);

  return directType || parts.join(" ") || "";
}

function deriveAreaWhenAvailable(driver, relatedQuotes) {
  const fromDriver =
    (hasDriverColumn("current_area") ? driver.current_area : "") ||
    (hasDriverColumn("area") ? driver.area : "") ||
    (hasDriverColumn("city") ? driver.city : "") ||
    "";
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
    (hasDriverColumn("active") ? driver.active : undefined) ??
    (hasDriverColumn("is_active") ? driver.is_active : undefined) ??
    (hasDriverColumn("enabled") ? driver.enabled : undefined);

  if (activeFlag === false) {
    return true;
  }

  const statusText = clean(
    (hasDriverColumn("status") ? driver.status : "") ||
    (hasDriverColumn("availability_status") ? driver.availability_status : "")
  );
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

    const completedAt = parseDate(firstExistingQuoteValue(quote, [
      "completed_at",
      "delivery_time",
      "pickup_time",
      "scheduled_at",
      "created_at"
    ]));
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

    const when = parseDate(firstExistingQuoteValue(quote, [
      "completed_at",
      "delivery_time",
      "pickup_time",
      "scheduled_at",
      "created_at"
    ]));
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

    const when = parseDate(firstExistingQuoteValue(quote, [
      "completed_at",
      "delivery_time",
      "pickup_time",
      "scheduled_at",
      "created_at"
    ]));
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

    const when = parseDate(firstExistingQuoteValue(quote, [
      "completed_at",
      "delivery_time",
      "pickup_time",
      "scheduled_at",
      "created_at"
    ]));
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
        <span>${escapeHtml(formatDateTime(firstExistingQuoteValue(job, [
          "completed_at",
          "delivery_time",
          "pickup_time",
          "scheduled_at",
          "created_at"
        ])))}</span>
      </div>
      <div class="job-meta">${escapeHtml((toCity(job.pickup_address) || "Pickup") + " to " + (toCity(job.delivery_address) || "Delivery"))}</div>
      <div class="job-meta">Driver Pay: ${escapeHtml(money(job.driver_pay || 0))}</div>
    </div>
  `).join("");
}

function renderDriverDetails(summary) {
  state.isEditMode = false;
  updateDriverModalActions();

  const driver = summary.driver;
  const notes =
    (hasDriverColumn("notes") ? driver.notes : "") ||
    (hasDriverColumn("internal_notes") ? driver.internal_notes : "") ||
    (hasDriverColumn("dispatch_notes") ? driver.dispatch_notes : "") ||
    "";

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
    {
      key: "Plate",
      value:
        (hasDriverColumn("plate") ? driver.plate : "") ||
        (hasDriverColumn("license_plate") ? driver.license_plate : "") ||
        ""
    },
    { key: "Color", value: hasDriverColumn("vehicle_color") ? driver.vehicle_color : "" }
  ]);

  const contactRows = nonEmptyRows([
    { key: "Email", value: hasDriverColumn("email") ? driver.email : "" },
    {
      key: "Phone",
      value:
        (hasDriverColumn("phone") ? driver.phone : "") ||
        (hasDriverColumn("mobile_phone") ? driver.mobile_phone : "") ||
        ""
    }
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

function availabilityEditorFieldDescriptor(driver) {
  if (hasDriverColumn("active") || hasDriverColumn("is_active") || hasDriverColumn("enabled")) {
    const value =
      (hasDriverColumn("active") ? driver.active : undefined) ??
      (hasDriverColumn("is_active") ? driver.is_active : undefined) ??
      (hasDriverColumn("enabled") ? driver.enabled : undefined);

    return {
      editable: true,
      value: value === false ? "inactive" : "active"
    };
  }

  if (hasDriverColumn("status") || hasDriverColumn("availability_status")) {
    const text = clean(
      (hasDriverColumn("status") ? driver.status : "") ||
      (hasDriverColumn("availability_status") ? driver.availability_status : "")
    );

    return {
      editable: true,
      value: ["inactive", "offline", "off_duty", "disabled"].includes(text) ? "inactive" : "active"
    };
  }

  return {
    editable: false,
    value: ""
  };
}

function driverAreaValue(driver) {
  return (
    (hasDriverColumn("current_area") ? driver.current_area : "") ||
    (hasDriverColumn("area") ? driver.area : "") ||
    (hasDriverColumn("city") ? driver.city : "") ||
    ""
  );
}

function driverNotesValue(driver) {
  return (
    (hasDriverColumn("notes") ? driver.notes : "") ||
    (hasDriverColumn("internal_notes") ? driver.internal_notes : "") ||
    (hasDriverColumn("dispatch_notes") ? driver.dispatch_notes : "") ||
    ""
  );
}

function renderDriverEditMode(summary) {
  const driver = summary.driver;
  state.isEditMode = true;
  updateDriverModalActions();

  const statusEditor = availabilityEditorFieldDescriptor(driver);

  const fullNameField = hasDriverColumn("full_name") ? `
    <div class="kv-row">
      <span class="kv-key">Full Name</span>
      <span class="kv-value"><input name="full_name" value="${escapeHtml(String(driver.full_name || ""))}" /></span>
    </div>
  ` : "";

  const displayNameField = hasDriverColumn("display_name") ? `
    <div class="kv-row">
      <span class="kv-key">Display Name</span>
      <span class="kv-value"><input name="display_name" value="${escapeHtml(String(driver.display_name || ""))}" /></span>
    </div>
  ` : "";

  const phoneFieldName = hasDriverColumn("phone") ? "phone" : hasDriverColumn("mobile_phone") ? "mobile_phone" : "";
  const phoneField = phoneFieldName ? `
    <div class="kv-row">
      <span class="kv-key">Phone</span>
      <span class="kv-value"><input name="${phoneFieldName}" value="${escapeHtml(String(driver[phoneFieldName] || ""))}" /></span>
    </div>
  ` : "";

  const emailDisplay = hasDriverColumn("email") ? `
    <div class="kv-row">
      <span class="kv-key">Email (Display)</span>
      <span class="kv-value"><input value="${escapeHtml(String(driver.email || ""))}" disabled /></span>
    </div>
    <div style="font-size:12px;color:#6b7872;margin-top:6px;">Login email changes require a separate account update.</div>
  ` : "";

  const vehicleTypeField = hasDriverColumn("vehicle_type") ? `
    <div class="kv-row">
      <span class="kv-key">Vehicle Type</span>
      <span class="kv-value"><input name="vehicle_type" value="${escapeHtml(String(driver.vehicle_type || ""))}" /></span>
    </div>
  ` : "";

  const vehicleMakeField = hasDriverColumn("vehicle_make") ? `
    <div class="kv-row">
      <span class="kv-key">Vehicle Make</span>
      <span class="kv-value"><input name="vehicle_make" value="${escapeHtml(String(driver.vehicle_make || ""))}" /></span>
    </div>
  ` : "";

  const vehicleModelField = hasDriverColumn("vehicle_model") ? `
    <div class="kv-row">
      <span class="kv-key">Vehicle Model</span>
      <span class="kv-value"><input name="vehicle_model" value="${escapeHtml(String(driver.vehicle_model || ""))}" /></span>
    </div>
  ` : "";

  const plateFieldName = hasDriverColumn("license_plate") ? "license_plate" : hasDriverColumn("plate") ? "plate" : "";
  const plateField = plateFieldName ? `
    <div class="kv-row">
      <span class="kv-key">License Plate</span>
      <span class="kv-value"><input name="${plateFieldName}" value="${escapeHtml(String(driver[plateFieldName] || ""))}" /></span>
    </div>
  ` : "";

  const areaFieldName = hasDriverColumn("current_area") ? "current_area" : hasDriverColumn("area") ? "area" : hasDriverColumn("city") ? "city" : "";
  const areaField = areaFieldName ? `
    <div class="kv-row">
      <span class="kv-key">Home / Service Area</span>
      <span class="kv-value"><input name="${areaFieldName}" value="${escapeHtml(String(driverAreaValue(driver) || ""))}" /></span>
    </div>
  ` : "";

  const notesFieldName = hasDriverColumn("notes") ? "notes" : hasDriverColumn("internal_notes") ? "internal_notes" : hasDriverColumn("dispatch_notes") ? "dispatch_notes" : "";
  const notesField = notesFieldName ? `
    <div class="kv-row" style="display:block;">
      <div class="kv-key" style="margin-bottom:6px;">Notes</div>
      <textarea name="${notesFieldName}" style="width:100%;min-height:84px;border:1px solid #dbe5e0;border-radius:10px;padding:8px;">${escapeHtml(String(driverNotesValue(driver) || ""))}</textarea>
    </div>
  ` : "";

  const statusField = statusEditor.editable ? `
    <div class="kv-row">
      <span class="kv-key">Status</span>
      <span class="kv-value">
        <select name="active_state" style="min-height:36px;border:1px solid #dbe5e0;border-radius:10px;padding:6px 8px;">
          <option value="active" ${statusEditor.value === "active" ? "selected" : ""}>Active</option>
          <option value="inactive" ${statusEditor.value === "inactive" ? "selected" : ""}>Inactive</option>
        </select>
      </span>
    </div>
  ` : "";

  const fieldsMarkup = [
    fullNameField,
    displayNameField,
    phoneField,
    emailDisplay,
    vehicleTypeField,
    vehicleMakeField,
    vehicleModelField,
    plateField,
    statusField,
    areaField,
    notesField
  ].filter(Boolean).join("");

  elements.driverDetailsBody.innerHTML = `
    <details class="detail-section" open>
      <summary>Edit Driver</summary>
      <div class="detail-body">
        <form id="driverEditForm">
          ${fieldsMarkup || '<div class="empty">No editable driver columns exist in the current drivers table.</div>'}
        </form>
      </div>
    </details>
  `;
}

function updateDriverModalActions() {
  if (!elements.editDriverBtn || !elements.assignDeliveryBtn) {
    return;
  }

  if (state.isEditMode) {
    elements.editDriverBtn.textContent = state.savingDriver ? "Saving..." : "Save Driver";
    elements.assignDeliveryBtn.classList.add("hidden");
    elements.editDriverBtn.disabled = state.savingDriver;
  } else {
    elements.editDriverBtn.textContent = "Edit Driver";
    elements.assignDeliveryBtn.classList.remove("hidden");
    elements.editDriverBtn.disabled = false;
  }
}

async function saveDriverEdits() {
  const summary = state.summaries.find(item => item.id === String(state.selectedDriverId));
  if (!summary) {
    showToast("Driver details were not found.", "error");
    return;
  }

  const form = document.getElementById("driverEditForm");
  if (!form) {
    showToast("No editable driver fields are available.", "info");
    return;
  }

  const data = new FormData(form);
  const payload = {};

  const editableTextColumns = [
    "full_name",
    "display_name",
    "phone",
    "mobile_phone",
    "vehicle_type",
    "vehicle_make",
    "vehicle_model",
    "license_plate",
    "plate",
    "current_area",
    "area",
    "city",
    "notes",
    "internal_notes",
    "dispatch_notes"
  ];

  editableTextColumns.forEach(column => {
    if (!hasDriverColumn(column) || !data.has(column)) {
      return;
    }

    payload[column] = String(data.get(column) || "").trim() || null;
  });

  if (data.has("active_state")) {
    const active = String(data.get("active_state") || "active") !== "inactive";
    if (hasDriverColumn("active")) {
      payload.active = active;
    }
    if (hasDriverColumn("is_active")) {
      payload.is_active = active;
    }
    if (hasDriverColumn("enabled")) {
      payload.enabled = active;
    }
    if (hasDriverColumn("status")) {
      payload.status = active ? "active" : "inactive";
    }
    if (hasDriverColumn("availability_status")) {
      payload.availability_status = active ? "active" : "inactive";
    }
  }

  if (!Object.keys(payload).length) {
    showToast("No changes to save.", "info");
    return;
  }

  state.savingDriver = true;
  updateDriverModalActions();

  try {
    const result = await client
      .from("drivers")
      .update(payload)
      .eq("id", summary.id)
      .select("id")
      .maybeSingle();

    if (result.error) {
      throw result.error;
    }

    await loadAvailabilityWorkspace();
    const refreshed = state.summaries.find(item => item.id === String(summary.id));
    if (refreshed) {
      renderDriverDetails(refreshed);
    }

    try {
      localStorage.setItem("mg_driver_profile_refresh", new Date().toISOString());
    } catch (_error) {
      // Ignore storage write issues.
    }

    showToast("Driver information updated", "success");
  } catch (error) {
    showToast(error.message || "Unable to update driver information", "error");
  } finally {
    state.savingDriver = false;
    updateDriverModalActions();
  }
}

function openDriverDetails(driverId) {
  const summary = state.summaries.find(item => item.id === String(driverId));
  if (!summary) {
    showToast("Driver details were not found.", "error");
    return;
  }

  state.selectedDriverId = summary.id;
  renderDriverDetails(summary);
  updateDriverModalActions();
  elements.driverDetailsModal.classList.add("open");
  elements.driverDetailsModal.setAttribute("aria-hidden", "false");
}

function closeDriverDetails() {
  state.isEditMode = false;
  state.savingDriver = false;
  updateDriverModalActions();
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
    const selectColumns = Array.from(state.schema.drivers);
    if (!selectColumns.includes("id")) {
      selectColumns.unshift("id");
    }

    let query = client
      .from("drivers")
      .select(selectColumns.join(","));

    if (state.schema.driverOrderColumn) {
      query = query.order(state.schema.driverOrderColumn, { ascending: true });
    }

    const result = await query;

    if (result.error) {
      throw result.error;
    }

    return result.data || [];
  } catch (error) {
    throw new Error(error.message || "Unable to load drivers.");
  }
}

async function loadProfiles() {
  if (!state.schema.profiles.has("id")) {
    state.profiles = [];
    state.profilesById = new Map();
    return [];
  }

  const selectColumns = Array.from(state.schema.profiles);
  if (!selectColumns.includes("id")) {
    selectColumns.unshift("id");
  }

  let query = client
    .from("profiles")
    .select(selectColumns.join(","));

  if (state.schema.profileOrderColumn) {
    query = query.order(state.schema.profileOrderColumn, { ascending: true });
  }

  const result = await query;
  if (result.error) {
    throw result.error;
  }

  const rows = result.data || [];
  state.profiles = rows;
  state.profilesById = new Map(rows.map(row => [String(row.id), row]));
  return rows;
}

async function loadQuotes() {
  try {
    const requiredColumns = [
      "id",
      "assigned_driver_id",
      "job_number",
      "status",
      "customer_name",
      "pickup_address",
      "delivery_address",
      "driver_pay",
      "driver_acceptance_status",
      "driver_workflow_status",
      "driver_accepted_at",
      "driver_rejected_at",
      "completed_at",
      "created_at",
      "scheduled_at",
      "pickup_time",
      "delivery_time"
    ];

    const selectColumns = requiredColumns.filter(hasQuoteColumn);
    if (!selectColumns.includes("id")) {
      throw new Error("quotes.id is required for Driver Availability.");
    }

    let query = client
      .from("quotes")
      .select(selectColumns.join(","));

    if (hasQuoteColumn("assigned_driver_id")) {
      query = query.not("assigned_driver_id", "is", null);
    }

    if (state.schema.quoteOrderColumn) {
      query = query.order(state.schema.quoteOrderColumn, { ascending: false });
    }

    const result = await query;

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

    await loadProfiles();

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

  window.addEventListener("storage", event => {
    if (event.key === "mg_driver_profile_refresh" && event.newValue) {
      loadAvailabilityWorkspace().catch(error => {
        showToast(error.message || "Unable to refresh driver availability", "error");
      });
    }
  });

  elements.editDriverBtn.addEventListener("click", () => {
    if (!state.selectedDriverId) {
      showToast("Select a driver first.", "error");
      return;
    }

    if (state.isEditMode) {
      saveDriverEdits();
      return;
    }

    const summary = state.summaries.find(item => item.id === String(state.selectedDriverId));
    if (!summary) {
      showToast("Driver details were not found.", "error");
      return;
    }

    renderDriverEditMode(summary);
  });

  elements.assignDeliveryBtn.addEventListener("click", openAssignDeliveryForSelectedDriver);
}

(async function startPage() {
  try {
    const session = await requireDispatchAccess();
    if (!session) {
      return;
    }

    await inspectWorkspaceSchema();
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
