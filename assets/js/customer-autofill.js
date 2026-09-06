(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(async function () {
    const form = document.getElementById("requestForm");
    const client = window.mgSupabase;
    if (!form || !client || !form.customer_name) return;

    const nameInput = form.customer_name;
    const emailInput = form.customer_email;
    const phoneInput = form.customer_phone;
    const companyInput = form.company;
    const pickupInput = form.pickup_address;
    const deliveryInput = form.delivery_address;

    const customerId = document.createElement("input");
    customerId.type = "hidden";
    customerId.name = "customer_id";
    customerId.id = "customer_id";
    form.appendChild(customerId);

    const results = document.createElement("div");
    results.className = "lookup-results";
    results.id = "customerLookupResults";
    results.style.gridColumn = "1 / -1";
    nameInput.closest(".form-grid").appendChild(results);

    const hint = document.createElement("div");
    hint.className = "hint";
    hint.style.gridColumn = "1 / -1";
    hint.textContent = "Start typing a saved customer, company, email, or phone. Select a match to autofill this job.";
    results.before(hint);

    let customers = [];
    try {
      const { data, error } = await client
        .from("customers")
        .select("id,name,company,email,phone,billing_address,default_pickup_address,default_delivery_address")
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      customers = data || [];
    } catch (error) {
      console.warn("[MG Customer Autofill] Customer directory unavailable", error);
      return;
    }

    const normalize = value => String(value || "").trim().toLowerCase();
    const escapeHtml = value => String(value || "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));

    function choose(customer) {
      customerId.value = customer.id || "";
      nameInput.value = customer.name || "";
      emailInput.value = customer.email || "";
      phoneInput.value = customer.phone || "";
      companyInput.value = customer.company || "";
      if (customer.default_pickup_address) pickupInput.value = customer.default_pickup_address;
      if (customer.default_delivery_address) deliveryInput.value = customer.default_delivery_address;
      results.classList.remove("open");
      results.innerHTML = "";
      hint.textContent = `Saved customer selected: ${customer.company || customer.name || customer.email || "Customer"}. You can change any field for this job.`;
    }

    function render(query) {
      const q = normalize(query);
      if (q.length < 2) {
        results.classList.remove("open");
        results.innerHTML = "";
        return;
      }

      const matches = customers.filter(customer =>
        [customer.name, customer.company, customer.email, customer.phone]
          .some(value => normalize(value).includes(q))
      ).slice(0, 8);

      if (!matches.length) {
        results.innerHTML = '<div class="lookup-meta">No saved customer found. Continue entering the new customer and MG Express will save them when the job is created.</div>';
        results.classList.add("open");
        customerId.value = "";
        return;
      }

      results.innerHTML = matches.map((customer, index) => `
        <button type="button" class="lookup-row" data-customer-index="${index}">
          <span class="lookup-title">${escapeHtml(customer.company || customer.name || "Saved Customer")}</span>
          <span class="lookup-meta">${escapeHtml([customer.name, customer.email, customer.phone].filter(Boolean).join(" · "))}</span>
        </button>`).join("");
      results.classList.add("open");
      results.querySelectorAll("[data-customer-index]").forEach(button => {
        button.addEventListener("click", () => choose(matches[Number(button.dataset.customerIndex)]));
      });
    }

    [nameInput, companyInput, emailInput, phoneInput].forEach(input => {
      input.addEventListener("input", () => {
        if (customerId.value) {
          customerId.value = "";
          hint.textContent = "Customer information changed. MG Express will match or save this customer when the job is created.";
        }
        render(input.value);
      });
      input.addEventListener("focus", () => render(input.value));
    });

    document.addEventListener("click", event => {
      if (!results.contains(event.target) && ![nameInput, companyInput, emailInput, phoneInput].includes(event.target)) {
        results.classList.remove("open");
      }
    });
  });
})();
