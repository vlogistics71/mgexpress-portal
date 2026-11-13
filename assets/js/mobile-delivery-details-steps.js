/* MG Express: compact mobile job-detail steps (regular deliveries only).
   Read-only DOM navigation: existing workflow/document handlers remain untouched. */
(() => {
  "use strict";

  const modal = document.getElementById("deliveryDetailsModal");
  const panel = modal?.querySelector(".delivery-details-panel");
  const body = document.getElementById("deliveryDetailsBody");
  const title = document.getElementById("deliveryDetailsTitle");
  const closeButton = modal?.querySelector("[data-close-delivery-details]");
  if (!modal || !panel || !body || !title || !closeButton) return;

  const pages = [
    {name: "Overview", find: () => [body.querySelector(":scope > .ios-order-hero")]},
    {name: "Route", find: () => [body.querySelector(":scope > .ios-route-card")]},
    {name: "Customer", find: () => [body.querySelector(":scope > .ios-customer-card")]},
    {name: "Order", find: () => [body.querySelector(":scope > .ios-order-card")]},
    {name: "Driver", find: () => [
      body.querySelector(":scope > .ios-driver-card"),
      body.querySelector(":scope > .details-notes-card")
    ]},
    {name: "Actions", find: () => [Array.from(body.querySelectorAll(":scope > section.details-card")).find(
      el => el.querySelector("h4")?.textContent.trim().toLowerCase() === "workflow actions"
    )]},
    {name: "Documents", find: () => [Array.from(body.querySelectorAll(":scope > section.details-card")).find(
      el => el.querySelector("h4")?.textContent.trim().toLowerCase() === "documents"
    )]}
  ];

  const bar = document.createElement("div");
  bar.className = "mg-details-steps";
  bar.setAttribute("aria-label", "Job detail sections");

  const barHeading = document.createElement("div");
  barHeading.className = "mg-details-step-title";
  const heading = document.createElement("strong");
  const counter = document.createElement("span");
  barHeading.append(heading, counter);
  bar.appendChild(barHeading);

  const tabBar = document.createElement("nav");
  tabBar.className = "mg-details-nav";
  tabBar.setAttribute("aria-label", "Jump to a job detail section");
  const tabs = pages.map((page, index) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.textContent = page.name;
    tab.addEventListener("click", () => show(index));
    tabBar.appendChild(tab);
    return tab;
  });
  bar.appendChild(tabBar);
  panel.insertBefore(bar, body);

  const footer = document.createElement("div");
  footer.className = "mg-details-step-footer";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "mg-details-back";
  const next = document.createElement("button");
  next.type = "button";
  next.className = "mg-details-next";
  footer.append(back, next);
  panel.appendChild(footer);

  let active = 0;
  let selectedJob = "";
  let sectionsByPage = null;

  function show(pageIndex, options = {}) {
    if (!sectionsByPage) return;
    active = Math.min(Math.max(0, pageIndex), pages.length - 1);
    const showing = new Set(sectionsByPage[active]);
    Array.from(body.children).forEach(node => {
      if (node.matches?.("section.details-card")) {
        node.classList.toggle("mg-details-visible", showing.has(node));
      }
    });

    heading.textContent = pages[active].name;
    counter.textContent = "Section " + (active + 1) + " of " + pages.length;
    tabs.forEach((tab, index) => {
      if (index === active) tab.setAttribute("aria-current", "step");
      else tab.removeAttribute("aria-current");
    });
    back.textContent = active === 0 ? "← Close" : "← Back";
    next.textContent = active === pages.length - 1 ? "Close" : "Next: " + pages[active + 1].name;

    if (!options.keepScroll) body.scrollTop = 0;
    if (window.matchMedia("(max-width: 720px)").matches) {
      const current = tabs[active];
      // Only scroll the horizontal tab row, never the delivery details page.
      const target = current.offsetLeft - tabBar.offsetLeft -
        (tabBar.clientWidth - current.offsetWidth) / 2;
      tabBar.scrollTo({left: Math.max(0, target), behavior: "smooth"});
    }
  }

  function sync() {
    // Other delivery types have their own specialized actions/forms.
    // Avoid changing their structure, validation, or scroll behavior.
    const regular = body.querySelector(":scope > .ios-order-hero");
    if (!regular) {
      sectionsByPage = null;
      panel.classList.remove("mg-details-steps-active");
      return;
    }

    const nextGroups = pages.map(page => page.find().filter(Boolean));
    if (nextGroups.some(group => group.length === 0)) {
      sectionsByPage = null;
      panel.classList.remove("mg-details-steps-active");
      return;
    }
    const jobNumber = title.textContent.trim();
    if (selectedJob !== jobNumber) active = 0;
    selectedJob = jobNumber;
    sectionsByPage = nextGroups;
    panel.classList.add("mg-details-steps-active");
    show(active);
  }

  back.addEventListener("click", () => {
    if (active === 0) closeButton.click();
    else show(active - 1);
  });
  next.addEventListener("click", () => {
    if (active === pages.length - 1) closeButton.click();
    else show(active + 1);
  });

  // The existing deliveries script reloads this body when jobs change or
  // workflow actions complete. Rebuild the section references after each load.
  const observer = new MutationObserver(sync);
  observer.observe(body, {childList: true});
  closeButton.addEventListener("click", () => { selectedJob = ""; active = 0; });
  modal.addEventListener("click", event => {
    if (event.target === modal) { selectedJob = ""; active = 0; }
  });

  sync();
})();
