/* MG Express: touch pull-to-refresh for single-screen mobile workspaces.
   Native page scrolling is locked by the compact layout, so this restores a
   guarded, visible swipe-to-refresh action without modifying any job actions. */
(() => {
  "use strict";

  if (window.__mgPullToRefreshReady) return;
  window.__mgPullToRefreshReady = true;

  const mobile = window.matchMedia("(max-width: 720px)");
  const LIMIT = 94;
  const SLOP = 12;
  const blockedElements = [
    "input", "textarea", "select", "button", "a", "iframe",
    "[contenteditable]", "[role='button']",
    "form", ".gm-style", ".mapboxgl-map", ".leaflet-container",
    "#dispatchPickupMap", ".pickup-map-panel.map-expanded",
    ".mg-side-menu", ".mg-menu-overlay",
    ".dispatch-side-menu", ".dispatch-menu-overlay",
    ".modal-backdrop", ".job-modal", ".route-modal"
  ].join(",");
  const overlayOpen = [
    ".modal-backdrop.open", ".job-modal:not([hidden])",
    ".route-modal:not([hidden])", ".mg-side-menu.open",
    ".dispatch-side-menu.open"
  ].join(",");

  const style = document.createElement("style");
  style.textContent = `
    .mg-pull-refresh {
      position:fixed;top:12px;left:50%;z-index:950;
      display:none;align-items:center;justify-content:center;
      gap:8px;max-width:calc(100vw - 32px);
      padding:10px 16px;border-radius:999px;
      background:#fff;color:#064f3b;
      font:800 13px/1.2 Arial,Helvetica,sans-serif;
      box-shadow:0 8px 28px rgba(0,0,0,.2);
      border:1px solid #d8e7de;
      pointer-events:none;
      transform:translate(-50%,0);
      white-space:nowrap;
    }
    .mg-pull-refresh.visible {display:flex}
    .mg-pull-refresh .mg-pull-symbol {font-size:19px;line-height:1}
    @media (prefers-reduced-motion:reduce) {
      .mg-pull-refresh {transition:none}
    }
  `;
  document.head.appendChild(style);

  const indicator = document.createElement("div");
  indicator.className = "mg-pull-refresh";
  indicator.setAttribute("role", "status");
  indicator.setAttribute("aria-live", "polite");
  indicator.innerHTML =
    '<span class="mg-pull-symbol" aria-hidden="true">↻</span>' +
    '<span class="mg-pull-label">Pull down to refresh</span>';
  document.body.appendChild(indicator);
  const label = indicator.querySelector(".mg-pull-label");

  let startY = 0;
  let startX = 0;
  let deltaY = 0;
  let tracking = false;
  let pulling = false;
  let refreshing = false;

  function editingOrOverlayOpen() {
    return document.body.classList.contains("mobile-create-expanded") ||
      document.body.classList.contains("mg-menu-open") ||
      document.body.classList.contains("dispatch-menu-open") ||
      document.body.classList.contains("dispatch-map-expanded") ||
      Boolean(document.querySelector(overlayOpen));
  }

  function scrolledDown(target) {
    if (window.scrollY > 2 || (document.scrollingElement?.scrollTop || 0) > 2) return true;
    for (let node = target; node && node !== document; node = node.parentElement) {
      if (node.scrollTop > 2) return true;
    }
    return false;
  }

  function reset() {
    if (refreshing) return;
    tracking = false;
    pulling = false;
    deltaY = 0;
    indicator.classList.remove("visible");
    indicator.style.transform = "translate(-50%,0)";
    label.textContent = "Pull down to refresh";
  }

  document.addEventListener("touchstart", event => {
    if (refreshing || !mobile.matches || event.touches.length !== 1) {
      reset();
      return;
    }
    const target = event.target;
    if (!(target instanceof Element) ||
        target.closest(blockedElements) ||
        editingOrOverlayOpen() ||
        scrolledDown(target)) {
      reset();
      return;
    }
    startY = event.touches[0].clientY;
    startX = event.touches[0].clientX;
    deltaY = 0;
    pulling = false;
    tracking = true;
  }, {passive:true});

  document.addEventListener("touchmove", event => {
    if (!tracking || event.touches.length !== 1 || refreshing) return;
    const x = event.touches[0].clientX - startX;
    const y = event.touches[0].clientY - startY;
    if (y < -SLOP || Math.abs(x) > Math.max(SLOP, Math.abs(y) * .7) ||
        editingOrOverlayOpen() || scrolledDown(event.target)) {
      reset();
      return;
    }
    if (y <= SLOP) return;
    if (event.cancelable) event.preventDefault();
    pulling = true;
    deltaY = y;
    indicator.classList.add("visible");
    indicator.style.transform = "translate(-50%," + Math.min(64, (y - SLOP) * .7) + "px)";
    const ready = y >= LIMIT;
    label.textContent = ready ? "Release to refresh" : "Pull down to refresh";
  }, {passive:false});

  document.addEventListener("touchend", () => {
    if (!tracking || !pulling || refreshing) return;
    if (deltaY < LIMIT || editingOrOverlayOpen()) {
      reset();
      return;
    }
    refreshing = true;
    tracking = false;
    indicator.classList.add("visible");
    indicator.style.transform = "translate(-50%,42px)";
    label.textContent = "Refreshing…";
    window.setTimeout(() => window.location.reload(), 120);
  }, {passive:true});

  document.addEventListener("touchcancel", reset, {passive:true});
  window.addEventListener("pagehide", reset);
})();
