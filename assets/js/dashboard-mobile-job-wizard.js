/* MG Express dispatch: compact mobile Create Job steps.
   Reuses the real form and its existing validation, pricing and submit handlers. */
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

  if (!section || !body || !form || !originalSubmit || !actions || panels.length !== 5) {
    return;
  }

  // The service card has a lot of fields. On phones give its package
  // details their own step without moving any fields or changing desktop.
  const servicePanel = panels[3];
  const serviceTitle = servicePanel.querySelector("h3");
  const serviceGrid = servicePanel.querySelector(":scope > .form-grid");
  let packageFieldsStarted = false;
  Array.from(serviceGrid?.children || []).forEach(child => {
    if (child.contains(document.getElementById("piece_count"))) packageFieldsStarted = true;
    if (child.classList.contains("field")) {
      child.classList.add(packageFieldsStarted ? "mg-wizard-package-field" : "mg-wizard-service-field");
    }
  });

  const steps = [panels[0], panels[1], panels[2], panels[3], panels[3], panels[4]];
  const names = ["Customer", "Pickup", "Delivery", "Service", "Package", "Pricing"];
  const progress = document.createElement("div");
  progress.className = "mg-wizard-progress";
  progress.setAttribute("aria-live", "polite");
  progress.innerHTML =
    '<div class="mg-wizard-progress-header"><strong id="mgWizardStepName">Customer</strong>' +
    '<span id="mgWizardStepCount">Step 1 of 6</span></div>' +
    '<div class="mg-wizard-bars" aria-hidden="true">' +
    names.map(() => "<i></i>").join("") + "</div>";
  body.insertBefore(progress, form);

  const footer = document.createElement("nav");
  footer.className = "mg-wizard-footer";
  footer.setAttribute("aria-label", "Create job steps");
  footer.innerHTML =
    '<button type="button" class="mg-wizard-back">Dashboard</button>' +
    '<button type="button" class="mg-wizard-next">Next: Pickup</button>' +
    '<div class="mg-wizard-submit-slot" hidden></div>';
  body.appendChild(footer);

  const back = footer.querySelector(".mg-wizard-back");
  const next = footer.querySelector(".mg-wizard-next");
  const submitSlot = footer.querySelector(".mg-wizard-submit-slot");
  const nameNode = progress.querySelector("#mgWizardStepName");
  const countNode = progress.querySelector("#mgWizardStepCount");
  const bars = Array.from(progress.querySelectorAll(".mg-wizard-bars i"));
  const mobile = window.matchMedia("(max-width: 650px)");
  let stepIndex = 0;
  let invalidJumpScheduled = false;

  function wizardVisible() {
    return mobile.matches && document.body.classList.contains("mobile-create-expanded");
  }

  function restoreSubmit() {
    if (actions.parentElement === submitSlot) {
      if (paymentPanel?.parentElement === form) {
        form.insertBefore(actions, paymentPanel);
      } else {
        form.appendChild(actions);
      }
    }
    originalSubmit.removeAttribute("form");
  }

  function moveSubmitToFooter() {
    if (actions.parentElement !== submitSlot) submitSlot.appendChild(actions);
    // The submit button remains associated with the original form, even outside it.
    originalSubmit.setAttribute("form", form.id);
  }

  function render() {
    if (!wizardVisible()) {
      restoreSubmit();
      panels.forEach(item => item.classList.remove("mg-wizard-active"));
      servicePanel.classList.remove("mg-wizard-service-mode", "mg-wizard-package-mode");
      if (serviceTitle) serviceTitle.textContent = "Service";
      return;
    }

    panels.forEach(item => item.classList.toggle("mg-wizard-active", item === steps[stepIndex]));
    servicePanel.classList.toggle("mg-wizard-service-mode", stepIndex === 3);
    servicePanel.classList.toggle("mg-wizard-package-mode", stepIndex === 4);
    if (serviceTitle) serviceTitle.textContent = stepIndex === 4 ? "Package" : "Service";
    nameNode.textContent = names[stepIndex];
    countNode.textContent = "Step " + (stepIndex + 1) + " of " + steps.length;
    bars.forEach((bar, index) => {
      bar.classList.toggle("active", index <= stepIndex);
    });
    back.textContent = stepIndex === 0 ? "← Board" : "← Back";
    const last = stepIndex === steps.length - 1;
    next.hidden = last;
    submitSlot.hidden = !last;
    if (last) moveSubmitToFooter();
    else restoreSubmit();
    if (collapseButton) collapseButton.textContent = "← Board";
  }

  function showStep(index, focusField = false) {
    stepIndex = Math.max(0, Math.min(steps.length - 1, index));
    render();
    form.scrollTop = 0;
    if (focusField) {
      const first = steps[stepIndex].querySelector("input:not([type=hidden]),select,textarea");
      first?.focus({preventScroll:true});
    }
  }

  function isConditionallyAvailable(field, index) {
    if (!field.willValidate || field.disabled) return false;
    if (index === 3 && field.closest(".mg-wizard-package-field")) return false;
    if (index === 4 && field.closest(".mg-wizard-service-field")) return false;
    let parent = field.parentElement;
    while (parent && parent !== form) {
      if (parent.hidden || parent.classList.contains("hidden")) return false;
      parent = parent.parentElement;
    }
    return true;
  }

  function firstInvalidInStep(index) {
    return Array.from(steps[index].querySelectorAll("input,select,textarea")).find(
      field => isConditionallyAvailable(field, index) && !field.checkValidity()
    );
  }

  function goNext() {
    if (!wizardVisible()) return;
    const invalid = firstInvalidInStep(stepIndex);
    if (invalid) {
      invalid.focus();
      invalid.reportValidity();
      return;
    }
    showStep(stepIndex + 1);
  }

  back.addEventListener("click", () => {
    if (stepIndex === 0) collapseButton?.click();
    else showStep(stepIndex - 1);
  });
  next.addEventListener("click", goNext);

  // Catch missing required fields in earlier steps before native submission.
  originalSubmit.addEventListener("click", event => {
    if (!wizardVisible()) return;
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

  // If browser native validation is triggered by keyboard or Enter,
  // reveal the owning step so a hidden invalid input is focusable.
  form.addEventListener("invalid", event => {
    if (!wizardVisible() || invalidJumpScheduled) return;
    let idx = steps.findIndex(item => item.contains(event.target));
    if (idx === 3 && event.target.closest(".mg-wizard-package-field")) idx = 4;
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
    if (wizardVisible()) form.scrollTop = 0;
  }

  window.addEventListener("mg-create-job-expanded", sync);
  mobile.addEventListener?.("change", sync);
  window.addEventListener("resize", sync);
  refreshButton?.addEventListener("click", () => showStep(0));

  sync();
})();
