(function () {
  const CLOSED_STATUSES = new Set(["completed", "delivered", "closed", "cancelled", "canceled"]);
  const PICKUP_WORKFLOWS = new Set(["assigned", "en_route_pickup", "arrived_pickup"]);
  const DELIVERY_WORKFLOWS = new Set(["picked_up", "en_route_delivery", "arrived_delivery"]);

  function clean(value) {
    return String(value || "").trim().toLowerCase();
  }

  function parseDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function hasReturnRequired(job) {
    if (job && job.return_required === true) {
      return true;
    }

    const token = clean(job && job.return_required);
    return token === "true" || token === "1" || token === "yes";
  }

  function isClosed(job) {
    return CLOSED_STATUSES.has(clean(job && job.status)) || clean(job && job.driver_workflow_status) === "complete_delivery";
  }

  function returnAddress(job) {
    if (!hasReturnRequired(job)) {
      return "";
    }

    if (clean(job && job.return_location_type) !== "different_location") {
      return String(job && job.pickup_address ? job.pickup_address : "").trim();
    }

    const parts = [
      String(job && job.return_address ? job.return_address : "").trim(),
      String(job && job.return_suite_floor ? job.return_suite_floor : "").trim(),
      String(job && job.return_zip ? job.return_zip : "").trim()
    ].filter(Boolean);

    return parts.join(" • ");
  }

  function jobSortValue(job) {
    const date = parseDate(job && (job.scheduled_at || job.pickup_time || job.delivery_time || job.created_at || job.updated_at));
    return date ? date.getTime() : Number.MAX_SAFE_INTEGER;
  }

  function jobSortKey(job) {
    const number = String(job && job.job_number ? job.job_number : "");
    return [jobSortValue(job), number].join("|");
  }

  function buildJobStops(job) {
    if (!job || isClosed(job)) {
      return [];
    }

    const workflow = clean(job.driver_workflow_status);
    const status = clean(job.status);
    const stopBase = {
      jobId: String(job.id || ""),
      jobNumber: String(job.job_number || "Job"),
      customerName: String(job.customer_name || "Customer"),
      driverPay: Number(job.driver_pay || 0) || 0,
      status,
      workflow
    };

    const stops = [];
    const pickupNeeded = PICKUP_WORKFLOWS.has(workflow) || (!workflow && !["delivered", "completed"].includes(status));
    const deliveryNeeded = !["delivered", "completed"].includes(status) && workflow !== "complete_delivery";
    const returnNeeded = hasReturnRequired(job);

    if (pickupNeeded && String(job.pickup_address || "").trim()) {
      stops.push({
        ...stopBase,
        stopType: "pickup",
        stopLabel: "Pickup",
        address: String(job.pickup_address || "").trim(),
        detail: [job.pickup_suite_floor, job.pickup_zip].map(item => String(item || "").trim()).filter(Boolean).join(" • ")
      });
    }

    if (deliveryNeeded && String(job.delivery_address || "").trim()) {
      stops.push({
        ...stopBase,
        stopType: "delivery",
        stopLabel: "Delivery",
        address: String(job.delivery_address || "").trim(),
        detail: [job.delivery_suite_floor, job.delivery_zip, job.delivery_recipient_name || job.pod_recipient_name].map(item => String(item || "").trim()).filter(Boolean).join(" • ")
      });
    }

    if (returnNeeded) {
      const address = returnAddress(job);
      if (address) {
        stops.push({
          ...stopBase,
          stopType: "return",
          stopLabel: "Return",
          address,
          detail: [job.return_timing, job.return_location_type].map(item => String(item || "").trim()).filter(Boolean).join(" • ")
        });
      }
    }

    return stops;
  }

  function buildGoogleMapsUrl(stops) {
    const addresses = (Array.isArray(stops) ? stops : [])
      .map(stop => String(stop && stop.address ? stop.address : "").trim())
      .filter(Boolean);

    if (!addresses.length) {
      return "";
    }

    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("travelmode", "driving");

    if (addresses.length === 1) {
      url.searchParams.set("destination", addresses[0]);
      return url.toString();
    }

    url.searchParams.set("origin", addresses[0]);
    url.searchParams.set("destination", addresses[addresses.length - 1]);

    if (addresses.length > 2) {
      url.searchParams.set("waypoints", addresses.slice(1, -1).join("|"));
    }

    return url.toString();
  }

  function buildRoutePreviewData(input = {}) {
    const driverName = String(input.driverName || "Driver");
    const availabilityLabel = String(input.availabilityLabel || "");
    const jobs = Array.isArray(input.jobs) ? input.jobs.slice() : [];

    const activeJobs = jobs.filter(job => job && !isClosed(job));
    activeJobs.sort((a, b) => {
      const timeDiff = jobSortValue(a) - jobSortValue(b);
      if (timeDiff !== 0) {
        return timeDiff;
      }
      return String(a.job_number || "").localeCompare(String(b.job_number || ""));
    });

    const routeStops = [];
    let pickupRemaining = 0;
    let deliveryRemaining = 0;
    let returnStopsRemaining = 0;
    let totalDriverPay = 0;

    activeJobs.forEach(job => {
      totalDriverPay += Number(job.driver_pay || 0) || 0;
      const stops = buildJobStops(job);

      stops.forEach(stop => {
        if (stop.stopType === "pickup") {
          pickupRemaining += 1;
        } else if (stop.stopType === "delivery") {
          deliveryRemaining += 1;
        } else if (stop.stopType === "return") {
          returnStopsRemaining += 1;
        }

        routeStops.push(stop);
      });
    });

    return {
      driverName,
      availabilityLabel,
      activeJobs,
      activeJobsCount: activeJobs.length,
      pickupRemaining,
      deliveryRemaining,
      returnStopsRemaining,
      totalDriverPay,
      routeStops,
      mapsUrl: buildGoogleMapsUrl(routeStops),
      nextStop: routeStops[0] || null
    };
  }

  window.MG_ROUTE_PREVIEW = {
    buildRoutePreviewData,
    buildGoogleMapsUrl,
    buildJobStops,
    hasReturnRequired,
    isClosed,
    clean,
    jobSortValue,
    jobSortKey
  };
})();
