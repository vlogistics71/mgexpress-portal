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
        <div class="actions"><button class="mini" data-edit="${x.id}">Open</button></div>
      </article>`).join("") : '<div class="panel empty">No leads yet. Add the first MG Express prospect.</div>';

    $("list").querySelectorAll("[data-edit]").forEach(button => {
      button.onclick = () => openModal(button.dataset.edit);
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