(function () {
  "use strict";

  const container = document.getElementById("dispatchPickupMap");
  const countNode = document.getElementById("dispatchPickupMapCount");
  const statusNode = document.getElementById("dispatchPickupMapStatus");
  const filterNode = document.getElementById("dispatchPickupMapFilter");
  const resetButton = document.getElementById("dispatchPickupMapReset");
  if (!container || !countNode || !statusNode || !filterNode || !resetButton) return;

  const geoKey = String(window.MG_CONFIG?.geoapifyApiKey || window.MG_GEOAPIFY_API_KEY || "").trim();
  const cacheKey = "mgexpress.dispatch.pickup-map.locations.v1";
  const cacheLifetime = 12 * 60 * 60 * 1000;
  const cache = new Map();
  let jobs = [];
  let revision = 0;
  let firstFit = true;
  let markerLayer = null;
  let map = null;
  let mapUsable = false;

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function statusKind(job) {
    const value = String(job?.status || "").trim().toLowerCase();
    const workflow = String(job?.driver_workflow_status || "").trim().toLowerCase();
    if (["cancelled", "canceled", "rejected"].includes(value)) return "cancelled";
    if (["completed", "delivered", "closed"].includes(value) || workflow === "delivered") return "completed";
    if (["assigned", "in_progress", "en_route", "en_route_pickup", "arrived_pickup", "picked_up", "en_route_delivery", "arrived_delivery"].includes(value)
      || ["in_progress", "en_route", "en_route_pickup", "arrived_pickup", "picked_up", "en_route_delivery", "arrived_delivery"].includes(workflow)
      || job?.assigned_driver_id) return "live";
    if (["ready", "ready_to_dispatch"].includes(value)) return "ready";
    return "pending";
  }

  function kindLabel(kind) {
    return ({ pending: "Pending review", ready: "Ready to dispatch", live: "Live / assigned",
      completed: "Completed", cancelled: "Cancelled / rejected" })[kind] || "Pending";
  }

  function pickupAddress(job) {
    const street = String(job?.pickup_address || "").trim();
    if (!street) return "";
    const city = String(job?.pickup_city || "").trim();
    const state = String(job?.pickup_state || "").trim();
    const zip = String(job?.pickup_zip || "").trim();
    const fullAlready = /,/.test(street) && (/\b[A-Z]{2}\s+\d{5}/i.test(street) || (city && street.toLowerCase().includes(city.toLowerCase())));
    return fullAlready ? street : [street, city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  }

  function addressKey(job) {
    return pickupAddress(job).toLowerCase().replace(/\s+/g, " ").trim();
  }

  function selectedJobs() {
    const filter = filterNode.value;
    return jobs.filter(job => {
      const kind = statusKind(job);
      return filter === "all" || (filter === "active" && kind !== "completed" && kind !== "cancelled")
        || (filter === "completed" && kind === "completed")
        || (filter === "cancelled" && kind === "cancelled");
    });
  }

  function saveCache() {
    try {
      const rows = [...cache.entries()].slice(-600).map(([key, value]) => [key, value]);
      sessionStorage.setItem(cacheKey, JSON.stringify(rows));
    } catch (_error) { /* Cache is optional. */ }
  }

  try {
    const rows = JSON.parse(sessionStorage.getItem(cacheKey) || "[]");
    if (Array.isArray(rows)) {
      rows.forEach(([key, item]) => {
        if (typeof key === "string" && item && Number.isFinite(item.at)
          && Date.now() - item.at < cacheLifetime) cache.set(key, item);
      });
    }
  } catch (_error) { /* Continue without cache. */ }

  function storedPoint(job) {
    const lat = Number(job?.pickup_lat ?? job?.pickup_latitude);
    const lon = Number(job?.pickup_lon ?? job?.pickup_longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
        && job?.pickup_lat != null || false) {
      return [lat, lon];
    }
    return null;
  }

  function pointForJob(job) {
    const direct = storedPoint(job);
    if (direct) return direct;
    const cached = cache.get(addressKey(job));
    return cached?.point || null;
  }

  function isMatchingBuilding(candidate, address, job) {
    const street = String(job?.pickup_address || "").trim();
    const house = street.match(/^\s*(\d+[A-Za-z]?(?:-\d+[A-Za-z]?)?)(?:\s|$)/)?.[1];
    const found = String(candidate?.housenumber || "").trim();
    if (house && (!found || found.toLowerCase() !== house.toLowerCase())) return false;
    const zip = String(job?.pickup_zip || "").trim().slice(0, 5);
    if (zip && String(candidate?.postcode || "").slice(0, 5) !== zip) return false;
    const state = String(job?.pickup_state || "").trim().toUpperCase();
    if (state && candidate?.state_code && String(candidate.state_code).toUpperCase() !== state) return false;
    if (!["building", "amenity"].includes(String(candidate?.result_type || "").toLowerCase())) return false;
    return Number.isFinite(Number(candidate.lat)) && Number.isFinite(Number(candidate.lon));
  }

  async function locateAddress(key, job) {
    if (!geoKey) return null;
    const url = new URL("https://api.geoapify.com/v1/geocode/search");
    url.search = new URLSearchParams({
      text: pickupAddress(job), format: "json", limit: "5",
      filter: "countrycode:us", apiKey: geoKey
    }).toString();
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error("Geocoding unavailable (" + response.status + ")");
    const body = await response.json();
    const matched = (body.results || []).find(candidate => isMatchingBuilding(candidate, key, job));
    return matched ? [Number(matched.lat), Number(matched.lon)] : null;
  }

  function popupMarkup(list, address) {
    return '<div class="mg-map-popup"><div class="mg-map-popup-label">PICKUP LOCATION</div>'
      + '<div class="mg-map-popup-address">' + escapeHtml(address) + '</div>'
      + list.map(job => {
        const kind = statusKind(job);
        const number = job.job_number || "Open order";
        const id = encodeURIComponent(String(job.id || ""));
        return '<div class="mg-map-popup-job"><div><strong>' + escapeHtml(number)
          + '</strong><small>' + escapeHtml(job.customer_name || job.company_name || "Customer")
          + ' · ' + escapeHtml(kindLabel(kind)) + '</small></div>'
          + '<a href="/deliveries.html?id=' + id + '">View job</a></div>';
      }).join("") + '</div>';
  }

  function updateSummary(list, located, unlocated, waiting) {
    countNode.textContent = located + " / " + list.length + " pickup jobs mapped";
    if (!geoKey) {
      statusNode.textContent = "Map geocoding is not configured. Contact dispatch setup.";
      return;
    }
    if (!list.length) {
      statusNode.textContent = "No jobs in this filter.";
      return;
    }
    statusNode.textContent = waiting
      ? "Locating " + waiting + " pickup address" + (waiting === 1 ? "" : "es") + "…"
      : unlocated
        ? unlocated + " job" + (unlocated === 1 ? " has" : "s have") + " an unverified or missing pickup address and cannot be pinned."
        : "Tap any pickup pin to view its jobs. Zoom or drag to explore.";
  }

  function showVisibleJobs(options = {}) {
    if (!mapUsable) return;
    const visible = selectedJobs();
    const grouped = new Map();
    let located = 0, unlocated = 0, waiting = 0;
    visible.forEach(job => {
      const key = addressKey(job);
      const point = pointForJob(job);
      if (!key || !point) {
        if (key && !cache.has(key) && geoKey) waiting++;
        else unlocated++;
        return;
      }
      located++;
      const coordKey = point[0].toFixed(5) + "," + point[1].toFixed(5);
      if (!grouped.has(coordKey)) grouped.set(coordKey, {point, jobs: [], address: pickupAddress(job)});
      grouped.get(coordKey).jobs.push(job);
    });
    markerLayer.clearLayers();
    const bounds = [];
    grouped.forEach(({point, jobs: localJobs, address}) => {
      bounds.push(point);
      const priorities = ["live", "ready", "pending", "completed", "cancelled"];
      const kind = priorities.find(k => localJobs.some(job => statusKind(job) === k)) || "pending";
      const icon = window.L.divIcon({
        className: "mg-map-marker-icon",
        html: '<span class="mg-map-pin mg-map-pin-' + kind + '">' + localJobs.length + '</span>',
        iconSize: [40, 44], iconAnchor: [20, 42], popupAnchor: [0, -35]
      });
      window.L.marker(point, {icon, keyboard:true, title: localJobs.length + " pickup job" + (localJobs.length === 1 ? "" : "s")})
        .bindPopup(popupMarkup(localJobs, address), {maxWidth: 300, minWidth: 240})
        .addTo(markerLayer);
    });
    updateSummary(visible, located, unlocated, waiting);
    if ((options.recenter || firstFit) && bounds.length) {
      firstFit = false;
      if (bounds.length === 1) map.setView(bounds[0], 12);
      else map.fitBounds(bounds, {padding: [30, 30], maxZoom: 13});
    }
  }

  async function update(data, options = {}) {
    jobs = Array.isArray(data) ? data.filter(job => job && job.id) : [];
    const current = ++revision;
    showVisibleJobs({recenter: Boolean(options.recenter)});
    const pending = new Map();
    jobs.forEach(job => {
      const key = addressKey(job);
      if (key && !storedPoint(job) && !cache.has(key) && !pending.has(key)) pending.set(key, job);
    });
    const entries = [...pending];
    let cursor = 0;
    const workers = Array.from({length: Math.min(2, entries.length)}, async () => {
      while (cursor < entries.length && current === revision) {
        const [key, job] = entries[cursor++];
        try {
          const point = await locateAddress(key, job);
          if (current !== revision) return;
          cache.set(key, {point, at: Date.now()});
        } catch (error) {
          if (current !== revision) return;
          console.warn("[MG Pickup Map] Address lookup failed:", String(error?.message || error));
          // Do not cache failures: allow refresh to retry when the provider recovers.
        }
        if (current === revision) {
          saveCache();
          showVisibleJobs();
        }
        await new Promise(resolve => setTimeout(resolve, 160));
      }
    });
    await Promise.all(workers);
    if (current === revision) showVisibleJobs();
  }

  if (window.L && geoKey) {
    map = window.L.map(container, {zoomControl: false, scrollWheelZoom: false, tap: true, preferCanvas: true})
      .setView([39.7392, -104.9903], 10);
    window.L.control.zoom({position: "topright"}).addTo(map);
    window.L.tileLayer("https://maps.geoapify.com/v1/tile/dark-matter/{z}/{x}/{y}.png?apiKey={apiKey}", {
      apiKey: geoKey, maxZoom: 19,
      attribution: 'Powered by <a href="https://www.geoapify.com/">Geoapify</a> | © OpenMapTiles · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    markerLayer = window.L.layerGroup().addTo(map);
    mapUsable = true;
    window.setTimeout(() => map.invalidateSize(), 60);
    statusNode.textContent = "Loading pickup locations…";
  } else {
    statusNode.textContent = "Unable to load the map. Check the mapping service and refresh.";
    countNode.textContent = "Pickup map unavailable";
  }

  filterNode.addEventListener("change", () => {
    showVisibleJobs({recenter: true});
  });
  resetButton.addEventListener("click", () => {
    if (mapUsable) showVisibleJobs({recenter:true});
  });

  window.MGDispatchPickupMap = {update, recenter: () => showVisibleJobs({recenter:true})};
})();
