(function () {
  "use strict";

  const LOCAL_KEY = "mgexpress_sales_leads_v1";
  const TABLE = "sales_leads";
  const fields = [
    "business",
    "contact",
    "industry",
    "status",
    "phone",
    "email",
    "address",
    "last_contact",
    "next_follow_up",
    "notes"
  ];

  let leads = [];
  let client = null;
  let authData = null;
  let databaseReady = true;
  let welcomeStatusByLead = new Map();
  let welcomeLeadId = null;
  let welcomeBusy = false;

  const $ = id => document.getElementById(id);

  function esc(value) {
    const div = document.createElement("div");
    div.textContent = value || "";
    return div.innerHTML;
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function toUi(row) {
    return {
      id: row.id,
      business: row.business || "",
      contact: row.contact || "",
      industry: row.industry || "",
      status: row.status || "New Lead",
      phone: row.phone || "",
      email: row.email || "",
      address: row.address || "",
      lastContact: row.last_contact || "",
      nextFollowUp: row.next_follow_up || "",
      notes: row.notes || "",
      createdAt: row.created_at || ""
    };
  }

  function toDb(x) {
    return {
      business: x.business,
      contact: x.contact || null,
      industry: x.industry || null,
      status: x.status || "New Lead",
      phone: x.phone || null,
      email: x.email || null,
      address: x.address || null,
      last_contact: x.lastContact || null,
      next_follow_up: x.nextFollowUp || null,
      notes: x.notes || null,
      updated_by: authData?.user?.id || null
    };
  }

  function setNotice(message, kind) {
    const box = $("pageNotice");
    if (!box) return;
    box.textContent = message || "";
    box.className = "notice " + (kind || "");
    box.hidden = !message;
  }

  function loadLocal() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function loadDatabase() {
    const result = await client
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: false });

    if (result.error) throw result.error;
    leads = (result.data || []).map(toUi);
    const welcomes = await client.from('sales_welcome_packets')
      .select('lead_id,status,sent_at,recipient_email');
    if (welcomes.error) throw welcomes.error;
    welcomeStatusByLead = new Map((welcomes.data || []).map(x => [x.lead_id, x]));
  }

  async function migrateLocalLeads() {
    const local = loadLocal();
    if (!local.length) return;

    const rows = local.map(x => ({
      ...toDb(x),
      id: x.id || undefined,
      created_by: authData?.user?.id || null
    }));

    const result = await client.from(TABLE).upsert(rows, { onConflict: "id" });
    if (result.error) throw result.error;

    localStorage.removeItem(LOCAL_KEY);
    setNotice(`${local.length} saved browser lead${local.length === 1 ? "" : "s"} moved into the MG Express database.`, "success");
  }

  async function load() {
    setNotice("Loading leads...", "");
    try {
      await migrateLocalLeads();
      await loadDatabase();
      databaseReady = true;
      if (!$("pageNotice").classList.contains("success")) setNotice("", "");
    } catch (error) {
      console.error("MG Express leads database error:", error);
      databaseReady = false;
      leads = loadLocal();
      setNotice("The Leads page is ready, but the sales_leads database table still needs to be installed. Browser storage will be used temporarily.", "warning");
    }
    render();
  }

  function render() {
    const q = $("search").value.toLowerCase();
    const sf = $("statusFilter").value;
    const inf = $("industryFilter").value;
    const industries = [...new Set(leads.map(x => x.industry).filter(Boolean))].sort();
    const current = $("industryFilter").value;

    $("industryFilter").innerHTML = '<option value="all">All Industries</option>' +
      industries.map(x => `<option>${esc(x)}</option>`).join("");
    if (industries.includes(current)) $("industryFilter").value = current;

    $("sNew").textContent = leads.filter(x => x.status === "New Lead").length;
    $("sFollow").textContent = leads.filter(x => x.nextFollowUp && x.nextFollowUp <= today() && !["Customer", "Not Interested"].includes(x.status)).length;
    $("sQuote").textContent = leads.filter(x => x.status === "Quote Requested").length;
    $("sCustomer").textContent = leads.filter(x => x.status === "Customer").length;

    const filtered = leads.filter(x => {
      const hay = [x.business, x.contact, x.phone, x.email, x.industry, x.address].join(" ").toLowerCase();
      return (!q || hay.includes(q)) &&
        (sf === "all" || x.status === sf) &&
        (inf === "all" || x.industry === inf);
    });

    $("list").innerHTML = filtered.length ? filtered.map(x => `
      <article class="lead panel">
        <div>
          <div class="business">${esc(x.business)}</div>
          <div class="small">${esc(x.contact || "No contact yet")} ${x.industry ? "• " + esc(x.industry) : ""}</div>
        </div>
        <div>
          <span class="badge">${esc(x.status)}</span>
          <div class="small">Follow-up: ${esc(x.nextFollowUp || "Not set")}</div>
        </div>
        <div>
          <div>${esc(x.phone || "No phone")}</div>
          <div class="small">${esc(x.email || "No email")}</div>
        </div>
        <div class="actions welcome-actions">
          <button class="mini" data-amanda="${esc(x.id)}" type="button">Amanda check</button>
          <button class="mini" data-welcome="${esc(x.id)}" type="button" ${welcomeStatusByLead.has(x.id) || !x.email || x.status === "Not Interested" ? "disabled" : ""}>${welcomeStatusByLead.has(x.id) ? (welcomeStatusByLead.get(x.id).status === "sent" ? "Welcome Sent" : "Welcome Review") : "Send Welcome Packet"}</button>
          <button class="mini" data-edit="${esc(x.id)}">Open</button>
        </div>
        ${welcomeStatusByLead.has(x.id) ? `<div class="welcome-status ${welcomeStatusByLead.get(x.id).status === "sent" ? "" : "review"}">${welcomeStatusByLead.get(x.id).status === "sent" ? "Welcome emailed" : "Welcome delivery needs review"}</div>` : ""}
      </article>`).join("") : '<div class="panel empty">No leads yet. Add the first MG Express prospect.</div>';

    $("list").querySelectorAll("[data-edit]").forEach(button => {
      button.onclick = () => openModal(button.dataset.edit);
    });
    $("list").querySelectorAll("[data-amanda]").forEach(button => {
      button.onclick = () => checkAmanda(button.dataset.amanda, button);
    });
    $("list").querySelectorAll("[data-welcome]").forEach(button => {
      button.onclick = () => openWelcomeModal(button.dataset.welcome);
    });
  }

  function openModal(id) {
    const x = leads.find(v => v.id === id);
    $("form").reset();
    $("id").value = x?.id || "";
    $("modalTitle").textContent = x ? "Edit Lead" : "New Lead";

    if (x) {
      $("business").value = x.business || "";
      $("contact").value = x.contact || "";
      $("industry").value = x.industry || "";
      $("status").value = x.status || "New Lead";
      $("phone").value = x.phone || "";
      $("email").value = x.email || "";
      $("address").value = x.address || "";
      $("lastContact").value = x.lastContact || "";
      $("nextFollowUp").value = x.nextFollowUp || "";
      $("notes").value = x.notes || "";
    }

    $("deleteBtn").style.display = x ? "inline-block" : "none";
    $("modalBg").classList.add("open");
  }

  function closeModal() {
    $("modalBg").classList.remove("open");
  }

  function formValue(id) {
    return $(id).value.trim();
  }

  function readForm() {
    return {
      id: $("id").value || crypto.randomUUID(),
      business: formValue("business"),
      contact: formValue("contact"),
      industry: formValue("industry"),
      status: formValue("status"),
      phone: formValue("phone"),
      email: formValue("email"),
      address: formValue("address"),
      lastContact: formValue("lastContact"),
      nextFollowUp: formValue("nextFollowUp"),
      notes: formValue("notes")
    };
  }

  async function saveLead(x) {
    if (databaseReady) {
      const payload = {
        id: x.id,
        ...toDb(x),
        created_by: authData?.user?.id || null
      };
      const result = await client.from(TABLE).upsert(payload).select("*").single();
      if (result.error) throw result.error;
      const saved = toUi(result.data);
      const index = leads.findIndex(v => v.id === saved.id);
      if (index >= 0) leads[index] = saved;
      else leads.unshift(saved);
    } else {
      const index = leads.findIndex(v => v.id === x.id);
      if (index >= 0) leads[index] = x;
      else leads.unshift(x);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(leads));
    }
    render();
  }

  async function deleteLead(id) {
    if (databaseReady) {
      const result = await client.from(TABLE).delete().eq("id", id);
      if (result.error) throw result.error;
    } else {
      leads = leads.filter(x => x.id !== id);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(leads));
    }
    leads = leads.filter(x => x.id !== id);
    render();
  }

  async function checkAmanda(leadId, button) {
    if (!authData?.session?.access_token) {
      setNotice("Dispatch session required. No call placed.", "warning");
      return;
    }
    button.disabled = true;
    setNotice("Checking Amanda AI sales eligibility. No calls will be placed.", "");
    try {
      const response = await fetch("/.netlify/functions/amanda-sales-preflight", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + authData.session.access_token
        },
        body: JSON.stringify({ lead_id: leadId })
      });
      const report = await response.json();
      if (!response.ok) throw new Error(report?.error || "Check could not be completed");
      const labels = {
        no_valid_us_phone: "Missing valid US phone",
        lead_not_interested: "Lead marked not interested",
        do_not_call: "On do-not-call list",
        no_verified_phone_specific_ai_marketing_permission: "No approved AI-calling permission",
        invalid_or_expired_permission: "Permission expired or invalid",
        outbound_agent_not_connected: "Amanda provider not connected",
        legal_and_provider_approval_pending: "Legal/provider approval pending",
        dialing_disabled: "Dialing disabled"
      };
      const message = (report.blockers || []).map(x => labels[x] || x).join("; ");
      setNotice("Amanda eligibility check: " + message + ". No call placed.", "warning");
    } catch (error) {
      setNotice("Amanda check unavailable: " + error.message + ". No call placed.", "warning");
    } finally {
      button.disabled = false;
    }
  }


  function welcomeNotice(message, kind) {
    const box = $("welcomeNotice");
    box.textContent = message || "";
    box.className = "notice " + (kind || "");
    box.hidden = !message;
  }

  function openWelcomeModal(leadId) {
    const lead = leads.find(x => x.id === leadId);
    if (!lead || !lead.email || lead.status === "Not Interested") return;
    welcomeLeadId = lead.id;
    $("welcomeBusiness").textContent = lead.business || "";
    $("welcomeContact").textContent = lead.contact || "Not provided";
    $("welcomeEmail").textContent = lead.email;
    $("welcomePermissionSource").value = "";
    $("welcomePermissionCheck").checked = false;
    $("sendWelcome").disabled = false;
    $("previewWelcome").disabled = false;
    welcomeNotice("", "");
    $("welcomeBg").classList.add("open");
    $("welcomeBg").setAttribute("aria-hidden", "false");
  }

  function closeWelcomeModal() {
    if (!welcomeBusy) {
      $("welcomeBg").classList.remove("open");
      $("welcomeBg").setAttribute("aria-hidden", "true");
      welcomeLeadId = null;
    }
  }

  async function welcomeRequest(action, extra = {}) {
    const token = authData?.session?.access_token;
    if (!token || !welcomeLeadId) throw Error("Your dispatch session has expired. Please log in again.");
    const response = await fetch("/.netlify/functions/send-welcome-packet", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify({ action, lead_id: welcomeLeadId, ...extra })
    });
    if (action === "preview" && response.ok) return response.blob();
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(json.error || "Welcome packet request failed.");
    return json;
  }

  async function previewWelcome() {
    const button = $("previewWelcome");
    button.disabled = true;
    welcomeBusy = true;
    welcomeNotice("Preparing your branded welcome PDF...", "");
    try {
      const pdf = await welcomeRequest("preview");
      const url = URL.createObjectURL(pdf);
      const link = document.createElement("a");
      link.href = url;
      link.download = "MG-Express-Welcome-Packet.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      welcomeNotice("Welcome PDF ready. No email was sent.", "success");
    } catch (error) {
      welcomeNotice(error.message, "error");
    } finally {
      button.disabled = false;
      welcomeBusy = false;
    }
  }

  async function sendWelcome() {
    const lead = leads.find(x => x.id === welcomeLeadId);
    if (!lead) return;
    const source = $("welcomePermissionSource").value;
    if (!$("welcomePermissionCheck").checked || !source) {
      welcomeNotice("Confirm the customer's request and select how they requested the email.", "warning");
      return;
    }
    if (!window.confirm("Send the MG Express welcome email and 2-page PDF to " + lead.email + "?")) return;
    $("sendWelcome").disabled = true;
    $("previewWelcome").disabled = true;
    welcomeBusy = true;
    let sent = false;
    welcomeNotice("Sending the welcome email once. Please do not close this window.", "");
    try {
      const result = await welcomeRequest("send", {
        confirmed_customer_requested_email: true,
        approval_source: source
      });
      try { await loadDatabase(); render(); } catch (reloadError) {
        console.warn("Welcome sent but sales list refresh failed", reloadError);
      }
      welcomeNotice("Welcome email and PDF sent to " + result.sent_to + ".", "success");
      setNotice("MG Express welcome packet sent to " + result.sent_to + ".", "success");
      sent = true;
    } catch (error) {
      try { await loadDatabase(); render(); } catch (_) {}
      welcomeNotice(error.message, "error");
    } finally {
      welcomeBusy = false;
      $("sendWelcome").disabled = sent;
      $("previewWelcome").disabled = false;
    }
  }

  async function initialize() {
    try {
      authData = await window.MG_AUTH.requireDispatch();
      if (!authData) return;
      client = window.mgSupabase;
      $("staffEmail").textContent = authData.user?.email || "MG Express Dispatch";
    } catch (error) {
      console.error(error);
      window.location.replace("/index.html?error=access");
      return;
    }

    $("newLead").onclick = () => openModal();
    $("closeWelcome").onclick = closeWelcomeModal;
    $("cancelWelcome").onclick = closeWelcomeModal;
    $("welcomeBg").onclick = event => { if (event.target === $("welcomeBg")) closeWelcomeModal(); };
    $("previewWelcome").onclick = previewWelcome;
    $("sendWelcome").onclick = sendWelcome;
    $("close").onclick = closeModal;
    $("cancel").onclick = closeModal;
    $("modalBg").onclick = event => { if (event.target === $("modalBg")) closeModal(); };
    $("search").oninput = render;
    $("statusFilter").onchange = render;
    $("industryFilter").onchange = render;

    $("form").onsubmit = async event => {
      event.preventDefault();
      const button = event.submitter;
      if (button) button.disabled = true;
      try {
        await saveLead(readForm());
        closeModal();
      } catch (error) {
        console.error(error);
        alert("Could not save this lead. Please try again.");
      } finally {
        if (button) button.disabled = false;
      }
    };

    $("deleteBtn").onclick = async () => {
      const id = $("id").value;
      if (!id || !confirm("Delete this lead?")) return;
      try {
        await deleteLead(id);
        closeModal();
      } catch (error) {
        console.error(error);
        alert("Could not delete this lead. Please try again.");
      }
    };

    await load();
  }

  initialize();
})();