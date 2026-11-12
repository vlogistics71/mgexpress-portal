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
  let markers = [];
  let map = null;
  let mapUsable = false;
  const failedLookupKeys = new Set();

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
    // Closed, cancelled and rejected orders are excluded from jobs before
    // filtering, so no filter can reveal them on the pickup map.
    return jobs.filter(job => {
      const kind = statusKind(job);
      return filter === "pending" ? kind === "pending"
        : filter === "live" ? kind === "live"
        : ["pending", "ready", "live"].includes(kind);
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
    const latValue = job?.pickup_lat ?? job?.pickup_latitude;
    const lonValue = job?.pickup_lon ?? job?.pickup_longitude;
    if (latValue == null || lonValue == null || latValue === "" || lonValue === "") return null;
    const lat = Number(latValue);
    const lon = Number(lonValue);
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90
      && lon >= -180 && lon <= 180 ? [lat, lon] : null;
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
      statusNode.textContent = "No active jobs in this filter.";
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
        if (key && !cache.has(key) && geoKey && !failedLookupKeys.has(key)) waiting++;
        else unlocated++;
        return;
      }
      located++;
      const coordKey = point[0].toFixed(5) + "," + point[1].toFixed(5);
      if (!grouped.has(coordKey)) grouped.set(coordKey, {point, jobs: [], address: pickupAddress(job)});
      grouped.get(coordKey).jobs.push(job);
    });
    markers.forEach(marker => marker.setMap(null));
    markers = [];
    const bounds = new google.maps.LatLngBounds();
    grouped.forEach(({point, jobs: localJobs, address}) => {
      const position = {lat: point[0], lng: point[1]};
      bounds.extend(position);
      const priorities = ["live", "ready", "pending", "completed", "cancelled"];
      const kind = priorities.find(k => localJobs.some(job => statusKind(job) === k)) || "pending";
      const color = ({live:"#3b82f6",ready:"#22c55e",pending:"#f4bd4f",completed:"#64748b",cancelled:"#ef4444"})[kind] || "#f4bd4f";
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="44" height="52" viewBox="0 0 44 52">'
        + '<path d="M22 2C10.4 2 1 11.2 1 22.5c0 15.4 21 28 21 28s21-12.6 21-28C43 11.2 33.6 2 22 2z" fill="' + color + '" stroke="white" stroke-width="3"/>'
        + '<circle cx="22" cy="22" r="13" fill="white"/><text x="22" y="27" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#123b2e">' + localJobs.length + '</text></svg>';
      const marker = new google.maps.Marker({
        map, position, title: localJobs.length + " pickup job" + (localJobs.length === 1 ? "" : "s"),
        icon: {url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg), scaledSize: new google.maps.Size(44,52), anchor: new google.maps.Point(22,50)}
      });
      marker.addListener("click", () => {
        infoWindow.setContent(popupMarkup(localJobs, address));
        infoWindow.open({map, anchor: marker});
      });
      markers.push(marker);
    });
    updateSummary(visible, located, unlocated, waiting);
    if ((options.recenter || firstFit) && grouped.size) {
      firstFit = false;
      if (grouped.size === 1) {
        const only = [...grouped.values()][0].point;
        map.setCenter({lat: only[0], lng: only[1]});
        map.setZoom(12);
      } else {
        map.fitBounds(bounds, 30);
        google.maps.event.addListenerOnce(map, "idle", () => {
          if (map.getZoom() > 13) map.setZoom(13);
        });
      }
    }
  }

  async function update(data, options = {}) {
    jobs = Array.isArray(data) ? data.filter(job => job && job.id
      && ["pending", "ready", "live"].includes(statusKind(job))) : [];
    const current = ++revision;
    failedLookupKeys.clear();
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
          failedLookupKeys.delete(key);
        } catch (error) {
          if (current !== revision) return;
          failedLookupKeys.add(key);
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

  let infoWindow;
  function loadGoogleMaps() {
    return new Promise((resolve, reject) => {
      if (window.google?.maps?.Map) return resolve();
      fetch("/.netlify/functions/google-maps-key", {credentials:"same-origin"})
        .then(response => {
          if (!response.ok) throw new Error("Google Maps key is not configured in Netlify.");
          return response.json();
        })
        .then(({apiKey}) => {
          if (!apiKey) throw new Error("Google Maps key is missing.");
          const callbackName = "__mgPickupGoogleMapsReady";
          window[callbackName] = () => resolve();
          const script = document.createElement("script");
          script.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(apiKey)
            + "&v=weekly&callback=" + callbackName;
          script.async = true;
          script.onerror = () => reject(new Error("Google Maps could not load."));
          document.head.appendChild(script);
        }).catch(reject);
    });
  }

  if (geoKey) {
    statusNode.textContent = "Loading Google Maps…";
    loadGoogleMaps().then(() => {
      map = new google.maps.Map(container, {
        center: {lat:39.7392, lng:-104.9903}, zoom:10,
        mapTypeControl:false, streetViewControl:false, fullscreenControl:false,
        zoomControl:true, gestureHandling:"greedy"
      });
      infoWindow = new google.maps.InfoWindow();
      mapUsable = true;
      window.setTimeout(() => google.maps.event.trigger(map, "resize"), 80);
      statusNode.textContent = "Loading pickup locations…";
      showVisibleJobs();
    }).catch(error => {
      console.error("[MG Pickup Map] Google Maps failed to load:", String(error?.message || error));
      statusNode.textContent = "Unable to load Google Maps. Check the API key, billing, and Maps JavaScript API access.";
      countNode.textContent = "Pickup map unavailable";
    });
  } else {
    statusNode.textContent = "Map geocoding is not configured. Contact dispatch setup.";
    countNode.textContent = "Pickup map unavailable";
  }

  filterNode.addEventListener("change", () => {
    showVisibleJobs({recenter: true});
  });
  resetButton.addEventListener("click", () => {
    if (!mapUsable) return;
    if (selectedJobs().some(job => pointForJob(job))) showVisibleJobs({recenter:true});
    else { map.setCenter({lat:39.7392, lng:-104.9903}); map.setZoom(10); }
  });

  window.MGDispatchPickupMap = {update, recenter: () => showVisibleJobs({recenter:true})};
})();
