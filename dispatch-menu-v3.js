<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1"
  >

  <title>MG Express Dispatch Dashboard</title>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

  <style>
    * {
      box-sizing: border-box;
    }

    :root {
      --dark-green: #064f3b;
      --green: #087455;
      --light-green: #e7f5ef;
      --coral: #ff665c;
      --background: #f3f8f6;
      --white: #ffffff;
      --ink: #17221e;
      --muted: #68756f;
      --line: #dfe8e4;
      --danger: #9b2929;
      --danger-bg: #fff0f0;
      --warning: #946000;
      --warning-bg: #fff5d8;
      --blue: #245d9c;
      --blue-bg: #eaf3ff;
    }

    body {
      margin: 0;
      font-family: Arial, Helvetica, sans-serif;
      background: var(--background);
      color: var(--ink);
    }

    button,
    input,
    select,
    textarea {
      font: inherit;
    }

    .hidden {
      display: none !important;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 50;
      padding: 18px 20px;
      background: var(--dark-green);
      color: white;
    }

    .topbar-inner {
      width: min(1000px, 100%);
      margin: auto;
    }

    .brand {
      font-size: 23px;
      font-weight: 900;
      line-height: 1.08;
    }

    .brand span {
      color: var(--coral);
    }

    .staff-email {
      margin-top: 7px;
      font-size: 13px;
      opacity: .82;
      overflow-wrap: anywhere;
    }

    .container {
      width: min(1000px, 100%);
      margin: auto;
      padding: 28px 18px 75px;
    }

    .eyebrow {
      margin-bottom: 6px;
      color: var(--muted);
      font-size: 17px;
    }

    h1 {
      margin: 0;
      font-size: clamp(40px, 8vw, 56px);
      line-height: 1.03;
    }

    .new-job-button {
      width: 100%;
      min-height: 57px;
      margin-top: 25px;
      border: 0;
      border-radius: 16px;
      background: var(--green);
      color: white;
      font-weight: 900;
      cursor: pointer;
    }

    .quick-links {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-top: 18px;
    }

    .quick-link {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 70px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 17px;
      background: white;
      color: var(--dark-green);
      text-align: center;
      text-decoration: none;
      font-weight: 900;
      box-shadow: 0 6px 20px rgba(0, 0, 0, .035);
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-top: 27px;
    }

    .stat-card {
      padding: 19px;
      border: 1px solid var(--line);
      border-radius: 20px;
      background: white;
      box-shadow: 0 7px 22px rgba(0, 0, 0, .04);
    }

    .stat-number {
      color: var(--green);
      font-size: 34px;
      font-weight: 900;
    }

    .stat-label {
      margin-top: 8px;
      color: var(--muted);
      font-size: 14px;
    }

    .panel {
      margin-top: 25px;
      padding: 20px;
      border: 1px solid var(--line);
      border-radius: 22px;
      background: white;
      box-shadow: 0 8px 27px rgba(0, 0, 0, .04);
    }

    .panel-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 15px;
      margin-bottom: 17px;
    }

    .panel-heading h2 {
      margin: 0;
      font-size: 29px;
    }

    .close-button,
    .refresh-button {
      min-height: 48px;
      padding: 11px 17px;
      border: 1px solid var(--line);
      border-radius: 13px;
      background: white;
      color: var(--dark-green);
      font-weight: 900;
      cursor: pointer;
    }

    .form-section-title {
      grid-column: 1 / -1;
      margin: 10px 0 0;
      padding: 13px 15px;
      border-radius: 14px;
      background: #f0f7f4;
      color: var(--dark-green);
      font-size: 16px;
      font-weight: 900;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 15px;
    }

    .field {
      min-width: 0;
    }

    .field.full {
      grid-column: 1 / -1;
    }

    .field label {
      display: block;
      margin-bottom: 7px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .04em;
      text-transform: uppercase;
    }

    .field input,
    .field select,
    .field textarea {
      width: 100%;
      min-height: 50px;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 13px;
      background: white;
      color: var(--ink);
    }

    .field textarea {
      min-height: 105px;
      resize: vertical;
    }

    .money-note {
      margin-top: 7px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }

    .billing-summary {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      padding: 16px;
      border-radius: 16px;
      background: #f7faf9;
    }

    .summary-box {
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 13px;
      background: white;
    }

    .summary-label {
      color: var(--muted);
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .summary-value {
      margin-top: 6px;
      color: var(--green);
      font-size: 21px;
      font-weight: 900;
    }

    .summary-value.profit {
      color: var(--dark-green);
    }

    .form-actions {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 12px;
      margin-top: 18px;
    }

    .save-button,
    .invoice-button {
      min-height: 55px;
      border: 0;
      border-radius: 14px;
      color: white;
      font-weight: 900;
      cursor: pointer;
    }

    .save-button {
      background: var(--green);
    }

    .invoice-button {
      background: var(--dark-green);
    }

    .message {
      margin-top: 14px;
      padding: 14px;
      border-radius: 13px;
      line-height: 1.5;
    }

    .message.success {
      background: var(--light-green);
      color: var(--dark-green);
    }

    .message.error {
      background: var(--danger-bg);
      color: var(--danger);
    }

    .search-box {
      width: 100%;
      min-height: 50px;
      margin-bottom: 15px;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 13px;
    }

    .jobs-list {
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 18px;
    }

    .job-row {
      display: grid;
      grid-template-columns:
        minmax(125px, .7fr)
        minmax(0, 1.2fr)
        minmax(120px, .65fr)
        minmax(120px, .65fr)
        auto;
      gap: 14px;
      align-items: center;
      min-height: 85px;
      padding: 15px 17px;
      border-bottom: 1px solid var(--line);
      color: inherit;
      text-decoration: none;
    }

    .job-row:last-child {
      border-bottom: 0;
    }

    .job-number {
      color: var(--dark-green);
      font-size: 18px;
      font-weight: 900;
      overflow-wrap: anywhere;
    }

    .customer-name {
      font-size: 16px;
      font-weight: 800;
      overflow-wrap: anywhere;
    }

    .customer-email {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .status-pill {
      display: inline-flex;
      width: fit-content;
      padding: 8px 11px;
      border-radius: 999px;
      background: var(--light-green);
      color: var(--green);
      font-size: 12px;
      font-weight: 900;
    }

    .status-new {
      background: var(--blue-bg);
      color: var(--blue);
    }

    .status-waiting_payment {
      background: var(--warning-bg);
      color: var(--warning);
    }

    .meta-label {
      display: block;
      margin-bottom: 4px;
      color: var(--muted);
      font-size: 10px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .meta-value {
      font-size: 13px;
      font-weight: 800;
    }

    .arrow {
      color: var(--green);
      font-size: 26px;
      font-weight: 900;
    }

    .empty {
      padding: 28px 20px;
      border-radius: 17px;
      background: #f7faf9;
      color: var(--muted);
      text-align: center;
    }

    @media (max-width: 760px) {
      .quick-links,
      .stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .form-grid,
      .billing-summary,
      .form-actions {
        grid-template-columns: 1fr;
      }

      .field.full,
      .form-section-title,
      .billing-summary {
        grid-column: auto;
      }

      .job-row {
        grid-template-columns: minmax(0, 1fr) auto;
        min-height: 120px;
      }

      .job-main,
      .customer-block,
      .status-block,
      .driver-block {
        grid-column: 1 / 2;
      }

      .arrow {
        grid-column: 2 / 3;
        grid-row: 1 / 5;
        align-self: center;
      }
    }

    @media (max-width: 430px) {
      .quick-links,
      .stats {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>

<body>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">
        MG <span>EXPRESS</span> DISPATCH
      </div>

      <div
        class="staff-email"
        id="staffEmail"
      ></div>
    </div>
  </header>

  <main class="container">
    <div class="eyebrow">
      Dispatch control center
    </div>

    <h1>Dashboard</h1>

    <button
      class="new-job-button"
      id="openJobFormButton"
      type="button"
    >
      + New Job
    </button>

    <section class="quick-links">
      <a
        class="quick-link"
        href="https://portal.migenteexpress.com/jobs.html"
      >
        Active Jobs
      </a>

      <a
        class="quick-link"
        href="https://portal.migenteexpress.com/history.html"
      >
        Job History
      </a>

      <a
        class="quick-link"
        href="https://portal.migenteexpress.com/customer.html"
      >
        Customers
      </a>

      <a
        class="quick-link"
        href="https://portal.migenteexpress.com/driver.html"
      >
        Drivers
      </a>

      <a
        class="quick-link"
        href="https://portal.migenteexpress.com/payroll.html"
      >
        Payroll
      </a>

      <a
        class="quick-link"
        href="https://portal.migenteexpress.com/invoices.html"
      >
        Invoices
      </a>

      <a
        class="quick-link"
        href="https://portal.migenteexpress.com/reports.html"
      >
        Reports
      </a>
    </section>

    <section class="stats">
      <div class="stat-card">
        <div class="stat-number" id="countNew">0</div>
        <div class="stat-label">New</div>
      </div>

      <div class="stat-card">
        <div class="stat-number" id="countWaiting">0</div>
        <div class="stat-label">Waiting Payment</div>
      </div>

      <div class="stat-card">
        <div class="stat-number" id="countReady">0</div>
        <div class="stat-label">Paid / Ready</div>
      </div>

      <div class="stat-card">
        <div class="stat-number" id="countTransit">0</div>
        <div class="stat-label">In Transit</div>
      </div>
    </section>

    <section
      class="panel hidden"
      id="jobFormPanel"
    >
      <div class="panel-heading">
        <h2>Create New Job</h2>

        <button
          class="close-button"
          id="closeJobFormButton"
          type="button"
        >
          Close
        </button>
      </div>

      <form id="jobForm">
        <div class="form-grid">
          <div class="form-section-title">
            Customer Information
          </div>

          <div class="field">
            <label for="customerName">
              Customer Name
            </label>

            <input
              id="customerName"
              name="customer_name"
              required
            >
          </div>

          <div class="field">
            <label for="customerPhone">
              Customer Phone
            </label>

            <input
              id="customerPhone"
              name="customer_phone"
              type="tel"
              placeholder="303-555-1234"
            >
          </div>

          <div class="field full">
            <label for="customerEmail">
              Customer Email
            </label>

            <input
              id="customerEmail"
              name="customer_email"
              type="email"
            >
          </div>

          <div class="form-section-title">
            Route and Delivery
          </div>

          <div class="field full">
            <label for="pickupAddress">
              Pickup Address
            </label>

            <input
              id="pickupAddress"
              name="pickup_address"
              required
            >
          </div>

          <div class="field full">
            <label for="deliveryAddress">
              Delivery Address
            </label>

            <input
              id="deliveryAddress"
              name="delivery_address"
              required
            >
          </div>

          <div class="field">
            <label for="vehicleType">
              Vehicle Type
            </label>

            <select
              id="vehicleType"
              name="vehicle_type"
            >
              <option value="Sedan">Sedan</option>

              <option value="Small Cargo Van">
                Small Cargo Van
              </option>

              <option value="Sprinter Van">
                Sprinter Van
              </option>
            </select>
          </div>

          <div class="field">
            <label for="deliverySpeed">
              Delivery Speed
            </label>

            <select
              id="deliverySpeed"
              name="delivery_speed"
            >
              <option value="2 Hour">
                2 Hour
              </option>

              <option value="3 Hour">
                3 Hour
              </option>

              <option value="4 Hour">
                4 Hour
              </option>

              <option value="5 Hour">
                5 Hour
              </option>

              <option value="6 Hour">
                6 Hour
              </option>

              <option value="Next Day">
                Next Day
              </option>
            </select>
          </div>

          <div class="field">
            <label for="packageType">
              Package Description
            </label>

            <input
              id="packageType"
              name="package_type"
              placeholder="Example: 3 medical boxes"
            >
          </div>

          <div class="field">
            <label for="deliveryMethod">
              Delivery Method
            </label>

            <select
              id="deliveryMethod"
              name="delivery_method"
            >
              <option value="Hand Delivery">
                Hand Delivery
              </option>

              <option value="Leave at Door">
                Leave at Door
              </option>

              <option value="Receiving Department">
                Receiving Department
              </option>
            </select>
          </div>

          <div class="field">
            <label for="driverSelect">
              Assigned Driver
            </label>

            <select
              id="driverSelect"
              name="assigned_driver_id"
            >
              <option value="">
                Unassigned
              </option>
            </select>
          </div>

          <div class="field full">
            <label for="specialInstructions">
              Delivery Instructions
            </label>

            <textarea
              id="specialInstructions"
              name="special_instructions"
            ></textarea>
          </div>

          <div class="form-section-title">
            Customer Billing and Driver Pay
          </div>

          <div class="field">
            <label for="customerCharge">
              Customer Charge
            </label>

            <input
              id="customerCharge"
              name="customer_charge"
              type="number"
              min="0"
              step="0.01"
              value="0.00"
            >

            <div class="money-note">
              This amount appears on the customer invoice.
            </div>
          </div>

          <div class="field">
            <label for="driverPay">
              Driver Pay
            </label>

            <input
              id="driverPay"
              name="driver_pay"
              type="number"
              min="0"
              step="0.01"
              value="0.00"
            >

            <div class="money-note">
              This amount appears only in Payroll.
            </div>
          </div>

          <div class="billing-summary">
            <div class="summary-box">
              <div class="summary-label">
                Customer Charge
              </div>

              <div
                class="summary-value"
                id="chargePreview"
              >
                $0.00
              </div>
            </div>

            <div class="summary-box">
              <div class="summary-label">
                Driver Pay
              </div>

              <div
                class="summary-value"
                id="payPreview"
              >
                $0.00
              </div>
            </div>

            <div class="summary-box">
              <div class="summary-label">
                Estimated Gross Profit
              </div>

              <div
                class="summary-value profit"
                id="profitPreview"
              >
                $0.00
              </div>
            </div>
          </div>

          <div class="form-section-title">
            Invoice Options
          </div>

          <div class="field">
            <label for="invoiceDeliveryMethod">
              Invoice Delivery
            </label>

            <select
              id="invoiceDeliveryMethod"
              name="invoice_delivery_method"
            >
              <option value="none">
                Do Not Send Yet
              </option>

              <option value="email">
                Email
              </option>

              <option value="text">
                Text Message
              </option>

              <option value="both">
                Email and Text
              </option>
            </select>
          </div>

          <div class="field">
            <label for="invoiceDueDate">
              Invoice Due Date
            </label>

            <input
              id="invoiceDueDate"
              name="invoice_due_date"
              type="date"
            >
          </div>

          <div class="field full">
            <label for="billingNotes">
              Billing Notes
            </label>

            <textarea
              id="billingNotes"
              name="billing_notes"
              placeholder="Example: Payment due within 30 days."
            ></textarea>
          </div>
        </div>

        <div class="form-actions">
          <button
            class="save-button"
            id="createJobOnlyButton"
            type="submit"
            value="job-only"
            name="submit_action"
          >
            Create Job Only
          </button>

          <button
            class="invoice-button"
            id="createInvoiceButton"
            type="submit"
            value="prepare-invoice"
            name="submit_action"
          >
            Create Job & Prepare Invoice
          </button>

          <button
            class="close-button"
            id="cancelJobButton"
            type="button"
          >
            Cancel
          </button>
        </div>

        <div
          class="message hidden"
          id="formMessage"
        ></div>
      </form>
    </section>

    <section class="panel">
      <div class="panel-heading">
        <h2>Quotes & Jobs</h2>

        <button
          class="refresh-button"
          id="refreshButton"
          type="button"
        >
          Refresh
        </button>
      </div>

      <input
        class="search-box"
        id="searchInput"
        type="search"
        placeholder="Search job number, customer or driver"
      >

      <div id="jobsBox">
        <div class="empty">
          Loading active jobs...
        </div>
      </div>
    </section>
  </main>

  <script>
    const client = supabase.createClient(
      "https://dczlucwfjayymlwbzzdi.supabase.co",
      "sb_publishable_kcv_a78ZyUxMo2neKUANdw_XN7eAMpI"
    );

    window.mgDispatchClient = client;

    const PORTAL_BASE =
      "https://portal.migenteexpress.com";

    const jobsBox =
      document.getElementById("jobsBox");

    const jobForm =
      document.getElementById("jobForm");

    const jobFormPanel =
      document.getElementById("jobFormPanel");

    const formMessage =
      document.getElementById("formMessage");

    const customerChargeInput =
      document.getElementById("customerCharge");

    const driverPayInput =
      document.getElementById("driverPay");

    let jobs = [];
    let drivers = [];
    let driversById = {};

    function escapeHtml(value) {
      const div = document.createElement("div");
      div.textContent = value ?? "";
      return div.innerHTML;
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

    function cleanStatus(value) {
      return String(value || "new")
        .trim()
        .toLowerCase();
    }

    function statusLabel(value) {
      const labels = {
        new: "New",
        waiting_payment: "Waiting Payment",
        paid: "Paid",
        ready: "Ready",
        in_transit: "In Transit"
      };

      return labels[cleanStatus(value)] ||
        String(value || "Open")
          .replaceAll("_", " ");
    }

    function setMessage(message, type) {
      formMessage.textContent = message || "";

      formMessage.className =
        message
          ? `message ${type || ""}`
          : "message hidden";
    }

    function updateMoneyPreview() {
      const charge =
        Number(customerChargeInput.value || 0);

      const pay =
        Number(driverPayInput.value || 0);

      document
        .getElementById("chargePreview")
        .textContent = money(charge);

      document
        .getElementById("payPreview")
        .textContent = money(pay);

      document
        .getElementById("profitPreview")
        .textContent =
          money(charge - pay);
    }

    function setDefaultDueDate() {
      const date = new Date();
      date.setDate(date.getDate() + 30);

      document
        .getElementById("invoiceDueDate")
        .value =
          date.toISOString().slice(0, 10);
    }

    function openJobForm() {
      jobFormPanel.classList.remove("hidden");
      setMessage("", "");
      setDefaultDueDate();

      jobFormPanel.scrollIntoView({
        behavior: "smooth"
      });
    }

    function closeJobForm() {
      jobFormPanel.classList.add("hidden");
      setMessage("", "");
    }

    function datePrefix() {
      const now = new Date();

      const year =
        String(now.getFullYear()).slice(-2);

      const month =
        String(now.getMonth() + 1)
          .padStart(2, "0");

      const day =
        String(now.getDate())
          .padStart(2, "0");

      return `MG-${year}${month}${day}-`;
    }

    async function createJobNumber() {
      const prefix = datePrefix();

      const result = await client
        .from("quotes")
        .select("job_number")
        .like("job_number", `${prefix}%`);

      if (result.error) {
        throw result.error;
      }

      let highest = 0;

      (result.data || []).forEach(job => {
        const ending =
          String(job.job_number || "")
            .slice(prefix.length);

        const number = Number(ending);

        if (
          Number.isInteger(number) &&
          number > highest
        ) {
          highest = number;
        }
      });

      return (
        prefix +
        String(highest + 1)
          .padStart(3, "0")
      );
    }

    function createInvoiceNumber(jobNumber) {
      return (
        "INV-" +
        String(jobNumber || "")
          .replace(/[^a-z0-9]/gi, "")
          .toUpperCase()
      );
    }

    async function verifyDispatchUser() {
      const sessionResult =
        await client.auth.getSession();

      const session =
        sessionResult.data.session;

      if (!session) {
        location.replace("/index.html");
        return null;
      }

      document
        .getElementById("staffEmail")
        .textContent =
          session.user.email || "";

      const profileResult = await client
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .maybeSingle();

      if (
        profileResult.error ||
        !profileResult.data
      ) {
        throw new Error(
          profileResult.error?.message ||
          "No MG Express profile was found."
        );
      }

      const role =
        String(
          profileResult.data.role || ""
        ).toLowerCase();

      if (
        ![
          "admin",
          "staff",
          "dispatcher"
        ].includes(role)
      ) {
        throw new Error(
          "This account does not have dispatch access."
        );
      }

      window.dispatchEvent(
        new CustomEvent(
          "mg-dispatch-ready",
          {
            detail: {
              email: session.user.email
            }
          }
        )
      );

      return session;
    }

    async function loadDrivers() {
      const result = await client
        .from("drivers")
        .select("id,full_name,email,active")
        .order("full_name", {
          ascending: true
        });

      if (result.error) {
        throw result.error;
      }

      drivers = result.data || [];
      driversById = {};

      drivers.forEach(driver => {
        driversById[String(driver.id)] =
          driver.full_name ||
          driver.email ||
          "Driver";
      });

      document
        .getElementById("driverSelect")
        .innerHTML = `
          <option value="">Unassigned</option>

          ${drivers
            .filter(driver =>
              driver.active !== false
            )
            .map(driver => `
              <option value="${escapeHtml(driver.id)}">
                ${escapeHtml(
                  driver.full_name ||
                  driver.email ||
                  "Driver"
                )}
              </option>
            `)
            .join("")}
        `;
    }

    async function loadJobs() {
      const result = await client
        .from("quotes")
        .select("*")
        .order("created_at", {
          ascending: false
        });

      if (result.error) {
        throw result.error;
      }

      jobs = (result.data || []).filter(job =>
        ![
          "delivered",
          "cancelled",
          "canceled"
        ].includes(cleanStatus(job.status))
      );

      updateCounts();
      renderJobs();
    }

    function updateCounts() {
      const count = status =>
        jobs.filter(job =>
          cleanStatus(job.status) === status
        ).length;

      document
        .getElementById("countNew")
        .textContent = count("new");

      document
        .getElementById("countWaiting")
        .textContent =
          count("waiting_payment");

      document
        .getElementById("countReady")
        .textContent =
          count("paid") + count("ready");

      document
        .getElementById("countTransit")
        .textContent =
          count("in_transit");
    }

    function renderJobs() {
      const search =
        document
          .getElementById("searchInput")
          .value
          .trim()
          .toLowerCase();

      const visible = jobs.filter(job => {
        if (!search) {
          return true;
        }

        const driverName =
          driversById[
            String(
              job.assigned_driver_id || ""
            )
          ] || "";

        return [
          job.job_number,
          job.customer_name,
          job.customer_email,
          driverName
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(search);
      });

      if (!visible.length) {
        jobsBox.className = "";

        jobsBox.innerHTML = `
          <div class="empty">
            No active jobs match your search.
          </div>
        `;

        return;
      }

      jobsBox.className = "jobs-list";

      jobsBox.innerHTML =
        visible.map(job => {
          const driverName =
            driversById[
              String(
                job.assigned_driver_id || ""
              )
            ] || "Unassigned";

          const url =
            `${PORTAL_BASE}/job.html?id=` +
            encodeURIComponent(job.id);

          return `
            <a
              class="job-row"
              href="${escapeHtml(url)}"
            >
              <div class="job-main">
                <div class="job-number">
                  ${escapeHtml(
                    job.job_number || "Job"
                  )}
                </div>
              </div>

              <div class="customer-block">
                <div class="customer-name">
                  ${escapeHtml(
                    job.customer_name ||
                    "Customer"
                  )}
                </div>

                <div class="customer-email">
                  ${escapeHtml(
                    job.customer_email ||
                    "No email recorded"
                  )}
                </div>
              </div>

              <div class="status-block">
                <div
                  class="status-pill status-${escapeHtml(
                    cleanStatus(job.status)
                  )}"
                >
                  ${escapeHtml(
                    statusLabel(job.status)
                  )}
                </div>
              </div>

              <div class="driver-block">
                <span class="meta-label">
                  Driver
                </span>

                <div class="meta-value">
                  ${escapeHtml(driverName)}
                </div>
              </div>

              <div class="arrow">›</div>
            </a>
          `;
        }).join("");
    }

    async function createInvoice(
      job,
      payload
    ) {
      const invoicePayload = {
        job_id: job.id,

        invoice_number:
          createInvoiceNumber(
            job.job_number
          ),

        customer_name:
          payload.customer_name,

        customer_email:
          payload.customer_email,

        amount:
          payload.customer_charge,

        payment_status: "unpaid",

        due_date:
          payload.invoice_due_date ||
          null
      };

      const result = await client
        .from("invoices")
        .upsert(
          invoicePayload,
          {
            onConflict: "job_id"
          }
        )
        .select("*")
        .maybeSingle();

      if (result.error) {
        throw result.error;
      }

      return result.data;
    }

    async function submitJob(event) {
      event.preventDefault();

      const clickedButton =
        event.submitter;

      const action =
        clickedButton?.value ||
        "job-only";

      const buttons = [
        document.getElementById(
          "createJobOnlyButton"
        ),
        document.getElementById(
          "createInvoiceButton"
        )
      ];

      buttons.forEach(button => {
        button.disabled = true;
      });

      setMessage(
        "Creating job...",
        "success"
      );

      try {
        const formData =
          new FormData(jobForm);

        const jobNumber =
          await createJobNumber();

        const assignedDriver =
          String(
            formData.get(
              "assigned_driver_id"
            ) || ""
          ).trim();

        const customerCharge =
          Number(
            formData.get(
              "customer_charge"
            ) || 0
          );

        const driverPay =
          Number(
            formData.get(
              "driver_pay"
            ) || 0
          );

        const payload = {
          job_number: jobNumber,

          customer_name:
            String(
              formData.get(
                "customer_name"
              ) || ""
            ).trim(),

          customer_phone:
            String(
              formData.get(
                "customer_phone"
              ) || ""
            ).trim(),

          customer_email:
            String(
              formData.get(
                "customer_email"
              ) || ""
            ).trim(),

          pickup_address:
            String(
              formData.get(
                "pickup_address"
              ) || ""
            ).trim(),

          delivery_address:
            String(
              formData.get(
                "delivery_address"
              ) || ""
            ).trim(),

          vehicle_type:
            String(
              formData.get(
                "vehicle_type"
              ) || ""
            ).trim(),

          delivery_speed:
            String(
              formData.get(
                "delivery_speed"
              ) || ""
            ).trim(),

          package_type:
            String(
              formData.get(
                "package_type"
              ) || ""
            ).trim(),

          delivery_method:
            String(
              formData.get(
                "delivery_method"
              ) || ""
            ).trim(),

          special_instructions:
            String(
              formData.get(
                "special_instructions"
              ) || ""
            ).trim(),

          customer_charge:
            customerCharge,

          driver_pay:
            driverPay,

          assigned_driver_id:
            assignedDriver || null,

          invoice_delivery_method:
            String(
              formData.get(
                "invoice_delivery_method"
              ) || "none"
            ),

          invoice_due_date:
            formData.get(
              "invoice_due_date"
            ) || null,

          billing_notes:
            String(
              formData.get(
                "billing_notes"
              ) || ""
            ).trim(),

          status:
            assignedDriver
              ? "ready"
              : "new"
        };

        const result = await client
          .from("quotes")
          .insert(payload)
          .select("*")
          .maybeSingle();

        if (result.error) {
          throw result.error;
        }

        const createdJob =
          result.data;

        if (
          action === "prepare-invoice"
        ) {
          await createInvoice(
            createdJob,
            payload
          );

          setMessage(
            `${jobNumber} and its invoice were created successfully.`,
            "success"
          );

          setTimeout(() => {
            location.href =
              `${PORTAL_BASE}/invoices.html`;
          }, 1200);

          return;
        }

        setMessage(
          `${jobNumber} was created successfully.`,
          "success"
        );

        jobForm.reset();
        setDefaultDueDate();
        updateMoneyPreview();
        await loadJobs();

        setTimeout(() => {
          closeJobForm();
        }, 1200);
      } catch (error) {
        setMessage(
          error.message ||
          "Unable to create this job.",
          "error"
        );
      } finally {
        buttons.forEach(button => {
          button.disabled = false;
        });
      }
    }

    customerChargeInput.addEventListener(
      "input",
      updateMoneyPreview
    );

    driverPayInput.addEventListener(
      "input",
      updateMoneyPreview
    );

    document
      .getElementById("openJobFormButton")
      .addEventListener(
        "click",
        openJobForm
      );

    document
      .getElementById("closeJobFormButton")
      .addEventListener(
        "click",
        closeJobForm
      );

    document
      .getElementById("cancelJobButton")
      .addEventListener(
        "click",
        closeJobForm
      );

    document
      .getElementById("searchInput")
      .addEventListener(
        "input",
        renderJobs
      );

    document
      .getElementById("refreshButton")
      .addEventListener(
        "click",
        async function () {
          this.disabled = true;
          this.textContent =
            "Refreshing...";

          try {
            await loadDrivers();
            await loadJobs();
          } finally {
            this.disabled = false;
            this.textContent = "Refresh";
          }
        }
      );

    jobForm.addEventListener(
      "submit",
      submitJob
    );

    (async function startPage() {
      try {
        const session =
          await verifyDispatchUser();

        if (!session) {
          return;
        }

        await loadDrivers();
        await loadJobs();
        setDefaultDueDate();
        updateMoneyPreview();
      } catch (error) {
        jobsBox.innerHTML = `
          <div class="message error">
            ${escapeHtml(
              error.message ||
              "Unable to load dashboard."
            )}
          </div>
        `;
      }
    })();
  </script>

  <script src="/dispatch-menu-v3.js"></script>
</body>
</html>
