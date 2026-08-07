(function () {
  "use strict";

  let dispatch = null;
  let client = null;
  const debugMode = new URLSearchParams(window.location.search || "").get("debug") === "1";
  const SUPABASE_URL = "https://dczlucwfjayymlwbzzdi.supabase.co";
  const SUPABASE_KEY = "sb_publishable_kcv_a78ZyUxMo2neKUANdw_XN7eAMpI";

  let commandCenterInitialized = false;
  let commandCenterEventsBound = false;

  const helpers = {
    escapeHtml(value) {
      const div = document.createElement("div");
      div.textContent = value ?? "";
      return div.innerHTML;
    },

    clean(value) {
      return String(value || "")
        .trim()
        .toLowerCase();
    },

    localDateString(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    },

    startOfToday() {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      return date;
    },

    tomorrowStart() {
      const date = helpers.startOfToday();
      date.setDate(date.getDate() + 1);
      return date;
    },

    formatTime(value) {
      if (!value) {
        return "Time pending";
      }

      const text = String(value).slice(0, 5);
      const parts = text.split(":");

      if (parts.length !== 2) {
        return value;
      }

      const date = new Date();
      date.setHours(Number(parts[0]), Number(parts[1]), 0, 0);
      return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    },

    sortLabel(value) {
      const map = {
        newest: "Newest",
        oldest: "Oldest",
        pickup_time: "Pickup Time",
        delivery_time: "Delivery Time",
        customer: "Customer",
        company: "Company"
      };

      return map[value] || "Newest";
    },

    normalizeCategory(value) {
      const cleanValue = helpers.clean(value);
      return ["medical", "legal", "general", "pallet", "special"].includes(cleanValue)
        ? cleanValue
        : "general";
    },

    deliveryLabel(row) {
      return dispatch.jobCategoryLabel(row.job_category);
    },

    stage(row) {
      return dispatch.getWorkflowStage(row);
    },

    rowTitle(row) {
      return row.job_number || "Delivery";
    },

    rowCompany(row) {
      return String(row.company_name || row.customer_company || row.customer_business || "").trim();
    },

    rowCustomer(row) {
      return String(row.customer_name || "Customer").trim();
    }
  };

  const TAB_META = {
    pending: {
      label: "Pending",
      empty: "No Pending Deliveries",
      subcopy: "You're all caught up.",
      query: ["new", "pending", "pending_approval", "waiting_payment", "quote", "quoted", "quote_pending"]
    },
    ready: {
      label: "Ready",
      empty: "No Ready Deliveries",
      subcopy: "You're all caught up.",
      query: ["ready", "ready_to_dispatch", "paid"]
    },
    assigned: {
      label: "Assigned",
      empty: "No Assigned Deliveries",
      subcopy: "You're all caught up.",
      query: ["assigned", "in_progress"]
    },
    rejected: {
      label: "Rejected",
      empty: "No Rejected Deliveries",
      subcopy: "No driver rejections right now.",
      query: ["rejected"]
    },
    completed: {
      label: "Completed",
      empty: "No Completed Deliveries",
      subcopy: "You're all caught up.",
      query: ["completed", "delivered", "closed", "cancelled", "canceled"]
    },
    search: {
      label: "Search",
      empty: "No matching deliveries",
      subcopy: "Try a broader search.",
      query: []
    }
  };

  const state = {
    activeTab: "pending",
    category: "all",
    sortBy: "newest",
    searchTerm: "",
    selectedDelivery: null,
    visibleRows: [],
    renderedRows: [],
    counts: {},
    recurringCustomers: [],
    assignedSnapshot: [],
    metricsSnapshot: [],
    supportEstimatedMiles: null,
    loading: false,
    searchTimer: null,
    rowsVersion: 0,
    diagnosticsMissing: [],
    lastError: "",
    lastErrorStack: "",
    lastSupabaseError: "",
    startupStarted: false,
    queryStarted: false,
    queryCompleted: false,
    returnedRows: 0,
    activeUserId: "none"
  };

  const elements = {
    title: document.getElementById("pageTitle"),
    subtitle: document.getElementById("pageSubtitle"),
    visibleCount: document.getElementById("visibleCount"),
    sectionLabel: document.getElementById("workspaceSectionLabel"),
    rowsHost: document.getElementById("deliveryList"),
    diagnosticsBox: document.getElementById("commandCenterDiagnostics"),
    tabs: Array.from(document.querySelectorAll("[data-delivery-tab]")),
    categoryChips: Array.from(document.querySelectorAll("[data-delivery-category]")),
    sortSelect: document.getElementById("sortSelect"),
    searchPanel: document.getElementById("searchPanel"),
    searchInput: document.getElementById("searchInput"),
    refreshButton: document.getElementById("refreshBtn"),
    newDeliveryButton: document.getElementById("newDeliveryButton"),
    toastWrap: document.getElementById("toastWrap"),
    jobModalTitle: document.getElementById("jobModalTitle"),
    jobRecordId: document.getElementById("jobRecordId"),
    jobCustomerAccountId: document.getElementById("jobCustomerAccountId"),
    jobForm: document.getElementById("jobForm"),
    saveJobBtn: document.getElementById("saveJobBtn"),
    customerLookupInput: document.getElementById("customerLookupInput"),
    customerLookupResults: document.getElementById("customerLookupResults"),
    newDeliveryReviewList: document.getElementById("newDeliveryReviewList"),
    returnRequired: document.getElementById("returnRequiredSelect"),
    returnLocationType: document.getElementById("returnLocationTypeSelect"),
    returnDetailsSection: document.getElementById("returnDetailsSection"),
    returnPickupReadback: document.getElementById("returnPickupReadback"),
    assignDriverSearch: document.getElementById("assignDriverSearch"),
    assignDriverFilter: document.getElementById("assignDriverFilter"),
    assignConfirmBtn: document.getElementById("assignConfirmBtn"),
    rejectedReturnConfirmBtn: document.getElementById("rejectedReturnConfirmBtn"),
    assignSubmitBtn: document.getElementById("assignSubmitBtn")
  };

  function diagnosticsLine(label, value) {
    return `${label}: ${value}`;
  }

  function renderDiagnostics() {
    if (!elements.diagnosticsBox) {
      return;
    }

    const stackLocation = state.lastError && state.lastErrorStack
      ? String(state.lastErrorStack).split("\n").slice(0, 2).join(" | ")
      : "none";

    const lines = [
      diagnosticsLine("page initialization started", state.startupStarted ? "yes" : "no"),
      diagnosticsLine("Supabase client available", client ? "yes" : "no"),
      diagnosticsLine("authenticated user id", state.activeUserId || "none"),
      diagnosticsLine("active tab", state.activeTab),
      diagnosticsLine("delivery query started", state.queryStarted ? "yes" : "no"),
      diagnosticsLine("delivery query completed", state.queryCompleted ? "yes" : "no"),
      diagnosticsLine("number of rows returned", String(state.returnedRows || 0)),
      diagnosticsLine("exact JavaScript error message", state.lastError || "none"),
      diagnosticsLine("exact Supabase error message", state.lastSupabaseError || "none"),
      diagnosticsLine("stack location", stackLocation)
    ];

    if (state.diagnosticsMissing.length) {
      lines.push(diagnosticsLine("missing optional elements", state.diagnosticsMissing.join(", ")));
    }

    const shouldShow = debugMode;
    elements.diagnosticsBox.style.display = shouldShow ? "block" : "none";
    if (shouldShow) {
      elements.diagnosticsBox.textContent = lines.join("\n");
    }
  }

  function setDiagnosticsError(error, supabaseError = "") {
    state.lastError = String(error?.message || error || "").trim() || "unknown error";
    state.lastErrorStack = String(error?.stack || "").trim();
    const supabaseParts = [
      String(error?.message || "").trim(),
      String(supabaseError || "").trim()
    ].filter(Boolean);
    state.lastSupabaseError = supabaseParts.join(" | ");
    renderDiagnostics();
  }

  function recordMissingElement(name) {
    if (!state.diagnosticsMissing.includes(name)) {
      state.diagnosticsMissing.push(name);
    }
  }

  function setDeliveryLoading(isLoading) {
    state.loading = Boolean(isLoading);
    if (!elements.rowsHost) {
      return;
    }

    if (isLoading) {
      elements.rowsHost.innerHTML = '<div class="delivery-empty"><div class="delivery-empty-title">Loading deliveries...</div></div>';
    }
  }

  function renderDeliveryError(message) {
    if (!elements.rowsHost) {
      return;
    }

    const text = helpers.escapeHtml(message || "Unable to load deliveries");
    elements.rowsHost.innerHTML = `
      <div class="delivery-empty">
        <div class="delivery-empty-title">${text}</div>
        <button class="delivery-empty-cta" type="button" id="retryLoadDeliveriesButton">Retry</button>
      </div>
    `;
  }

  function ensureClient() {
    if (client) {
      return client;
    }

    client = window.mgDispatchClient || null;
    if (!client && typeof window.supabase?.createClient === "function") {
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      window.mgDispatchClient = client;
    }

    if (!client) {
      throw new Error("Supabase client is unavailable for Delivery Command Center.");
    }

    return client;
  }

  function localReturnRequiredFlag(value) {
    const token = String(value ?? "").trim().toLowerCase();
    return value === true || token === "true" || token === "1" || token === "yes";
  }

  function localHasReturnRequired(job) {
    return localReturnRequiredFlag(job?.return_required);
  }

  function localGetWorkflowStage(job) {
    const status = helpers.clean(job?.status);
    const flow = helpers.clean(job?.driver_workflow_status);
    const payment = helpers.clean(job?.payment_status);

    if (["cancelled", "canceled", "closed", "completed", "delivered"].includes(status) || ["complete_delivery", "delivered"].includes(flow)) {
      return "closed";
    }

    if (["assigned", "in_progress"].includes(status) || Boolean(flow)) {
      return "assigned";
    }

    if (["ready", "ready_to_dispatch", "paid"].includes(status) || ["paid", "received", "completed"].includes(payment)) {
      return "ready_to_dispatch";
    }

    return "pending_approval";
  }

  function localStatusLabel(rowOrStatus) {
    if (rowOrStatus && typeof rowOrStatus === "object") {
      const stage = localGetWorkflowStage(rowOrStatus);
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

    return String(rowOrStatus || "UNKNOWN").replaceAll("_", " ").toUpperCase();
  }

  function localJobCategoryLabel(value) {
    const normalized = helpers.normalizeCategory(value);
    const map = {
      medical: "Medical",
      legal: "Legal",
      general: "General",
      pallet: "Pallet",
      special: "Special"
    };
    return map[normalized] || "General";
  }

  function localJobCategoryClass(value) {
    return "category-" + helpers.normalizeCategory(value);
  }

  function localDeliveryTypeLabel(value) {
    const map = {
      business_to_business: "Business to Business",
      business_to_residential: "Business to Residential",
      residential_to_business: "Residential to Business",
      residential_to_residential: "Residential to Residential"
    };
    return map[helpers.clean(value)] || "-";
  }

  function localServiceLevelLabel(value) {
    const map = {
      standard: "Standard",
      priority: "Priority",
      stat: "STAT",
      scheduled: "Scheduled",
      on_demand: "On Demand"
    };
    return map[helpers.clean(value)] || "-";
  }

  function localDeliverySpeedLabel(value) {
    const map = {
      "2_hr": "2 Hour",
      "3_hr": "3 Hour",
      "4_hr": "4 Hour",
      "5_hr": "5 Hour",
      "6_hr": "6 Hour",
      next_day: "Next Day"
    };
    return map[String(value || "")] || String(value || "Not set");
  }

  function localMoney(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return "-";
    }
    return numeric.toLocaleString("en-US", { style: "currency", currency: "USD" });
  }

  function localReturnLocationLabel(value) {
    const map = {
      same_as_pickup: "Same as Original Pickup",
      different_location: "Different Return Location"
    };
    return map[helpers.clean(value)] || "Same as Original Pickup";
  }

  function localReturnTimingLabel(value) {
    const map = {
      immediate: "Immediately After Delivery",
      later_today: "Later Today",
      another_day: "Another Day"
    };
    return map[helpers.clean(value)] || "Immediately After Delivery";
  }

  function localOpenModal(id) {
    const modal = document.getElementById(id);
    if (!modal) {
      return;
    }
    modal.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function localCloseModal(id) {
    const modal = document.getElementById(id);
    if (!modal) {
      return;
    }
    modal.classList.remove("open");
    if (![...document.querySelectorAll(".modal-backdrop.open")].length) {
      document.body.style.overflow = "";
    }
  }

  function runtimeActionUnavailable(actionName) {
    fallbackToast(actionName + " is temporarily unavailable.", "info");
  }

  function resolveDispatchRuntime() {
    const shared = window.MG_DISPATCH_WORKSPACE && typeof window.MG_DISPATCH_WORKSPACE === "object"
      ? window.MG_DISPATCH_WORKSPACE
      : null;

    if (shared) {
      dispatch = Object.assign({}, dispatch || {}, shared);
      dispatch.state = (shared.state && typeof shared.state === "object") ? shared.state : (dispatch.state || {});
      dispatch.client = shared.client || client;
    }

    return dispatch;
  }

  function initializeDispatchRuntime() {
    ensureClient();

    const localFacade = {
      client,
      state: {
        rows: [],
        customerDeliveryCounts: {}
      },
      showToast: fallbackToast,
      getWorkflowStage: localGetWorkflowStage,
      statusLabel: localStatusLabel,
      jobCategoryLabel: localJobCategoryLabel,
      jobCategoryClass: localJobCategoryClass,
      deliveryTypeLabel: localDeliveryTypeLabel,
      serviceLevelLabel: localServiceLevelLabel,
      deliverySpeedLabel: localDeliverySpeedLabel,
      hasReturnRequired: localHasReturnRequired,
      money: localMoney,
      returnLocationLabel: localReturnLocationLabel,
      returnTimingLabel: localReturnTimingLabel,
      openModal: localOpenModal,
      closeModal: localCloseModal,
      loadDrivers: async () => {},
      openJobDetails: null,
      openAssignModal: () => runtimeActionUnavailable("Assign Driver"),
      markPaidManually: async () => runtimeActionUnavailable("Mark Paid"),
      changeDispatchStatus: async () => runtimeActionUnavailable("Status update"),
      sendInvoiceForJob: () => runtimeActionUnavailable("Invoice"),
      openBolForJob: () => runtimeActionUnavailable("BOL"),
      openRejectedReturnConfirm: () => runtimeActionUnavailable("Return to Ready"),
      handleDocumentClick: () => {}
    };

    const shared = window.MG_DISPATCH_WORKSPACE && typeof window.MG_DISPATCH_WORKSPACE === "object"
      ? window.MG_DISPATCH_WORKSPACE
      : {};

    dispatch = Object.assign({}, localFacade, shared);
    dispatch.state = (shared.state && typeof shared.state === "object") ? shared.state : localFacade.state;
    dispatch.client = shared.client || client;
    resolveDispatchRuntime();
  }

  async function requireDispatchSession() {
    const sessionResult = await client.auth.getSession();
    const session = sessionResult?.data?.session || null;

    if (!session) {
      state.activeUserId = "none";
      renderDiagnostics();
      window.location.replace("/index.html");
      return null;
    }

    state.activeUserId = session.user?.id || "none";

    const profileResult = await client
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .maybeSingle();

    if (profileResult.error || !profileResult.data) {
      throw new Error(profileResult.error?.message || "No dispatch profile was found for this account.");
    }

    const role = String(profileResult.data.role || "").trim().toLowerCase();
    if (!["admin", "staff", "dispatcher"].includes(role)) {
      if (role === "driver") {
        window.location.replace("/driver.html");
        return null;
      }
      if (role === "customer") {
        window.location.replace("/customer.html");
        return null;
      }
      window.location.replace("/index.html");
      return null;
    }

    renderDiagnostics();
    return session;
  }

  function setTitle() {
    if (elements.title) {
      elements.title.textContent = "Deliveries";
    }
    if (elements.subtitle) {
      elements.subtitle.textContent = "Single command center for dispatch.";
    }
    document.title = "Deliveries | MG Express Dispatch";
  }

  function fallbackToast(message, type = "info") {
    const normalizedType = type === "error" ? "error" : (type === "success" ? "success" : "info");
    console[normalizedType === "error" ? "error" : "log"](message);

    const host = document.getElementById("toastWrap") || document.body;
    if (!host || !document.body) {
      return;
    }

    const toast = document.createElement("div");
    toast.className = `command-center-toast command-center-toast-${normalizedType}`;
    toast.textContent = String(message || "");
    toast.setAttribute("role", "status");
    toast.style.position = "fixed";
    toast.style.right = "16px";
    toast.style.bottom = "16px";
    toast.style.zIndex = "9999";
    toast.style.maxWidth = "320px";
    toast.style.padding = "10px 12px";
    toast.style.borderRadius = "10px";
    toast.style.color = "#fff";
    toast.style.background = normalizedType === "error" ? "#9b2929" : (normalizedType === "success" ? "#0a7a57" : "#374151");
    toast.style.boxShadow = "0 8px 22px rgba(0,0,0,.2)";

    host.appendChild(toast);
    window.setTimeout(() => {
      toast.remove();
    }, 4000);
  }

  function resolveShowToast() {
    const candidate =
      dispatch?.showToast ||
      window.MG_DISPATCH_WORKSPACE?.showToast ||
      window.MGDispatchHelpers?.showToast ||
      window.DispatchWorkspace?.showToast ||
      (typeof window.showToast === "function" ? window.showToast : null);

    if (typeof candidate === "function") {
      return candidate;
    }

    return fallbackToast;
  }

  function showToast(message, type) {
    const showToastSafe = resolveShowToast();
    showToastSafe(message, type);
  }

  function setActiveTab(tab, updateUrl = true) {
    state.activeTab = TAB_META[tab] ? tab : "pending";

    elements.tabs.forEach(button => {
      button.classList.toggle("active", button.dataset.deliveryTab === state.activeTab);
    });

    if (elements.searchPanel) {
      elements.searchPanel.classList.toggle("hidden", state.activeTab !== "search");
    }
    if (elements.visibleCount) {
      elements.visibleCount.textContent = "Loading...";
    }
    if (elements.sectionLabel) {
      elements.sectionLabel.textContent = TAB_META[state.activeTab].label + " Deliveries";
    }

    if (updateUrl) {
      const params = new URLSearchParams(window.location.search || "");
      params.set("tab", state.activeTab);
      if (state.activeTab === "search") {
        params.set("q", state.searchTerm || "");
      } else {
        params.delete("q");
      }
      const nextUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({}, "", nextUrl);
    }
  }

  function setCategory(category) {
    state.category = category;
    elements.categoryChips.forEach(button => {
      button.classList.toggle("active", button.dataset.deliveryCategory === category);
    });
    renderVisibleRows();
  }

  function setSort(sortValue) {
    state.sortBy = sortValue;
    renderVisibleRows();
  }

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function parseQueryTerm(value) {
    return normalizeText(value)
      .replace(/[%_]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function dedupeRows(rows) {
    const seen = new Set();
    return rows.filter(row => {
      const key = String(row.id || "");
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  function activeTabQueryValues(tab) {
    return TAB_META[tab]?.query || [];
  }

  function stageMatchesTab(row, tab) {
    const stage = helpers.clean(dispatch.getWorkflowStage(row));

    if (tab === "search") {
      return true;
    }

    if (tab === "rejected") {
      return helpers.clean(row.driver_acceptance_status) === "rejected" && !["completed", "delivered", "closed"].includes(stage);
    }

    if (tab === "pending") {
      return stage === "pending_approval";
    }

    return stage === tab || activeTabQueryValues(tab).includes(helpers.clean(row.status));
  }

  function rowPassesCategory(row) {
    if (state.category === "all") {
      return true;
    }

    if (state.category === "return_jobs") {
      return Boolean(dispatch.hasReturnRequired(row));
    }

    if (state.category === "stat") {
      return helpers.clean(row.service_level) === "stat" || helpers.clean(row.priority) === "stat";
    }

    return helpers.normalizeCategory(row.job_category) === state.category;
  }

  function rowPassesSearch(row) {
    if (state.activeTab !== "search") {
      return true;
    }

    const term = parseQueryTerm(state.searchTerm);
    if (!term) {
      return false;
    }

    const company = helpers.clean(helpers.rowCompany(row));
    const haystack = [
      row.job_number,
      row.customer_name,
      row.customer_email,
      row.customer_phone,
      company,
      row.pickup_address,
      row.delivery_address,
      row.reference_number,
      row.special_instructions,
      row.delivery_recipient_name,
      row.pod_recipient_name
    ].filter(Boolean).join(" ").toLowerCase();

    return haystack.includes(term);
  }

  function sortRows(rows) {
    const sorted = rows.slice();
    sorted.sort((a, b) => {
      if (state.sortBy === "customer") {
        return helpers.rowCustomer(a).localeCompare(helpers.rowCustomer(b));
      }

      if (state.sortBy === "company") {
        return helpers.rowCompany(a).localeCompare(helpers.rowCompany(b));
      }

      if (state.sortBy === "pickup_time") {
        return String(a.scheduled_date || a.requested_pickup_time || a.created_at || "").localeCompare(String(b.scheduled_date || b.requested_pickup_time || b.created_at || ""));
      }

      if (state.sortBy === "delivery_time") {
        return String(a.estimated_delivery_time || a.requested_delivery_time || a.updated_at || "").localeCompare(String(b.estimated_delivery_time || b.requested_delivery_time || b.updated_at || ""));
      }

      const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
      const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
      return state.sortBy === "oldest" ? aTime - bTime : bTime - aTime;
    });
    return sorted;
  }

  function compactRowMeta(row) {
    const pickup = row.pickup_address || "Pickup pending";
    const delivery = row.delivery_address || "Delivery pending";
    const eta = row.estimated_delivery_time ? helpers.formatTime(row.estimated_delivery_time) : "ETA pending";
    const category = dispatch.jobCategoryLabel(row.job_category);
    const service = dispatch.serviceLevelLabel(row.service_level);
    const speed = dispatch.deliverySpeedLabel(row.delivery_speed);
    const route = `${helpers.escapeHtml(pickup)}<span class="route-arrow">↓</span>${helpers.escapeHtml(delivery)}`;
    return { eta, category, service, speed, route };
  }

  function quickActions(row) {
    const stage = dispatch.getWorkflowStage(row);
    const isRejected = helpers.clean(row.driver_acceptance_status) === "rejected";

    if (isRejected) {
      return [
        { label: "Return Ready", action: "return-ready" },
        { label: "Details", action: "details" }
      ];
    }

    if (stage === "pending_approval") {
      return [
        { label: "Mark Paid", action: "mark-paid" },
        { label: "Cancel", action: "cancel" },
        { label: "Details", action: "details" }
      ];
    }

    if (stage === "ready_to_dispatch") {
      return [
        { label: "Assign Driver", action: "assign" },
        { label: "Cancel", action: "cancel" },
        { label: "Details", action: "details" }
      ];
    }

    if (stage === "assigned") {
      return [
        { label: "Assign Driver", action: "assign" },
        { label: "Cancel", action: "cancel" },
        { label: "Details", action: "details" }
      ];
    }

    if (stage === "closed") {
      return [
        { label: "Invoice", action: "invoice" },
        { label: "BOL", action: "bol" },
        { label: "Details", action: "details" }
      ];
    }

    return [
      { label: "Details", action: "details" }
    ];
  }

  function renderRow(row) {
    const meta = compactRowMeta(row);
    const actions = quickActions(row);
    const categoryBadge = dispatch.jobCategoryLabel(row.job_category);
    const stage = dispatch.getWorkflowStage(row);
    const statusText = dispatch.statusLabel(row);
    const badges = [];

    if (dispatch.hasReturnRequired(row)) {
      badges.push('<span class="mini-badge return">RETURN</span>');
    }

    if (helpers.clean(row.service_level) === "stat") {
      badges.push('<span class="mini-badge stat">STAT</span>');
    }

    if (["paid", "received", "completed"].includes(helpers.clean(row.payment_status))) {
      badges.push('<span class="mini-badge paid">PAID</span>');
    }

    if (helpers.clean(row.delivery_speed) === "next_day") {
      badges.push('<span class="mini-badge next-day">NEXT DAY</span>');
    }

    if (helpers.clean(row.priority) === "priority") {
      badges.push('<span class="mini-badge priority">Priority</span>');
    }

    const quickActionClass = actions.length > 0 ? `actions-${actions.length}` : "actions-1";

    return `
      <article
        class="delivery-row ${dispatch.jobCategoryClass(row.job_category)} ${quickActionClass}"
        data-delivery-id="${helpers.escapeHtml(String(row.id))}"
        data-open-job="${helpers.escapeHtml(String(row.id))}"
        data-readonly="${stage === "closed" ? "true" : "false"}"
        data-swipe-primary="${helpers.escapeHtml(actions[0]?.action || "details")}" 
        data-swipe-secondary="${helpers.escapeHtml(actions[1]?.action || actions[0]?.action || "details")}" 
        tabindex="0"
        role="button"
      >
        <div class="delivery-row-main">
          <div class="delivery-row-topline">
            <span class="delivery-category-dot ${dispatch.jobCategoryClass(row.job_category)}"></span>
            <span class="delivery-category-label">${helpers.escapeHtml(categoryBadge)}</span>
            <span class="delivery-job-number">${helpers.escapeHtml(helpers.rowTitle(row))}</span>
            <span class="mini-status ${stage}">${helpers.escapeHtml(statusText)}</span>
          </div>

          <div class="delivery-row-customer">${helpers.escapeHtml(helpers.rowCustomer(row))}${helpers.rowCompany(row) ? ` <span class="delivery-company">• ${helpers.escapeHtml(helpers.rowCompany(row))}</span>` : ""}</div>

          <div class="delivery-row-route">${meta.route}</div>

          <div class="delivery-row-meta">
            <span>${helpers.escapeHtml(meta.speed)}</span>
            <span>${helpers.escapeHtml(meta.service)}</span>
            <span>${helpers.escapeHtml(meta.eta)}</span>
          </div>

          <div class="delivery-row-badges">
            ${badges.join("")}
          </div>
        </div>

        <div class="delivery-row-side">
          <div class="delivery-row-chevron">›</div>
          <div class="delivery-row-actions" data-prevent-row-open="true">
            ${actions.map(action => `
              <button class="delivery-action" type="button" data-delivery-action="${helpers.escapeHtml(action.action)}" data-delivery-id="${helpers.escapeHtml(String(row.id))}">
                ${helpers.escapeHtml(action.label)}
              </button>
            `).join("")}
          </div>
        </div>
      </article>
    `;
  }

  function renderEmptyState() {
    const meta = TAB_META[state.activeTab];
    elements.rowsHost.innerHTML = `
      <div class="delivery-empty">
        <div class="delivery-empty-title">${helpers.escapeHtml(meta.empty)}</div>
        <div class="delivery-empty-copy">${helpers.escapeHtml(meta.subcopy)}</div>
        ${state.activeTab === "search" ? "" : '<button class="delivery-empty-cta" type="button" id="createFromEmptyButton">Create New Delivery</button>'}
      </div>
    `;
  }

  function renderVisibleRows() {
    const visible = sortRows(
      (Array.isArray(state.visibleRows) ? state.visibleRows : []).filter(row => rowPassesCategory(row) && rowPassesSearch(row))
    );

    state.renderedRows = visible;
    if (elements.visibleCount) {
      elements.visibleCount.textContent = `${visible.length} visible`;
    }

    if (!visible.length) {
      renderEmptyState();
      return;
    }

    elements.rowsHost.innerHTML = visible.map(renderRow).join("");
    bindSwipeGestures();
  }

  function updateCounts() {
    const tabs = ["pending", "ready", "assigned", "rejected", "completed"];
    tabs.forEach(tab => {
      const button = elements.tabs.find(item => item.dataset.deliveryTab === tab);
      if (button) {
        const count = Number(state.counts[tab] || 0);
        button.querySelector(".tab-count").textContent = `(${count})`;
      }
    });
  }

  function updateHeaderCopy() {
    const meta = TAB_META[state.activeTab];
    if (elements.sectionLabel) {
      elements.sectionLabel.textContent = meta.label + (state.activeTab === "search" ? " Search" : " Deliveries");
    }
    if (elements.subtitle) {
      elements.subtitle.textContent = state.activeTab === "search"
        ? "Search by job number, customer, company, pickup, delivery, phone or reference number."
        : "Single command center for dispatch.";
    }
  }

  function countQuery(tab) {
    if (tab === "search") {
      return Promise.resolve({ count: 0, error: null });
    }

    if (tab === "rejected") {
      return client
        .from("quotes")
        .select("id", { count: "exact", head: true })
        .eq("driver_acceptance_status", "rejected")
        .not("assigned_driver_id", "is", null);
    }

    return client
      .from("quotes")
      .select("id", { count: "exact", head: true })
      .in("status", TAB_META[tab]?.query || []);
  }

  function buildTabQuery(tab, searchTerm = "") {
    let query = client.from("quotes").select("*");

    if (tab === "search") {
      return query;
    }

    if (tab === "rejected") {
      query = query.eq("driver_acceptance_status", "rejected").not("assigned_driver_id", "is", null).order("created_at", { ascending: false });
      return query;
    }

    const values = TAB_META[tab]?.query || [];
    query = query.in("status", values).order("created_at", { ascending: false });

    return query;
  }

  async function fetchSearchRows(term) {
    const normalized = parseQueryTerm(term);
    if (!normalized) {
      return [];
    }

    const like = `%${normalized}%`;
    const quoteQuery = client
      .from("quotes")
      .select("*")
      .or([
        `job_number.ilike.${like}`,
        `customer_name.ilike.${like}`,
        `customer_email.ilike.${like}`,
        `customer_phone.ilike.${like}`,
        `pickup_address.ilike.${like}`,
        `delivery_address.ilike.${like}`,
        `reference_number.ilike.${like}`
      ].join(","))
      .order("created_at", { ascending: false })
      .limit(100);

    const customerQuery = client
      .from("customer_portal_accounts")
      .select("id")
      .or([
        `customer_name.ilike.${like}`,
        `company_name.ilike.${like}`,
        `email.ilike.${like}`,
        `phone.ilike.${like}`
      ].join(","))
      .limit(100);

    const [quoteResult, customerResult] = await Promise.all([quoteQuery, customerQuery]);

    if (quoteResult.error) {
      throw quoteResult.error;
    }
    if (customerResult.error) {
      throw customerResult.error;
    }

    const accountIds = (customerResult.data || []).map(row => String(row.id));
    let customerQuotes = [];

    if (accountIds.length) {
      const accountQuoteResult = await client
        .from("quotes")
        .select("*")
        .in("customer_account_id", accountIds)
        .order("created_at", { ascending: false })
        .limit(100);

      if (accountQuoteResult.error) {
        throw accountQuoteResult.error;
      }

      customerQuotes = accountQuoteResult.data || [];
    }

    return dedupeRows([...(quoteResult.data || []), ...customerQuotes]);
  }

  async function fetchAssignedSnapshot() {
    const result = await client
      .from("quotes")
      .select("*")
      .in("status", ["assigned", "in_progress"])
      .order("created_at", { ascending: false })
      .limit(100);

    if (result.error) {
      throw result.error;
    }

    return result.data || [];
  }

  async function fetchTodayClosedSnapshot() {
    const result = await client
      .from("quotes")
      .select("*")
      .or("status.eq.completed,status.eq.delivered,status.eq.closed,status.eq.cancelled,status.eq.canceled")
      .order("created_at", { ascending: false })
      .limit(100);

    if (result.error) {
      throw result.error;
    }

    return result.data || [];
  }

  async function loadCounts() {
    const tabs = ["pending", "ready", "assigned", "rejected", "completed"];
    const values = await Promise.all(tabs.map(tab => countQuery(tab).then(result => {
      if (result.error) {
        throw result.error;
      }
      return Number(result.count || 0);
    })));

    tabs.forEach((tab, index) => {
      state.counts[tab] = values[index] || 0;
    });
    updateCounts();
  }

  async function loadRecurringCustomers() {
    const result = await client
      .from("customer_portal_accounts")
      .select("id,customer_name,company_name,email,phone,is_recurring_customer")
      .eq("is_recurring_customer", true)
      .order("customer_name", { ascending: true });

    if (result.error) {
      throw result.error;
    }

    state.recurringCustomers = result.data || [];
  }

  function renderCustomerLookupResults(list, showOneTime) {
    const rows = list.map(customer => {
      const count = Number(dispatch.state.customerDeliveryCounts?.[String(customer.id)] || 0);
      return `
        <button class="lookup-row" type="button" data-customer-select="${helpers.escapeHtml(String(customer.id))}">
          <div class="lookup-title">${helpers.escapeHtml(customer.customer_name || "Customer")}</div>
          <div class="lookup-meta">${helpers.escapeHtml(customer.company_name || "No company")}</div>
          <div class="lookup-meta">${helpers.escapeHtml(customer.phone || "No phone")} • ${helpers.escapeHtml(customer.email || "No email")}</div>
          <div class="lookup-meta">${helpers.escapeHtml(String(count))} previous deliveries</div>
        </button>
      `;
    });

    if (showOneTime) {
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

  function applyRecurringCustomer(customerId) {
    const found = state.recurringCustomers.find(item => String(item.id) === String(customerId));
    if (!found) {
      return;
    }

    elements.jobCustomerAccountId.value = String(found.id);
    elements.jobForm.customer_name.value = found.customer_name || "";
    elements.jobForm.customer_email.value = found.email || "";
    elements.jobForm.customer_phone.value = found.phone || "";
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

  function handleCustomerLookupInput() {
    const query = normalizeText(elements.customerLookupInput.value);
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

  function syncReturnDetailsVisibility() {
    const form = elements.jobForm;
    if (!form) {
      return;
    }

    const returnRequired = helpers.clean(form.return_required?.value) === "true";
    const locationType = helpers.clean(form.return_location_type?.value || "same_as_pickup");
    const differentLocation = locationType === "different_location";

    if (elements.returnDetailsSection) {
      elements.returnDetailsSection.hidden = !returnRequired;
    }
    if (elements.returnPickupReadback) {
      elements.returnPickupReadback.hidden = !returnRequired || differentLocation;
    }

    form.querySelectorAll("[data-return-different]").forEach(field => {
      field.hidden = !returnRequired || !differentLocation;
    });

    if (!returnRequired) {
      form.return_location_type.value = "same_as_pickup";
      form.return_address.value = "";
      form.return_suite_floor.value = "";
      form.return_zip.value = "";
      form.return_timing.value = "immediate";
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
      ["Job Category", dispatch.jobCategoryLabel(form.job_category?.value)],
      ["Delivery Type", dispatch.deliveryTypeLabel(form.delivery_type?.value)],
      ["Service Level", dispatch.serviceLevelLabel(form.service_level?.value)],
      ["Vehicle", form.vehicle_type.value || "-"],
      ["Service", dispatch.deliverySpeedLabel(form.delivery_speed.value || "")],
      ["Return Service", helpers.clean(form.return_required?.value) === "true" ? "Return Required" : "No Return"],
      ["Customer Price", dispatch.money(form.approved_price.value)],
      ["Status After Save", "WAITING PAYMENT"]
    ];

    if (helpers.clean(form.return_required?.value) === "true") {
      rows.push(["Return Location", dispatch.returnLocationLabel(form.return_location_type?.value)]);
      rows.push(["Return Timing", dispatch.returnTimingLabel(form.return_timing?.value)]);
    }

    elements.newDeliveryReviewList.innerHTML = rows.map(item => `
      <div><strong>${helpers.escapeHtml(item[0])}:</strong> ${helpers.escapeHtml(String(item[1]))}</div>
    `).join("");
  }

  async function detectEstimatedMilesFieldSupport() {
    if (state.supportEstimatedMiles !== null) {
      return state.supportEstimatedMiles;
    }

    const probe = await client.from("quotes").select("estimated_miles").limit(1);
    if (!probe.error) {
      state.supportEstimatedMiles = true;
      return true;
    }

    const message = String(probe.error.message || "").toLowerCase();
    if (message.includes("column") && message.includes("estimated_miles")) {
      state.supportEstimatedMiles = false;
      return false;
    }

    throw probe.error;
  }

  async function generateJobNumber() {
    const result = await client
      .from("quotes")
      .select("job_number")
      .order("created_at", { ascending: false })
      .limit(250);

    if (result.error) {
      throw result.error;
    }

    let maxNumber = 0;
    (result.data || []).forEach(row => {
      const match = String(row.job_number || "").match(/(\d+)$/);
      if (!match) {
        return;
      }
      const numeric = Number(match[1]);
      if (Number.isFinite(numeric) && numeric > maxNumber) {
        maxNumber = numeric;
      }
    });

    return "MGE-" + String(maxNumber + 1).padStart(5, "0");
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

  function formToPayload(form, includeStatus) {
    const data = new FormData(form);
    const priceRaw = String(data.get("approved_price") || "").trim();
    const payRaw = String(data.get("driver_pay") || "").trim();
    const estimatedMilesRaw = String(data.get("estimated_miles") || "").trim();
    const internalNotes = String(data.get("special_instructions") || "").trim();
    const estimatedMilesValue = estimatedMilesRaw === "" ? null : Number(estimatedMilesRaw);

    if (estimatedMilesRaw !== "" && (!Number.isFinite(estimatedMilesValue) || estimatedMilesValue < 0)) {
      throw new Error("Estimated miles must be a valid number.");
    }

    const instructions = [];
    const billingMeta = [];
    const pickupContactName = String(data.get("pickup_contact_name") || "").trim();
    const pickupContactPhone = String(data.get("pickup_contact_phone") || "").trim();
    const pickupInstructions = String(data.get("pickup_instructions") || "").trim();
    const deliveryContactPhone = String(data.get("delivery_contact_phone") || "").trim();
    const deliveryInstructions = String(data.get("delivery_instructions") || "").trim();
    const packageWeight = String(data.get("package_weight") || "").trim();
    const referenceNumber = String(data.get("reference_number") || "").trim();
    const deliveryContactName = String(data.get("delivery_contact_name") || "").trim();

    if (pickupContactName) billingMeta.push("Pickup Contact: " + pickupContactName);
    if (pickupContactPhone) billingMeta.push("Pickup Contact Phone: " + pickupContactPhone);
    if (deliveryContactPhone) billingMeta.push("Delivery Contact Phone: " + deliveryContactPhone);
    if (packageWeight) billingMeta.push("Weight: " + packageWeight);
    if (referenceNumber) billingMeta.push("Reference #: " + referenceNumber);
    if (pickupInstructions) instructions.push("Pickup Instructions: " + pickupInstructions);
    if (deliveryInstructions) instructions.push("Delivery Instructions: " + deliveryInstructions);

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
      job_category: helpers.normalizeCategory(data.get("job_category")),
      delivery_type: String(data.get("delivery_type") || "").trim() || null,
      service_level: String(data.get("service_level") || "").trim() || null,
      return_required: helpers.clean(data.get("return_required")) === "true",
      return_location_type: String(data.get("return_location_type") || "same_as_pickup").trim() || "same_as_pickup",
      return_address: String(data.get("return_address") || "").trim() || null,
      return_suite_floor: String(data.get("return_suite_floor") || "").trim() || null,
      return_zip: String(data.get("return_zip") || "").trim() || null,
      return_timing: String(data.get("return_timing") || "immediate").trim() || "immediate",
      package_type: String(data.get("package_type") || "").trim(),
      delivery_method: String(data.get("delivery_method") || "").trim(),
      special_instructions: [internalNotes].concat(instructions).filter(Boolean).join("\n") || null,
      approved_price: priceRaw === "" ? null : Number(priceRaw),
      driver_pay: payRaw === "" ? null : Number(payRaw),
      assigned_driver_id: String(data.get("assigned_driver_id") || "").trim() || null,
      invoice_delivery_method: String(data.get("invoice_delivery_method") || "none").trim(),
      billing_notes: billingMeta.join("\n") || null
    };

    if (!payload.return_required) {
      payload.return_location_type = null;
      payload.return_address = null;
      payload.return_suite_floor = null;
      payload.return_zip = null;
      payload.return_timing = null;
    } else if (helpers.clean(payload.return_location_type) !== "different_location") {
      payload.return_location_type = "same_as_pickup";
      payload.return_address = null;
      payload.return_suite_floor = null;
      payload.return_zip = null;
    }

    if (includeStatus) {
      payload.status = String(data.get("status") || "new").trim();
    }

    payload._estimated_miles_value = estimatedMilesValue;
    return payload;
  }

  function openCreateJobModal() {
    if (!elements.jobForm || !elements.jobModalTitle || !elements.saveJobBtn || !elements.jobCustomerAccountId || !elements.customerLookupInput || !elements.customerLookupResults) {
      const error = new Error("New Delivery modal elements are missing.");
      setDiagnosticsError(error);
      showToast(error.message, "error");
      return;
    }

    elements.jobForm.reset();
    elements.jobRecordId.value = "";
    elements.jobModalTitle.textContent = "New Delivery";
    elements.saveJobBtn.textContent = "Create Delivery";
    elements.jobCustomerAccountId.value = "";
    elements.customerLookupInput.value = "";
    elements.customerLookupResults.classList.remove("open");
    elements.jobForm.job_category.value = "general";
    elements.jobForm.delivery_type.value = "";
    elements.jobForm.service_level.value = "";
    elements.jobForm.return_required.value = "false";
    elements.jobForm.return_location_type.value = "same_as_pickup";
    elements.jobForm.return_timing.value = "immediate";
    syncReturnDetailsVisibility();
    renderNewDeliveryReview();
    dispatch.openModal("jobModal");
  }

  async function submitJobForm(event) {
    event.preventDefault();
    if (!elements.saveJobBtn || !elements.jobForm || !elements.jobRecordId) {
      const error = new Error("Delivery form elements are missing.");
      setDiagnosticsError(error);
      showToast(error.message, "error");
      return;
    }

    const saveBtn = elements.saveJobBtn;
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
      const recordId = elements.jobRecordId.value;
      const payload = formToPayload(elements.jobForm, false);
      const estimatedMilesValue = payload._estimated_miles_value;
      delete payload._estimated_miles_value;

      if (await detectEstimatedMilesFieldSupport()) {
        payload.estimated_miles = estimatedMilesValue;
      }

      const validationError = validatePayload(payload);
      if (validationError) {
        showToast(validationError, "error");
        return;
      }

      if (!recordId) {
        payload.status = "waiting_payment";
        payload.assigned_driver_id = null;
        payload.driver_pay = null;
        payload.driver_acceptance_status = null;
        payload.driver_workflow_status = null;
        payload.driver_accepted_at = null;
        payload.driver_rejected_at = null;
        payload.job_number = await generateJobNumber();

        const insertResult = await client.from("quotes").insert(payload).select("*").maybeSingle();
        if (insertResult.error) {
          throw insertResult.error;
        }
      } else {
        const original = state.visibleRows.find(row => String(row.id) === String(recordId));
        if (original) {
          payload.status = original.status;
          payload.assigned_driver_id = original.assigned_driver_id;
          payload.driver_pay = original.driver_pay;
          payload.driver_acceptance_status = original.driver_acceptance_status;
          payload.driver_workflow_status = original.driver_workflow_status;
          payload.driver_accepted_at = original.driver_accepted_at;
          payload.driver_rejected_at = original.driver_rejected_at;
        }

        const updateResult = await client.from("quotes").update(payload).eq("id", recordId).select("*").maybeSingle();
        if (updateResult.error) {
          throw updateResult.error;
        }
      }

      dispatch.closeModal("jobModal");
      await refreshCurrentTab();
      showToast(recordId ? "Delivery updated successfully" : "Delivery created successfully", "success");
    } catch (error) {
      showToast(error.message || "Unable to save delivery", "error");
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = elements.jobRecordId.value ? "Save Delivery" : "Create Delivery";
    }
  }

  function bindSwipeGestures() {
    document.querySelectorAll("[data-open-job]").forEach(row => {
      let startX = 0;
      let startY = 0;
      let pointerActive = false;

      row.addEventListener("pointerdown", event => {
        pointerActive = true;
        startX = event.clientX;
        startY = event.clientY;
      });

      row.addEventListener("pointerup", event => {
        if (!pointerActive) {
          return;
        }
        pointerActive = false;
        const dx = event.clientX - startX;
        const dy = Math.abs(event.clientY - startY);
        if (dy > 60) {
          return;
        }

        const primary = row.dataset.swipePrimary;
        const secondary = row.dataset.swipeSecondary;
        if (dx > 70 && primary) {
          triggerQuickAction(row.dataset.openJob, primary);
        } else if (dx < -70 && secondary) {
          triggerQuickAction(row.dataset.openJob, secondary);
        }
      });
    });
  }

  function getDisplayRows() {
    const activeRows = state.activeTab === "search"
      ? state.visibleRows
      : state.visibleRows.filter(row => stageMatchesTab(row, state.activeTab));

    return dedupeRows(activeRows);
  }

  function updateWorkspaceRowsCache(displayRows) {
    const combined = dedupeRows([...displayRows, ...state.assignedSnapshot, ...state.metricsSnapshot]);
    dispatch.state.rows = combined;
    const counts = {};
    combined.forEach(row => {
      const key = String(row.customer_account_id || "").trim();
      if (!key) {
        return;
      }
      counts[key] = (counts[key] || 0) + 1;
    });
    dispatch.state.customerDeliveryCounts = counts;
    state.rowsVersion += 1;
  }

  function updateCountsFromQuery() {
    elements.tabs.forEach(button => {
      const tab = button.dataset.deliveryTab;
      if (!button.querySelector(".tab-count")) {
        return;
      }
      button.querySelector(".tab-count").textContent = `(${Number(state.counts[tab] || 0)})`;
    });
  }

  async function loadVisibleRows() {
    const tab = state.activeTab;
    state.queryStarted = true;
    state.queryCompleted = false;
    renderDiagnostics();

    if (tab === "search") {
      state.visibleRows = await fetchSearchRows(state.searchTerm);
    } else {
      const result = await buildTabQuery(tab);
      if (result.error) {
        throw result.error;
      }
      state.visibleRows = result.data || [];
    }

    state.assignedSnapshot = await fetchAssignedSnapshot();
    state.metricsSnapshot = await fetchTodayClosedSnapshot();
    state.returnedRows = Array.isArray(state.visibleRows) ? state.visibleRows.length : 0;
    state.queryCompleted = true;
    updateWorkspaceRowsCache(getDisplayRows());
    renderVisibleRows();
    updateHeaderCopy();
    renderDiagnostics();
  }

  async function loadDeliveriesForActiveTab() {
    if (state.loading) {
      return;
    }

    setDeliveryLoading(true);
    state.lastError = "";
    state.lastErrorStack = "";
    state.lastSupabaseError = "";
    renderDiagnostics();

    try {
      await loadCounts();
      await loadVisibleRows();
    } catch (error) {
      const supabaseMessage = error?.details || error?.hint || error?.code || "";
      setDiagnosticsError(error, supabaseMessage);
      renderDeliveryError(error.message || "Unable to load deliveries");
      showToast(error.message || "Unable to load deliveries", "error");
    } finally {
      setDeliveryLoading(false);
    }
  }

  async function refreshCurrentTab() {
    await loadDeliveriesForActiveTab();
  }

  function hasTabButton(tabName) {
    return elements.tabs.some(button => String(button.dataset.deliveryTab || "") === tabName);
  }

  function validateDomElements() {
    const requiredTabNames = ["pending", "ready", "assigned", "rejected", "completed", "search"];
    requiredTabNames.forEach(tabName => {
      if (!hasTabButton(tabName)) {
        recordMissingElement(`tab:${tabName}`);
      }
    });

    const optionalElements = [
      ["category chips", elements.categoryChips.length > 0],
      ["sort dropdown", Boolean(elements.sortSelect)],
      ["search input", Boolean(elements.searchInput)],
      ["delivery list container", Boolean(elements.rowsHost)],
      ["top New Delivery button", Boolean(elements.newDeliveryButton)],
      ["refresh button", Boolean(elements.refreshButton)]
    ];

    optionalElements.forEach(item => {
      if (!item[1]) {
        recordMissingElement(item[0]);
      }
    });

    if (!elements.rowsHost) {
      throw new Error("Delivery list container is missing.");
    }
  }

  async function loadInitialData() {
    const runtime = resolveDispatchRuntime();
    setTitle();
    if (window.location.search) {
      const params = new URLSearchParams(window.location.search);
      const tab = String(params.get("tab") || "pending").trim();
      state.activeTab = TAB_META[tab] ? tab : "pending";
      state.searchTerm = String(params.get("q") || "").trim();
      if (elements.searchInput) {
        elements.searchInput.value = state.searchTerm;
      }
    }

    if (elements.sortSelect) {
      elements.sortSelect.value = state.sortBy;
    }
    setActiveTab(state.activeTab, false);
    setCategory("all");
    updateHeaderCopy();

    await runtime.loadDrivers();
    await loadRecurringCustomers();
    await loadDeliveriesForActiveTab();
  }

  function triggerQuickAction(jobId, action) {
    const runtime = resolveDispatchRuntime();
    const row = state.visibleRows.find(item => String(item.id) === String(jobId));
    if (!row) {
      return;
    }

    if (action === "details") {
      openDeliveryDetails(row);
      return;
    }

    if (action === "assign") {
      runtime.openAssignModal(jobId);
      return;
    }

    if (action === "mark-paid") {
      runtime.markPaidManually(jobId).then(refreshCurrentTab).catch(() => refreshCurrentTab());
      return;
    }

    if (action === "cancel") {
      runtime.changeDispatchStatus(jobId, "cancelled", null).then(refreshCurrentTab).catch(() => refreshCurrentTab());
      return;
    }

    if (action === "invoice") {
      runtime.sendInvoiceForJob(jobId);
      return;
    }

    if (action === "bol") {
      runtime.openBolForJob(row);
      return;
    }

    if (action === "return-ready") {
      runtime.openRejectedReturnConfirm(jobId);
      return;
    }
  }

  function openDeliveryDetails(delivery) {
    if (!delivery) {
      showToast("Unable to open delivery.", "error");
      return;
    }

    state.selectedDelivery = delivery;
    const runtime = resolveDispatchRuntime();
    if (typeof runtime?.openJobDetails !== "function") {
      showToast("Unable to open delivery.", "error");
      return;
    }

    runtime.openJobDetails(delivery.id, state.activeTab === "completed");
  }

  function handleRowsHostClick(event) {
    const actionButton = event.target.closest("[data-delivery-action]");
    if (actionButton) {
      event.preventDefault();
      event.stopPropagation();
      triggerQuickAction(actionButton.getAttribute("data-delivery-id"), actionButton.getAttribute("data-delivery-action"));
      return;
    }

    if (event.target.closest("button, a, input, select, textarea, label")) {
      return;
    }

    const row = event.target.closest("[data-delivery-id]");
    if (!row || !elements.rowsHost || !elements.rowsHost.contains(row)) {
      return;
    }

    const deliveryId = row.getAttribute("data-delivery-id");
    const delivery = state.renderedRows.find(item => String(item.id) === String(deliveryId));
    if (!delivery) {
      showToast("Unable to open delivery.", "error");
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openDeliveryDetails(delivery);
  }

  function handleRowsHostKeydown(event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    const row = event.target.closest("[data-delivery-id]");
    if (!row || !elements.rowsHost || !elements.rowsHost.contains(row)) {
      return;
    }

    const deliveryId = row.getAttribute("data-delivery-id");
    const delivery = state.renderedRows.find(item => String(item.id) === String(deliveryId));
    if (!delivery) {
      showToast("Unable to open delivery.", "error");
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    openDeliveryDetails(delivery);
  }

  function handleDocumentClicks(event) {
    const actionButton = event.target.closest("[data-delivery-action]");
    if (actionButton) {
      event.preventDefault();
      event.stopPropagation();
      triggerQuickAction(actionButton.getAttribute("data-delivery-id"), actionButton.getAttribute("data-delivery-action"));
      return;
    }

    const newDeliveryFromEmpty = event.target.closest("#createFromEmptyButton");
    if (newDeliveryFromEmpty) {
      event.preventDefault();
      openCreateJobModal();
      return;
    }

    const tabButton = event.target.closest("[data-delivery-tab]");
    if (tabButton) {
      event.preventDefault();
      event.stopPropagation();
      setActiveTab(tabButton.dataset.deliveryTab);
      loadDeliveriesForActiveTab().catch(error => {
        setDiagnosticsError(error);
        renderDeliveryError(error.message || "Unable to load deliveries");
      });
      return;
    }

    const chip = event.target.closest("[data-delivery-category]");
    if (chip) {
      event.preventDefault();
      setCategory(chip.dataset.deliveryCategory);
      return;
    }

    const closeModal = event.target.closest("[data-close-modal]");
    if (closeModal) {
      dispatch.closeModal(closeModal.getAttribute("data-close-modal"));
      return;
    }

    const retryButton = event.target.closest("#retryLoadDeliveriesButton");
    if (retryButton) {
      event.preventDefault();
      loadDeliveriesForActiveTab().catch(error => {
        setDiagnosticsError(error);
        renderDeliveryError(error.message || "Unable to load deliveries");
      });
      return;
    }

    const runtime = resolveDispatchRuntime();
    runtime.handleDocumentClick(event);
  }

  function bindEvents() {
    if (commandCenterEventsBound) {
      return;
    }

    if (elements.sortSelect) {
      elements.sortSelect.addEventListener("change", () => {
        setSort(elements.sortSelect.value || "newest");
      });
    }

    if (elements.searchInput) {
      elements.searchInput.addEventListener("input", () => {
        state.searchTerm = elements.searchInput.value || "";
        if (state.activeTab === "search") {
          clearTimeout(state.searchTimer);
          state.searchTimer = setTimeout(() => {
            loadDeliveriesForActiveTab().catch(error => {
              setDiagnosticsError(error);
              renderDeliveryError(error.message || "Unable to load deliveries");
            });
          }, 220);
        }
      });
    }

    if (elements.newDeliveryButton) {
      elements.newDeliveryButton.addEventListener("click", openCreateJobModal);
    }
    if (elements.refreshButton) {
      elements.refreshButton.addEventListener("click", () => {
        loadDeliveriesForActiveTab().catch(error => {
          setDiagnosticsError(error);
          renderDeliveryError(error.message || "Unable to load deliveries");
        });
      });
    }
    if (elements.rowsHost) {
      elements.rowsHost.addEventListener("click", handleRowsHostClick);
      elements.rowsHost.addEventListener("keydown", handleRowsHostKeydown);
    }
    if (elements.jobForm) {
      elements.jobForm.addEventListener("submit", submitJobForm);
    }
    if (elements.customerLookupInput) {
      elements.customerLookupInput.addEventListener("input", handleCustomerLookupInput);
    }
    if (elements.jobForm) {
      elements.jobForm.addEventListener("input", () => {
        syncReturnDetailsVisibility();
        renderNewDeliveryReview();
      });
    }
    if (elements.returnRequired) {
      elements.returnRequired.addEventListener("change", () => {
        syncReturnDetailsVisibility();
        renderNewDeliveryReview();
      });
    }
    if (elements.returnLocationType) {
      elements.returnLocationType.addEventListener("change", () => {
        syncReturnDetailsVisibility();
        renderNewDeliveryReview();
      });
    }

    document.addEventListener("click", handleDocumentClicks);
    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        document.querySelectorAll(".modal-backdrop.open").forEach(modal => dispatch.closeModal(modal.id));
      }
    });

    window.addEventListener("storage", event => {
      if (event.key === "mg_dispatch_refresh" && event.newValue) {
        loadDeliveriesForActiveTab().catch(error => showToast(error.message || "Unable to refresh deliveries", "error"));
      }

      if (event.key === "mg_driver_profile_refresh" && event.newValue) {
        dispatch.loadDrivers().then(() => {
          if (state.activeTab === "search" || state.activeTab === "assigned") {
            loadDeliveriesForActiveTab().catch(error => showToast(error.message || "Unable to refresh deliveries", "error"));
          }
        });
      }
    });

    window.addEventListener("focus", () => {
      loadCounts().catch(() => {});
    });

    commandCenterEventsBound = true;
  }

  async function initializeDeliveryCommandCenter() {
    if (commandCenterInitialized) {
      return;
    }
    commandCenterInitialized = true;
    state.startupStarted = true;
    renderDiagnostics();

    try {
      initializeDispatchRuntime();
      validateDomElements();
      bindEvents();
      updateCounts();

      const session = await requireDispatchSession();
      if (!session) {
        return;
      }

      await loadInitialData();

      setInterval(() => {
        loadCounts().then(() => {
          if (!state.loading) {
            loadDeliveriesForActiveTab().catch(() => {});
          }
        }).catch(() => {});
      }, 60000);
    } catch (error) {
      const supabaseMessage = error?.details || error?.hint || error?.code || "";
      setDiagnosticsError(error, supabaseMessage);
      showToast(error.message || "Unable to load deliveries", "error");
      renderDeliveryError(error.message || "Unable to load deliveries");
    } finally {
      setDeliveryLoading(false);
      renderDiagnostics();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeDeliveryCommandCenter, { once: true });
  } else {
    initializeDeliveryCommandCenter().catch(error => {
      setDiagnosticsError(error);
      renderDeliveryError(error.message || "Unable to load deliveries");
    });
  }
})();
