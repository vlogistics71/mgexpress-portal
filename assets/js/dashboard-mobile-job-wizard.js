/* MG Express dispatch job form.
   Mobile keeps the existing guided flow; desktop gets an in-place, no-scroll section layout. */
(() => {
  "use strict";

  const section = document.getElementById("createJobSection");
  const body = document.getElementById("createJobBody");
  const form = document.getElementById("createJobForm");
  const collapseButton = document.getElementById("toggleCreateJobBtn");
  const refreshButton = document.getElementById("refreshButton");
  const originalSubmit = document.getElementById("createJobSubmitBtn");
  const actions = form?.querySelector(":scope > .create-actions");
  const paymentPanel = document.getElementById("paymentPanel");
  const panels = form ? Array.from(form.children).filter(
    item => item.matches("section.form-group")
  ) : [];

  if (!section || !body || !form || !originalSubmit || !actions || panels.length !== 5) return;

  const servicePanel = panels[3];
  const serviceTitle = servicePanel.querySelector("h3");

  const steps = [
    [panels[0]],
    [panels[1], panels[2]],
    [panels[3]],
    [panels[4]]
  ];

  const addressPanels = [panels[1], panels[2]];
  addressPanels.forEach((panel, index) => {
    const heading = panel.querySelector("h3");
    const fields = panel.querySelector(".form-grid");
    if (!heading || !fields) return;

    const label = heading.textContent.trim();
    heading.classList.add("mg-address-desktop-title");

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "mg-address-toggle";
    toggle.setAttribute("aria-expanded", String(index === 0));
    toggle.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<path d="M3 7h11v10H3zM14 10h4l3 4v3h-4M6.5 17a1.5 1.5 0 1 0 3 0m6 0a1.5 1.5 0 1 0 3 0" />' +
      '<path d="M18 10v4h4" />' +
      '</svg><span class="mg-address-toggle-label"></span>' +
      '<span class="mg-address-toggle-chevron" aria-hidden="true">⌄</span>';
    toggle.querySelector(".mg-address-toggle-label").textContent = label;
    panel.classList.toggle("mg-address-open", index === 0);
    panel.insertBefore(toggle, fields);

    toggle.addEventListener("click", () => {
      const opening = !panel.classList.contains("mg-address-open");
      addressPanels.forEach(other => {
        const isOpen = other === panel && opening;
        other.classList.toggle("mg-address-open", isOpen);
        const otherToggle = other.querySelector(".mg-address-toggle");
        otherToggle?.setAttribute("aria-expanded", String(isOpen));
      });
    });
  });
  const names = ["Customer", "Pickup & Delivery", "Service & Package", "Pricing"];
  const progress = document.createElement("div");
  progress.className = "mg-wizard-progress";
  progress.setAttribute("aria-live", "polite");
  progress.innerHTML =
    '<div class="mg-wizard-progress-header"><strong id="mgWizardStepName">Customer</strong>' +
    '<span id="mgWizardStepCount">Step 1 of 4</span></div>' +
    '<div class="mg-wizard-bars" aria-hidden="true">' + names.map(() => "<i></i>").join("") + "</div>" +
    '<nav class="mg-wizard-tabs" aria-label="Job form sections">' +
    names.map((name, index) =>
      '<button type="button" class="mg-wizard-tab" data-job-section="' + index +
      '" aria-pressed="' + (index === 0 ? "true" : "false") + '">' +
      '<span class="mg-wizard-tab-number">' + (index + 1) + '</span>' + name + '</button>'
    ).join("") + "</nav>";
  body.insertBefore(progress, form);

  const footer = document.createElement("nav");
  footer.className = "mg-wizard-footer";
  footer.setAttribute("aria-label", "Create job controls");
  footer.innerHTML =
    '<button type="button" class="mg-wizard-back" aria-label="Back to previous section">← Back</button>' +
    '<button type="button" class="mg-wizard-next">Next: Pickup &amp; Delivery</button>' +
    '<div class="mg-wizard-submit-slot" hidden></div>';
  body.appendChild(footer);

  const back = footer.querySelector(".mg-wizard-back");
  const next = footer.querySelector(".mg-wizard-next");
  const submitSlot = footer.querySelector(".mg-wizard-submit-slot");
  const nameNode = progress.querySelector("#mgWizardStepName");
  const countNode = progress.querySelector("#mgWizardStepCount");
  const bars = Array.from(progress.querySelectorAll(".mg-wizard-bars i"));
  const tabs = Array.from(progress.querySelectorAll("[data-job-section]"));
  const mobile = window.matchMedia("(max-width: 650px)");
  const extraPricing = document.getElementById("pricingExtraOptions");
  if (!mobile.matches && extraPricing) extraPricing.removeAttribute("open");

  let stepIndex = 0;
  let invalidJumpScheduled = false;

  function formExpanded() {
    return document.body.classList.contains("mobile-create-expanded");
  }
  function mobileMode() { return mobile.matches && formExpanded(); }
  function desktopMode() { return !mobile.matches && formExpanded(); }

  function restoreSubmit() {
    if (actions.parentElement === submitSlot) {
      if (paymentPanel?.parentElement === form) form.insertBefore(actions, paymentPanel);
      else form.appendChild(actions);
    }
    originalSubmit.removeAttribute("form");
  }

  function moveSubmitToFooter() {
    if (actions.parentElement !== submitSlot) submitSlot.appendChild(actions);
    originalSubmit.setAttribute("form", form.id);
  }

  function render() {
    document.body.classList.toggle("desktop-create-expanded", desktopMode());
    if (!formExpanded()) {
      restoreSubmit();
      panels.forEach(item => item.classList.remove("mg-wizard-active"));
      if (serviceTitle) serviceTitle.textContent = "Service";
      return;
    }

    panels.forEach(item => item.classList.toggle("mg-wizard-active", steps[stepIndex].includes(item)));
    if (serviceTitle) serviceTitle.textContent = stepIndex === 2 ? "Service & Package" : "Service";
    nameNode.textContent = names[stepIndex];
    countNode.textContent = mobileMode()
      ? "Step " + (stepIndex + 1) + " of " + steps.length
      : "Section " + (stepIndex + 1) + " of " + steps.length;
    tabs.forEach((tab, index) => tab.setAttribute("aria-pressed", String(index === stepIndex)));
    bars.forEach((bar, index) => bar.classList.toggle("active", index <= stepIndex));

    if (mobileMode()) {
      next.hidden = stepIndex === steps.length - 1;
      submitSlot.hidden = !next.hidden;
      if (next.hidden) moveSubmitToFooter();
      else restoreSubmit();
      back.hidden = stepIndex === 0;
      back.textContent = "← Back";
      next.textContent = stepIndex < steps.length - 1 ? "Next: " + names[stepIndex + 1] : "Create Job";
      if (collapseButton) collapseButton.textContent = "Home";
    } else {
      next.hidden = true;
      submitSlot.hidden = false;
      moveSubmitToFooter();
      back.hidden = true;
      if (collapseButton) collapseButton.textContent = "Home";
    }
  }

  function showStep(index, focusField = false) {
    stepIndex = Math.max(0, Math.min(steps.length - 1, index));
    render();
    form.scrollTop = 0;
    if (focusField) {
      const first = steps[stepIndex].flatMap(panel => Array.from(panel.querySelectorAll("input:not([type=hidden]),select,textarea")))[0];
      first?.focus({preventScroll:true});
    }
  }

  function isConditionallyAvailable(field, index) {
    if (!field.willValidate || field.disabled) return false;
    let parent = field.parentElement;
    while (parent && parent !== form) {
      if (parent.hidden || parent.classList.contains("hidden")) return false;
      parent = parent.parentElement;
    }
    return true;
  }

  function firstInvalidInStep(index) {
    return steps[index].flatMap(panel => Array.from(panel.querySelectorAll("input,select,textarea"))).find(
      field => isConditionallyAvailable(field, index) && !field.checkValidity()
    );
  }

  function goNext() {
    if (!mobileMode()) return;
    const invalid = firstInvalidInStep(stepIndex);
    if (invalid) {
      invalid.focus();
      invalid.reportValidity();
      return;
    }
    showStep(stepIndex + 1);
  }

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      if (desktopMode()) showStep(Number(tab.dataset.jobSection));
    });
  });
  back.addEventListener("click", () => {
    if (mobileMode() && stepIndex > 0) showStep(stepIndex - 1);
    else collapseButton?.click();
  });
  next.addEventListener("click", goNext);

  originalSubmit.addEventListener("click", event => {
    if (!formExpanded()) return;
    for (let i = 0; i < steps.length; i++) {
      const invalid = firstInvalidInStep(i);
      if (invalid) {
        event.preventDefault();
        showStep(i);
        invalid.focus();
        invalid.reportValidity();
        return;
      }
    }
  }, true);

  form.addEventListener("invalid", event => {
    if (!formExpanded() || invalidJumpScheduled) return;
    let idx = steps.findIndex(group => group.some(item => item.contains(event.target)));
    if (idx < 0 || idx === stepIndex) return;
    event.preventDefault();
    invalidJumpScheduled = true;
    showStep(idx);
    requestAnimationFrame(() => {
      event.target.focus();
      event.target.reportValidity();
      invalidJumpScheduled = false;
    });
  }, true);

  function sync() {
    render();
    if (mobileMode()) form.scrollTop = 0;
  }

  window.addEventListener("mg-create-job-expanded", sync);
  mobile.addEventListener?.("change", sync);
  window.addEventListener("resize", sync);
  refreshButton?.addEventListener("click", () => showStep(0));
  sync();
})();
